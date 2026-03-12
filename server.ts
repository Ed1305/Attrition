import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase Client Initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

import nodemailer from "nodemailer";

async function getSMTPSettings() {
  try {
    const { data: settings, error } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !settings) {
      return {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 587),
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      };
    }

    return {
      host: settings.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(settings.smtp_port || process.env.SMTP_PORT || 587),
      user: settings.smtp_user || process.env.SMTP_USER,
      pass: settings.smtp_pass || process.env.SMTP_PASS,
    };
  } catch (err) {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }
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
    await supabase.from('reminders').insert({ period });
  } catch (error) {
    console.error("Failed to send reminder email:", error);
  }
}

async function checkAndSendReminders() {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Check if report exists for current period
  const { data: report } = await supabase
    .from('reports')
    .select('id')
    .eq('period', currentPeriod)
    .single();
  
  if (!report) {
    // Check if reminder already sent
    const { data: reminder } = await supabase
      .from('reminders')
      .select('id')
      .eq('period', currentPeriod)
      .single();

    if (!reminder) {
      await sendReminderEmail(currentPeriod);
    }
  }
}

async function createServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) });
  });

  // Run reminder check on start and every 12 hours
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    checkAndSendReminders().catch(err => console.error("Initial reminder check failed:", err));
    if (process.env.NODE_ENV !== "production") {
      setInterval(checkAndSendReminders, 12 * 60 * 60 * 1000);
    }
  } else {
    console.warn("Supabase not configured. Reminders and database features will not work.");
  }

  // API Routes
  app.get("/api/status/current-month", async (req, res) => {
    try {
      const now = new Date();
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { data: report } = await supabase
        .from('reports')
        .select('id')
        .eq('period', currentPeriod)
        .single();
      res.json({ hasReport: !!report, period: currentPeriod });
    } catch (err) {
      res.status(500).json({ error: "Failed to check status" });
    }
  });

  app.get("/api/reports", async (req, res) => {
    try {
      const { data: reports, error } = await supabase
        .from('reports')
        .select('id, fileName, period, createdAt')
        .order('createdAt', { ascending: false });
      
      if (error) throw error;
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.get("/api/reports/:id", async (req, res) => {
    try {
      const { data: report, error } = await supabase
        .from('reports')
        .select('*')
        .eq('id', req.params.id)
        .single();

      if (error || !report) return res.status(404).json({ error: "Report not found" });
      
      res.json({
        ...report,
        data: typeof report.data === 'string' ? JSON.parse(report.data) : report.data
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch report" });
    }
  });

  app.post("/api/reports", async (req, res) => {
    try {
      const { fileName, period, data } = req.body;
      
      const insertData: any = {
        fileName,
        period,
        data: data,
      };

      const { data: newReport, error } = await supabase
        .from('reports')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error("Supabase Insert Error:", error);
        throw error;
      }
      res.json({ id: newReport.id });
    } catch (err: any) {
      console.error("API Error /api/reports:", err);
      res.status(500).json({ error: "Failed to save report", message: err.message });
    }
  });

  app.delete("/api/reports/:id", async (req, res) => {
    try {
      const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', req.params.id);
      
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete report" });
    }
  });

  app.delete("/api/reports-purge/all", async (req, res) => {
    try {
      // Note: Purge all might require a different approach in Supabase depending on RLS
      const { error } = await supabase
        .from('reports')
        .delete()
        .neq('id', 0); // Delete all where id != 0
      
      if (error) throw error;
      res.json({ success: true, message: "All reports purged successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to purge reports" });
    }
  });

  // Settings Routes
  app.get("/api/settings", async (req, res) => {
    try {
      const { data: settings, error } = await supabase
        .from('settings')
        .select('smtp_host, smtp_port, smtp_user, smtp_pass')
        .eq('id', 1)
        .single();
      
      if (error) throw error;
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const { smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;
      const { error } = await supabase
        .from('settings')
        .upsert({ 
          id: 1,
          smtp_host, 
          smtp_port, 
          smtp_user, 
          smtp_pass, 
          updatedAt: new Date().toISOString() 
        });
      
      if (error) throw error;
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

  return app;
}

// Start server
const startServer = async () => {
  const app = await createServer();
  const PORT = process.env.PORT || 3000;
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
};

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  startServer();
}

// Export for Vercel
export default createServer;
