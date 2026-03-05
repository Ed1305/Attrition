import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("attrition.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fileName TEXT,
    period TEXT,
    data TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT UNIQUE,
    sentAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    smtp_host TEXT,
    smtp_port INTEGER,
    smtp_user TEXT,
    smtp_pass TEXT,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Initialize default settings if not exists
  INSERT OR IGNORE INTO settings (id, smtp_host, smtp_port, smtp_user, smtp_pass)
  VALUES (1, 'smtp.gmail.com', 587, '', '');
`);

import nodemailer from "nodemailer";

async function getSMTPSettings() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
  return {
    host: settings?.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(settings?.smtp_port || process.env.SMTP_PORT || 587),
    user: settings?.smtp_user || process.env.SMTP_USER,
    pass: settings?.smtp_pass || process.env.SMTP_PASS,
  };
}

async function sendReminderEmail(period: string) {
  const settings = await getSMTPSettings();
  
  if (!settings.user || !settings.pass) {
    console.log("SMTP settings not configured, skipping reminder email.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
  });

  const [year, month] = period.split('-');
  const monthName = new Date(Number(year), Number(month) - 1).toLocaleString('en-GB', { month: 'long' });

  try {
    await transporter.sendMail({
      from: `"Attrition System" <${settings.user}>`,
      to: "EdenKabamba10@gmail.com",
      subject: `Reminder: Upload Attrition Data for ${monthName} ${year}`,
      text: `Hello,\n\nThis is a reminder to upload the monthly attrition data for ${monthName} ${year} to ensure up-to-date reporting.\n\nRegards,\nAttrition System`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #5A7D4A;">Monthly Attrition Reminder</h2>
          <p>Hello,</p>
          <p>This is a reminder to upload the monthly attrition data for <strong>${monthName} ${year}</strong> to ensure up-to-date reporting.</p>
          <p>Please log in to the system and upload the Excel file as soon as possible.</p>
          <br />
          <p style="font-size: 12px; color: #999;">Regards,<br />Attrition System</p>
        </div>
      `,
    });
    console.log(`Reminder email sent for ${period}`);
    db.prepare("INSERT INTO reminders (period) VALUES (?)").run(period);
  } catch (error) {
    console.error("Failed to send reminder email:", error);
  }
}

async function checkAndSendReminders() {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Check if report exists for current period
  const report = db.prepare("SELECT id FROM reports WHERE period = ?").get(currentPeriod);
  
  if (!report) {
    // Check if reminder already sent
    const reminder = db.prepare("SELECT id FROM reminders WHERE period = ?").get(currentPeriod);
    if (!reminder) {
      await sendReminderEmail(currentPeriod);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Run reminder check on start and every 12 hours
  checkAndSendReminders();
  setInterval(checkAndSendReminders, 12 * 60 * 60 * 1000);

  // API Routes
  app.get("/api/status/current-month", (req, res) => {
    try {
      const now = new Date();
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const report = db.prepare("SELECT id FROM reports WHERE period = ?").get(currentPeriod);
      res.json({ hasReport: !!report, period: currentPeriod });
    } catch (err) {
      res.status(500).json({ error: "Failed to check status" });
    }
  });
  app.get("/api/reports", (req, res) => {
    try {
      const reports = db.prepare("SELECT id, fileName, period, createdAt FROM reports ORDER BY createdAt DESC").all();
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.get("/api/reports/:id", (req, res) => {
    try {
      const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      res.json({
        ...report,
        data: JSON.parse(report.data as string)
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch report" });
    }
  });

  app.post("/api/reports", (req, res) => {
    try {
      const { fileName, period, data } = req.body;
      const info = db.prepare("INSERT INTO reports (fileName, period, data) VALUES (?, ?, ?)").run(
        fileName,
        period,
        JSON.stringify(data)
      );
      res.json({ id: info.lastInsertRowid });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save report" });
    }
  });

  app.delete("/api/reports/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete report" });
    }
  });

  app.delete("/api/reports-purge/all", (req, res) => {
    try {
      db.prepare("DELETE FROM reports").run();
      res.json({ success: true, message: "All reports purged successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to purge reports" });
    }
  });

  // Settings Routes
  app.get("/api/settings", (req, res) => {
    try {
      const settings = db.prepare("SELECT smtp_host, smtp_port, smtp_user, smtp_pass FROM settings WHERE id = 1").get();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", (req, res) => {
    try {
      const { smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;
      db.prepare(`
        UPDATE settings 
        SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, updatedAt = CURRENT_TIMESTAMP 
        WHERE id = 1
      `).run(smtp_host, smtp_port, smtp_user, smtp_pass);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.post("/api/settings/test", async (req, res) => {
    try {
      const { smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;
      
      const transporter = nodemailer.createTransport({
        host: smtp_host,
        port: Number(smtp_port),
        secure: Number(smtp_port) === 465,
        auth: {
          user: smtp_user,
          pass: smtp_pass,
        },
        connectionTimeout: 10000, // 10 seconds timeout
      });

      await transporter.verify();
      res.json({ success: true, message: "SMTP connection verified successfully!" });
    } catch (err: any) {
      console.error("SMTP Test failed:", err);
      res.status(400).json({ 
        error: "SMTP Verification Failed", 
        message: err.message || "Could not connect to SMTP server. Please check your credentials and server details." 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
