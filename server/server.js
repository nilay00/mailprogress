const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const sharp = require("sharp");

const app = express();

const PORT = Number(process.env.PORT) || 3001;
const BASE_URL = (
  process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");

const allowedOrigins = [
  "https://mail-progress.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const SMTP_READY = Boolean(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

const transporter = SMTP_READY
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const records = new Map();

function getProgress(record) {
  const elapsed = Math.max(0, Date.now() - record.startedAt);
  const ratio = Math.min(1, elapsed / record.durationMs);

  return {
    percent: Math.round(ratio * 1000) / 10,
    done: ratio >= 1,
  };
}

function progressSvg(percent) {
  const width = 560;
  const height = 28;
  const fillWidth = Math.round((width * percent) / 100);

  return `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="${width}" height="${height}"
         viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}"
            rx="14" fill="#e2e8f0"/>
      <rect width="${fillWidth}" height="${height}"
            rx="14" fill="#0f766e"/>
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

app.post("/api/send-email", async (req, res) => {
  const { to, subject, durationMinutes } = req.body || {};
  const minutes = Number(durationMinutes);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || "")) {
    return res.status(400).json({ error: "Enter a valid recipient email." });
  }

  if (!subject || !String(subject).trim()) {
    return res.status(400).json({ error: "Enter a subject." });
  }

  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    return res.status(400).json({
      error: "Duration must be between 0 and 1440 minutes.",
    });
  }

  if (!SMTP_READY) {
    return res.status(500).json({
      error: "SMTP is not configured on the server.",
    });
  }

  const record = {
    id: crypto.randomUUID(),
    to,
    subject: String(subject).trim(),
    startedAt: Date.now(),
    durationMs: minutes * 60000,
  };

  records.set(record.id, record);

	const imageUrl =
  	`${BASE_URL}/api/progress/${record.id}/image.png?v=${Date.now()}`;

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;">
        <table role="presentation" width="600" align="center"
               cellpadding="0" cellspacing="0"
               style="background:#ffffff;">
          <tr>
            <td style="padding:24px 20px 8px;font-size:20px;font-weight:bold;color:#0f172a;">
              ${escapeHtml(record.subject)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 12px;font-size:14px;color:#475569;">
              Progress started. Expected duration: ${minutes} minutes.
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px;">
              <img src="${imageUrl}"
                   width="560" height="28"
                   alt="Progress bar"
                   style="display:block;width:100%;max-width:560px;height:28px;border:0;">
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: record.to,
      subject: record.subject,
      html,
      text: `${record.subject} - view this email in an HTML-capable email client.`,
    });

    return res.json({
      success: true,
      imageUrl,
    });
  } catch (error) {
    records.delete(record.id);
    console.error("Email send failed:", error.message);

    return res.status(500).json({
      error: "Failed to send email.",
    });
  }
});

app.get("/api/progress/:id/image.png", async (req, res) => {
  try {
    const record = records.get(req.params.id);

    if (!record) {
      return res.status(404).send("Progress record not found.");
    }

    const { percent } = getProgress(record);

    const png = await sharp(
      Buffer.from(progressSvg(percent))
    ).png().toBuffer();

    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });

    return res.send(png);
  } catch (error) {
    console.error("Image generation failed:", error.message);
    return res.status(500).send("Could not generate progress image.");
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = app;