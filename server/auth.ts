import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const ADMIN_COOKIE = 'ak_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function sessionSecret(): string {
  // A dedicated secret is preferred; falling back to the passcode keeps the
  // setup to a single variable for small deployments.
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSCODE || '';
}

export function authConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE);
}

function sign(value: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function createSessionToken(now = Date.now()): string {
  const expiresAt = String(now + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || !sessionSecret()) return false;
  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature) return false;

  const expected = sign(expiresAt);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

/** Constant-time passcode comparison (hashed first so lengths always match). */
export function checkPasscode(passcode: unknown): boolean {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || typeof passcode !== 'string') return false;
  const given = crypto.createHash('sha256').update(passcode).digest();
  const want = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(given, want);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export function isAdminRequest(req: Request): boolean {
  return verifySessionToken(parseCookies(req.headers.cookie)[ADMIN_COOKIE]);
}

/**
 * Guards every mutating route. The old build shipped the passcode to the
 * browser and trusted a localStorage flag; authorisation now lives here.
 */
export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!authConfigured()) {
    res.status(503).json({ error: 'Admin login is not configured', detail: 'Set ADMIN_PASSCODE on the server.' });
    return;
  }
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: 'Admin login required' });
    return;
  }
  next();
};

/** Very small in-memory throttle for the login endpoint. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginThrottled(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export function resetLoginAttempts(ip: string): void {
  attempts.delete(ip);
}
