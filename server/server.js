const path = require('path');
require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const sharp = require('sharp');

const app = express();

const PORT = process.env.PORT || 3001;

const BASE_URL = (
    process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, '');

const records = new Map();


// ============================================================
// CORS
// ============================================================

app.use(cors({
    origin: [
        'https://mail-progress.netlify.app',
        process.env.CLIENT_URL
    ].filter(Boolean),

    methods: ['GET', 'POST', 'OPTIONS'],

    allowedHeaders: ['Content-Type']
}));


// ============================================================
// JSON BODY
// ============================================================

app.use(express.json());


// ============================================================
// SMTP
// ============================================================

const transporter = nodemailer.createTransport({

    host: process.env.SMTP_HOST,

    port: Number(process.env.SMTP_PORT) || 587,

    secure: process.env.SMTP_SECURE === 'true',

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }

});


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(value)
{
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}


// ============================================================
// PROGRESS SVG
// ============================================================

function progressSvg(percent, durationMinutes)
{
    const safePercent = Math.max(
        0,
        Math.min(100, Number(percent) || 0)
    );

    const width = Math.round(
        560 * safePercent / 100
    );

    const percentageText = `${Math.round(safePercent)}%`;

    return `
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="600"
    height="110"
    viewBox="0 0 600 110"
>

    <!-- Background -->
    <rect
        x="0"
        y="0"
        width="600"
        height="110"
        fill="#ffffff"
    />

    <!-- Progress label -->
    <text
        x="20"
        y="28"
        font-family="DejaVu Sans"
        font-size="16"
        fill="#475569"
    >
        Progress
    </text>

    <!-- Percentage -->
    <text
        x="580"
        y="28"
        text-anchor="end"
        font-family="DejaVu Sans"
        font-size="18"
        font-weight="bold"
        fill="#0f172a"
    >
        ${percentageText}
    </text>

    <!-- Progress background -->
    <rect
        x="20"
        y="45"
        width="560"
        height="28"
        rx="14"
        ry="14"
        fill="#e2e8f0"
    />

    <!-- Progress -->
    <rect
        x="20"
        y="45"
        width="${width}"
        height="28"
        rx="14"
        ry="14"
        fill="#0f766e"
    />

    <!-- Duration -->
    <text
        x="300"
        y="98"
        text-anchor="middle"
        font-family="DejaVu Sans"
        font-size="14"
        fill="#475569"
    >
        Expected duration: ${durationMinutes} minutes
    </text>

</svg>
`;
}


// ============================================================
// SEND EMAIL
// ============================================================

app.post('/api/send-email', async (req, res) =>
{
    const {
        to,
        subject,
        durationMinutes
    } = req.body || {};

    const minutes = Number(durationMinutes);


    // --------------------------------------------------------
    // Validate email
    // --------------------------------------------------------

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || ''))
    {
        return res.status(400).json({
            error: 'Enter a valid recipient email.'
        });
    }


    // --------------------------------------------------------
    // Validate subject
    // --------------------------------------------------------

    if (!subject || !String(subject).trim())
    {
        return res.status(400).json({
            error: 'Enter a subject.'
        });
    }


    // --------------------------------------------------------
    // Validate duration
    // --------------------------------------------------------

    if (
        !Number.isFinite(minutes) ||
        minutes <= 0 ||
        minutes > 1440
    )
    {
        return res.status(400).json({
            error: 'Duration must be between 0 and 1440 minutes.'
        });
    }


    // --------------------------------------------------------
    // Create progress record
    // --------------------------------------------------------

    const record = {

        id: crypto.randomUUID(),

        to,

        subject: String(subject).trim(),

        startedAt: Date.now(),

        durationMinutes: minutes,

        durationMs: minutes * 60 * 1000

    };


    records.set(record.id, record);


    // --------------------------------------------------------
    // Progress image URL
    // --------------------------------------------------------

    const imageUrl =
        `${BASE_URL}/api/progress/${record.id}/image.png`;


    // --------------------------------------------------------
    // Email HTML
    // --------------------------------------------------------

    const safeSubject = escapeHtml(record.subject);

    const html = `
<div
    style="
        font-family: Arial, sans-serif;
        padding: 24px;
        background: #ffffff;
    "
>

    <h2
        style="
            margin: 0 0 16px 0;
            font-size: 24px;
            color: #111827;
        "
    >
        ${safeSubject}
    </h2>

    <p
        style="
            margin: 0 0 20px 0;
            font-size: 16px;
            color: #374151;
        "
    >
        Expected duration:
        <strong>${record.durationMinutes} minutes</strong>
    </p>

    <img
        src="${imageUrl}"
        width="600"
        height="110"
        alt="Email progress"
        style="
            display: block;
            width: 600px;
            max-width: 100%;
            height: auto;
            border: 0;
        "
    >

</div>
`;

    const text = `
${record.subject}

Expected duration: ${record.durationMinutes} minutes.

Progress: 0%
`;

    try
    {
        await transporter.sendMail({

            from:
                process.env.SMTP_FROM ||
                process.env.SMTP_USER,

            to: record.to,

            subject: record.subject,

            html,

            text

        });


        return res.json({
            success: true,
            id: record.id
        });

    }
    catch (err)
    {
        records.delete(record.id);

        console.error(
            'Email error:',
            err.message
        );

        return res.status(500).json({
            error: 'Unable to send email.'
        });
    }
});

app.get('/api/progress/:id/image.png', async (req, res) =>
{
    try
    {
        const record =
            records.get(req.params.id);

        if (!record)
        {
            return res.status(404).send(
                'Progress record not found.'
            );
        }

        const elapsed =
            Date.now() - record.startedAt;

        const percent =
            Math.min(
                100,
                (elapsed / record.durationMs) * 100
            );

        const svg =
            progressSvg(
                percent,
                record.durationMinutes
            );

        const image =
            await sharp(
                Buffer.from(svg)
            )
            .png()
            .toBuffer();
        res.set({

            'Content-Type': 'image/png',

            'Cache-Control':
                'no-store, no-cache, must-revalidate, proxy-revalidate',

            'Pragma': 'no-cache',

            'Expires': '0'

        });


        return res.send(image);

    }
    catch (err)
    {
        console.error(
            'Image error:',
            err.message
        );

        return res.status(500).send(
            'Unable to generate image.'
        );
    }
});

app.get('/api/health', (req, res) =>
{
    res.json({
        success: true,
        message: 'Mail progress API is running.'
    });
});

app.listen(PORT, () =>
{
    console.log(
        `Server running at http://localhost:${PORT}`
    );
});