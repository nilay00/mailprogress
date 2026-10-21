const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const sharp = require('sharp');

require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3001;

const BASE_URL = (
    process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, '');

const PROGRESS_SECRET =
    process.env.PROGRESS_SECRET ||
    'change-this-secret-in-production';

let fontBase64 = null;

const FONT_URL =
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/static/NotoSans-Regular.ttf';

const FONT_BOLD_URL =
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/static/NotoSans-Bold.ttf';

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

async function loadFonts()
{
    if (fontBase64)
        return fontBase64;

    try
    {
        const [regularResponse, boldResponse] = await Promise.all([
            fetch(FONT_URL),
            fetch(FONT_BOLD_URL)
        ]);

        if (!regularResponse.ok || !boldResponse.ok)
        {
            throw new Error('Unable to download font from CDN');
        }

        const regularBuffer =
            Buffer.from(await regularResponse.arrayBuffer());

        const boldBuffer =
            Buffer.from(await boldResponse.arrayBuffer());

        fontBase64 = {
            regular: regularBuffer.toString('base64'),
            bold: boldBuffer.toString('base64')
        };

        return fontBase64;
    }
    catch (error)
    {
        console.error('Font loading error:', error.message);

        return null;
    }
}

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

function progressSvg(percent, durationMinutes, fonts)
{
    const safePercent = Math.max(
        0,
        Math.min(100, Number(percent) || 0)
    );

    const width = Math.round(
        560 * safePercent / 100
    );

    const regularFont = fonts
        ? `
            @font-face {
                font-family: 'NotoProgress';
                src: url(data:font/ttf;base64,${fonts.regular});
            }
        `
        : '';

    const boldFont = fonts
        ? `
            @font-face {
                font-family: 'NotoProgressBold';
                src: url(data:font/ttf;base64,${fonts.bold});
            }
        `
        : '';

    return `
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="600"
    height="110"
    viewBox="0 0 600 110"
>
    <defs>
        <style>
            ${regularFont}
            ${boldFont}

            .regular {
                font-family: 'NotoProgress', sans-serif;
            }

            .bold {
                font-family: 'NotoProgressBold', sans-serif;
            }
        </style>
    </defs>

    <rect
        x="0"
        y="0"
        width="600"
        height="110"
        fill="#ffffff"
    />

    <text
        x="20"
        y="28"
        class="regular"
        font-size="16"
        fill="#475569"
    >Progress</text>

    <text
        x="580"
        y="28"
        text-anchor="end"
        class="bold"
        font-size="18"
        fill="#0f172a"
    >${Math.round(safePercent)}%</text>

    <rect
        x="20"
        y="45"
        width="560"
        height="28"
        rx="14"
        ry="14"
        fill="#e2e8f0"
    />

    <rect
        x="20"
        y="45"
        width="${width}"
        height="28"
        rx="14"
        ry="14"
        fill="#0f766e"
    />

    <text
        x="300"
        y="98"
        text-anchor="middle"
        class="regular"
        font-size="14"
        fill="#475569"
    >Expected duration: ${durationMinutes} minutes</text>
</svg>
`;
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
        `${BASE_URL}/api/progress/${progressToken}/image.png`;

    const safeSubject =
        escapeHtml(subject.trim());

    const html = `
<div style="
    font-family: Arial, Helvetica, sans-serif;
    padding: 24px;
    background: #ffffff;
">

    <h2 style="
        margin: 0 0 16px 0;
        font-size: 24px;
        color: #111827;
    ">
        ${safeSubject}
    </h2>

    <p style="
        margin: 0 0 20px 0;
        font-size: 16px;
        color: #374151;
    ">
        Expected duration:
        <strong>${minutes} minutes</strong>
    </p>

    <img
        src="${imageUrl}"
        width="600"
        height="110"
        alt="Progress"
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
            subject: subject.trim(),
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
    '/api/progress/:token/image.png',
    async (req, res) =>
{
    try
    {
        const data =
            verifyProgressToken(req.params.token);

        if (!data)
        {
            return res.status(404).send(
                'Invalid progress link.'
            );
        }

        const durationMs =
            data.durationMinutes * 60 * 1000;

        const elapsed =
            Date.now() - data.startedAt;

        const percent =
            Math.min(
                100,
                Math.max(
                    0,
                    elapsed / durationMs * 100
                )
            );

        const fonts = await loadFonts();

        const svg = progressSvg(
            percent,
            data.durationMinutes,
            fonts
        );

        const image = await sharp(
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
            'Unable to generate progress image.'
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