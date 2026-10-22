let express = require("express");
let cors = require("cors");
let crypto = require("crypto");
let nodemailer = require("nodemailer");
let sharp = require("sharp");

let app = express();

let PORT = Number(process.env.PORT) || 3001;
let BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

let allowedOrigins = [
  "https://mail-progress.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173"
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

let transporter = process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS ?
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  }) :
  null;

let records = new Map();

function getProgress(record) {
  let elapsed = Math.max(0, Date.now() - record.startedAt);
  let ratio = Math.min(1, elapsed / record.durationMs);

  return {
    percent: Math.round(ratio * 1000) / 10,
    done: ratio >= 1
  };
}

function progressSvg(percent) {
  let width = 560;
  let height = 28;
  let fillWidth = Math.round(width * percent / 100);

  return `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="${width}"
         height="${height}"
         viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="14" fill="#e2e8f0"/>
      <rect width="${fillWidth}" height="${height}" rx="14" fill="#0f766e"/>
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  } [char]));
}

app.post("/api/send-email", async (req, res) => {
  let {
    to,
    subject,
    durationMinutes
  } = req.body || {};
  let minutes = Number(durationMinutes);

  let record = {
    id: crypto.randomUUID(),
    to,
    subject: String(subject).trim(),
    startedAt: Date.now(),
    durationMs: minutes * 60000
  };

  records.set(record.id, record);

  let imageUrl = `${BASE_URL}/api/progress/${record.id}/image.png?v=${Date.now()}`;

  let html = `
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
                   width="560"
                   height="28"
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
      text: `${record.subject} - view this email in an HTML-capable email client.`
    });

    res.json({
      success: true,
      imageUrl
    });
  } catch (error) {
    console.error("Email sending failed:", error.message);
  }
});

app.get("/api/progress/:id/image.png", async (req, res) => {
  let record = records.get(req.params.id);

  if (!record) {
    return res.status(404).send("Progress record not found.");
  }

  let {
    percent
  } = getProgress(record);

  try {
    let png = await sharp(Buffer.from(progressSvg(percent)))
      .png()
      .toBuffer();

    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "X-Content-Type-Options": "nosniff"
    });

    res.send(png);
  } catch (error) {
    console.error("Image generation failed:", error.message);
    res.status(500).send("Could not generate progress image.");
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = app;