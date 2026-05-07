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

async function createServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) });
  });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Supabase not configured. Database features will not work.");
  }

  // API Routes
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
