import express, { type NextFunction, type Request, type Response } from 'express';
import {
  authConfigured,
  checkPasscode,
  clearSessionCookie,
  createSessionToken,
  isAdminRequest,
  loginThrottled,
  requireAdmin,
  resetLoginAttempts,
  sessionCookie,
} from './auth.ts';
import { DatabaseNotConfiguredError, getDb, pingDatabase } from './db.ts';
import {
  deleteReport,
  getReport,
  getTrends,
  listReports,
  NotFoundError,
  purgeReports,
  saveReport,
  ValidationError,
} from './repo.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppOptions {
  /** Mount Vite/static middleware is handled by the caller (server.ts). */
  jsonLimit?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: options.jsonLimit ?? '12mb' }));

  // ---------------------------------------------------------------------
  // Health / capability
  // ---------------------------------------------------------------------
  app.get('/api/health', async (_req, res) => {
    const db = await pingDatabase();
    res.status(db.ok ? 200 : 503).json({
      status: db.ok ? 'ok' : 'degraded',
      database: {
        configured: Boolean(process.env.DATABASE_URL),
        connected: db.ok,
        error: db.ok ? undefined : db.error,
      },
      admin: { configured: authConfigured() },
      storage: 'neon',
    });
  });

  // ---------------------------------------------------------------------
  // Admin session (cookie based)
  // ---------------------------------------------------------------------
  app.get('/api/admin/session', (req, res) => {
    res.json({ authenticated: isAdminRequest(req), configured: authConfigured() });
  });

  app.post('/api/admin/login', (req, res) => {
    if (!authConfigured()) {
      res.status(503).json({ error: 'Admin login is not configured', detail: 'Set ADMIN_PASSCODE on the server.' });
      return;
    }
    const ip = req.ip ?? 'unknown';
    if (loginThrottled(ip)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }
    if (!checkPasscode(req.body?.passcode)) {
      res.status(401).json({ error: 'Incorrect passcode' });
      return;
    }
    resetLoginAttempts(ip);
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken()));
    res.json({ authenticated: true });
  });

  app.post('/api/admin/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ authenticated: false });
  });

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------
  app.get('/api/reports', async (_req, res, next) => {
    try {
      res.json(await listReports(getDb()));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/trends', async (_req, res, next) => {
    try {
      res.json(await getTrends(getDb()));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/reports/:id', async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        res.status(400).json({ error: 'Invalid report id' });
        return;
      }
      const stored = await getReport(getDb(), req.params.id);
      if (!stored) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }
      // `data` wrapper kept for backwards compatibility with older clients.
      res.json({ id: req.params.id, period: stored.period, data: stored.report, ...stored.report });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/reports', requireAdmin, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const data = typeof body.data === 'string' ? JSON.parse(body.data) : body.data ?? body;
      const records = data?.records;
      const attendanceColumns = data?.attendanceColumns ?? body.attendanceColumns ?? [];

      const result = await saveReport(getDb(), {
        fileName: body.fileName ?? data?.fileName ?? 'unknown.xlsx',
        period: String(body.period ?? ''),
        records,
        attendanceColumns,
        source: body.source ?? 'upload',
        warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/reports/:id', requireAdmin, async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        res.status(400).json({ error: 'Invalid report id' });
        return;
      }
      await deleteReport(getDb(), req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/reports-purge/all', requireAdmin, async (_req, res, next) => {
    try {
      const removed = await purgeReports(getDb());
      res.json({ success: true, removed });
    } catch (err) {
      next(err);
    }
  });

  // Unknown /api/* must be JSON, not the SPA shell (this is why the old
  // Settings screen silently received HTML with a 200).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API route' });
  });

  // ---------------------------------------------------------------------
  // Error mapping
  // ---------------------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof DatabaseNotConfiguredError) {
      res.status(503).json({ error: 'Database not configured', detail: err.message });
      return;
    }
    if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Upload payload too large' });
      return;
    }
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
