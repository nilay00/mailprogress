
const path = require('path');
require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const records = new Map();

app.use(express.json());

const transporter = nodemailer.createTransport({
	host : process.env.SMTP_HOST,
	port : Number(process.env.SMTP_PORT) || 587,
	secure : process.env.SMTP_SECURE === 'true',
	auth : {
		user : process.env.SMTP_USER,
		pass : process.env.SMTP_PASS
	}
});

function progressSvg(percent)
{
	let width = Math.round(560 * percent / 100);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="90">
		<rect width="600" height="90" fill="#fff"/>
		<text x="20" y="28" font-family="Arial" font-size="16" fill="#475569">Progress</text>
		<text x="580" y="28" text-anchor="end" font-family="Arial" font-size="18" fill="#0f172a">${Math.round(percent)}%</text>
		<rect x="20" y="42" width="560" height="28" rx="14" fill="#e2e8f0"/>
		<rect x="20" y="42" width="${width}" height="28" rx="14" fill="#0f766e"/>
	</svg>`;
}

app.post('/api/send-email', async (req, res) =>
{
	let { to, subject, durationMinutes } = req.body || {};
	let minutes = Number(durationMinutes);

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || ''))
		return res.status(400).json({ error : 'Enter a valid recipient email.' });

	if (!subject || !String(subject).trim())
		return res.status(400).json({ error : 'Enter a subject.' });

	if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440)
		return res.status(400).json({ error : 'Duration must be between 0 and 1440 minutes.' });

	let record = {
		id : crypto.randomUUID(),
		to,
		subject : String(subject).trim(),
		startedAt : Date.now(),
		durationMs : minutes * 60000
	};

	records.set(record.id, record);

	let imageUrl = `${BASE_URL}/api/progress/${record.id}/image.png`;

	let html = `
		<div style="font-family:Arial,sans-serif;padding:24px">
			<h2>${record.subject.replace(/[&<>"']/g, char => ({
				'&' : '&amp;',
				'<' : '&lt;',
				'>' : '&gt;',
				'"' : '&quot;',
				"'" : '&#39;'
			}[char]))}</h2>
			<p>Expected duration: ${minutes} minutes</p>
			<img src="${imageUrl}" width="600" height="90" alt="Progress bar">
		</div>
	`;

	try
	{
		await transporter.sendMail({
			from : process.env.SMTP_FROM || process.env.SMTP_USER,
			to : record.to,
			subject : record.subject,
			html,
			text : `${record.subject} - Expected duration: ${minutes} minutes.`
		});

		res.json({ success : true });
	}
	catch (err)
	{
		records.delete(record.id);
		console.error('Email error:', err.message);
		res.status(500).json({ error : 'Unable to send email.' });
	}
});

app.get('/api/progress/:id/image.png', async (req, res) =>
{
	try
	{
		let record = records.get(req.params.id);

		if (!record)
			return res.status(404).send('Progress record not found.');

		let elapsed = Date.now() - record.startedAt;
		let percent = Math.min(100, elapsed / record.durationMs * 100);

		let image = await sharp(Buffer.from(progressSvg(percent)))
			.png()
			.toBuffer();

		res.set({
			'Content-Type' : 'image/png',
			'Cache-Control' : 'no-store, no-cache, must-revalidate, max-age=0'
		});

		res.send(image);
	}
	catch (err)
	{
		console.error('Image error:', err.message);
		res.status(500).send('Unable to generate image.');
	}
});

app.listen(PORT, () =>
{
	console.log(`Server running at http://localhost:${PORT}`);
});