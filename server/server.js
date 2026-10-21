require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const GifEncoder = require('gif-encoder');

const app = express();

const PORT = process.env.PORT || 3001;

const BASE_URL = (
    process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, '');

const PROGRESS_SECRET =
    process.env.PROGRESS_SECRET ||
    'change-this-secret-in-production';

app.use(cors({
    origin: [
        'https://mail-progress.netlify.app',
        process.env.CLIENT_URL
    ].filter(Boolean),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

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

function createProgressToken(durationMinutes)
{
    const data = JSON.stringify({
        startedAt: Date.now(),
        durationMinutes
    });

    const encoded = Buffer
        .from(data)
        .toString('base64url');

    const signature = crypto
        .createHmac('sha256', PROGRESS_SECRET)
        .update(encoded)
        .digest('base64url');

    return `${encoded}.${signature}`;
}

function verifyProgressToken(token)
{
    try
    {
        const parts = token.split('.');

        if (parts.length !== 2)
            return null;

        const encoded = parts[0];
        const signature = parts[1];

        const expectedSignature = crypto
            .createHmac('sha256', PROGRESS_SECRET)
            .update(encoded)
            .digest('base64url');

        const a = Buffer.from(signature);
        const b = Buffer.from(expectedSignature);

        if (
            a.length !== b.length ||
            !crypto.timingSafeEqual(a, b)
        )
        {
            return null;
        }

        const data = JSON.parse(
            Buffer
                .from(encoded, 'base64url')
                .toString('utf8')
        );

        if (
            !data.startedAt ||
            !Number.isFinite(data.durationMinutes) ||
            data.durationMinutes <= 0
        )
        {
            return null;
        }

        return data;
    }
    catch
    {
        return null;
    }
}

function digitSvg(digit, x, y, scale = 1)
{
    const segments = {
        0: ['a', 'b', 'c', 'd', 'e', 'f'],
        1: ['b', 'c'],
        2: ['a', 'b', 'g', 'e', 'd'],
        3: ['a', 'b', 'g', 'c', 'd'],
        4: ['f', 'g', 'b', 'c'],
        5: ['a', 'f', 'g', 'c', 'd'],
        6: ['a', 'f', 'g', 'e', 'c', 'd'],
        7: ['a', 'b', 'c'],
        8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        9: ['a', 'b', 'c', 'd', 'f', 'g']
    };

    const active = segments[digit] || [];

    const w = 24 * scale;
    const h = 42 * scale;
    const t = 5 * scale;
    const r = 2 * scale;

    const shapes = {
        a: `<rect x="${x + t}" y="${y}" width="${w - t * 2}" height="${t}" rx="${r}"/>`,
        b: `<rect x="${x + w - t}" y="${y + t}" width="${t}" height="${h / 2 - t}" rx="${r}"/>`,
        c: `<rect x="${x + w - t}" y="${y + h / 2}" width="${t}" height="${h / 2 - t}" rx="${r}"/>`,
        d: `<rect x="${x + t}" y="${y + h - t}" width="${w - t * 2}" height="${t}" rx="${r}"/>`,
        e: `<rect x="${x}" y="${y + h / 2}" width="${t}" height="${h / 2 - t}" rx="${r}"/>`,
        f: `<rect x="${x}" y="${y + t}" width="${t}" height="${h / 2 - t}" rx="${r}"/>`,
        g: `<rect x="${x + t}" y="${y + h / 2 - t / 2}" width="${w - t * 2}" height="${t}" rx="${r}"/>`
    };

    return active
        .map(segment => shapes[segment])
        .join('');
}

function percentSvg(percent)
{
    const safePercent = Math.max(
        0,
        Math.min(100, Math.round(percent))
    );

    const width = Math.round(
        560 * safePercent / 100
    );

    const text = String(safePercent);

    const digitWidth = 24;
    const digitGap = 8;
    const percentWidth = 24;

    const totalWidth =
        text.length * digitWidth +
        (text.length - 1) * digitGap +
        percentWidth;

    let startX =
        300 - totalWidth / 2;

    let digits = '';

    for (const digit of text)
    {
        digits += digitSvg(
            digit,
            startX,
            2,
            0.75
        );

        startX +=
            digitWidth * 0.75 +
            digitGap;
    }

    const percentX = startX + 2;

    digits += `
        <circle
            cx="${percentX + 5}"
            cy="7"
            r="2.5"
        />

        <circle
            cx="${percentX + 17}"
            cy="35"
            r="2.5"
        />

        <line
            x1="${percentX + 19}"
            y1="3"
            x2="${percentX + 3}"
            y2="39"
            stroke="#0f172a"
            stroke-width="4"
        />
    `;

    return `
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="600"
    height="80"
    viewBox="0 0 600 80"
>
    <rect
        width="600"
        height="80"
        fill="#ffffff"
    />

    <g
        fill="#0f172a"
    >
        ${digits}
    </g>

    <rect
        x="20"
        y="48"
        width="560"
        height="28"
        rx="14"
        fill="#e2e8f0"
    />

    <rect
        x="20"
        y="48"
        width="${width}"
        height="28"
        rx="14"
        fill="#0f766e"
    />
</svg>
`;
}

async function svgToRgba(svg)
{
    return await sharp(
        Buffer.from(svg)
    )
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function createProgressGif(
    startingPercent,
    durationMinutes
)
{
    const width = 600;
    const height = 80;

    const remainingPercent =
        Math.max(
            0,
            100 - startingPercent
        );

    const frameCount =
        Math.max(
            20,
            Math.min(
                60,
                Math.ceil(remainingPercent)
            )
        );

    const durationMs =
        durationMinutes * 60 * 1000;

    const remainingMs =
        Math.max(
            1000,
            durationMs * remainingPercent / 100
        );

    const delay =
        Math.max(
            100,
            Math.round(
                remainingMs / frameCount
            )
        );

    const encoder =
        new GifEncoder(
            width,
            height
        );

    encoder.writeHeader();

    encoder.setRepeat(0);

    encoder.setDelay(delay);

    encoder.setQuality(10);

    for (let i = 0; i < frameCount; i++)
    {
        const progress =
            startingPercent +
            (
                remainingPercent *
                i /
                (frameCount - 1)
            );

        const svg =
            percentSvg(progress);

        const rgba =
            await svgToRgba(svg);

        encoder.addFrame(rgba);
    }

    const finalSvg =
        percentSvg(100);

    const finalRgba =
        await svgToRgba(finalSvg);

    encoder.addFrame(finalRgba);

    encoder.finish();

    return encoder.read();
}

app.post('/api/send-email', async (req, res) =>
{
    const {
        to,
        subject,
        durationMinutes
    } = req.body || {};

    const minutes = Number(durationMinutes);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || ''))
    {
        return res.status(400).json({
            error: 'Enter a valid recipient email.'
        });
    }

    if (!subject || !String(subject).trim())
    {
        return res.status(400).json({
            error: 'Enter a subject.'
        });
    }

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

    const progressToken =
        createProgressToken(minutes);

    const imageUrl =
        `${BASE_URL}/api/progress/${progressToken}/progress.gif`;

    const safeSubject =
        escapeHtml(subject.trim());

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>

<body style="
    margin:0;
    padding:0;
    background:#ffffff;
">

<div style="
    font-family:Arial,Helvetica,sans-serif;
    padding:24px;
    background:#ffffff;
    max-width:650px;
">

    <h2 style="
        margin:0 0 16px 0;
        font-size:24px;
        line-height:32px;
        color:#111827;
        font-family:Arial,Helvetica,sans-serif;
    ">
        ${safeSubject}
    </h2>

    <p style="
        margin:0 0 20px 0;
        font-size:16px;
        line-height:24px;
        color:#374151;
        font-family:Arial,Helvetica,sans-serif;
    ">
        Expected duration:
        <strong>${minutes} minutes</strong>
    </p>

    <img
        src="${imageUrl}"
        width="600"
        height="80"
        alt="Progress"
        style="
            display:block;
            width:600px;
            max-width:100%;
            height:auto;
            border:0;
            outline:none;
            text-decoration:none;
        "
    >

</div>

</body>
</html>
`;

    const text = `
${subject.trim()}

Expected duration: ${minutes} minutes.

Progress: 0%
`;

    try
    {
        await transporter.sendMail({
            from:
                process.env.SMTP_FROM ||
                process.env.SMTP_USER,

            to,

            subject:
                subject.trim(),

            html,

            text
        });

        return res.json({
            success: true
        });
    }
    catch (err)
    {
        console.error(
            'Email error:',
            err.message
        );

        return res.status(500).json({
            error: 'Unable to send email.'
        });
    }
});

app.get(
    '/api/progress/:token/progress.gif',
    async (req, res) =>
{
    try
    {
        const data =
            verifyProgressToken(
                req.params.token
            );

        if (!data)
        {
            return res.status(404).send(
                'Invalid progress link.'
            );
        }

        const durationMs =
            data.durationMinutes *
            60 *
            1000;

        const elapsed =
            Date.now() -
            data.startedAt;

        const startingPercent =
            Math.min(
                100,
                Math.max(
                    0,
                    elapsed /
                    durationMs *
                    100
                )
            );

        const gif =
            await createProgressGif(
                startingPercent,
                data.durationMinutes
            );

        res.set({
            'Content-Type': 'image/gif',
            'Cache-Control':
                'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        return res.send(gif);
    }
    catch (err)
    {
        console.error(
            'GIF error:',
            err.message
        );

        return res.status(500).send(
            'Unable to generate progress GIF.'
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