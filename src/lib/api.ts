import type { HealthResponse, ProcessedReport, ReportSummary, TrendPoint } from '../types';

export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init.headers,
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const payload = (body ?? {}) as { error?: string; detail?: string };
    throw new ApiError(payload.error ?? `Request failed (${res.status})`, res.status, payload.detail);
  }
  return body as T;
}

export const listReports = () => api<ReportSummary[]>('/api/reports');

export const getReport = async (id: string) => {
  const payload = await api<{ data?: ProcessedReport; period?: string } & ProcessedReport>(`/api/reports/${id}`);
  // The server returns both `data` (legacy) and a flattened report.
  const report = payload.data ?? (payload as ProcessedReport);
  return { report, period: payload.period };
};

export const listTrends = () => api<TrendPoint[]>('/api/trends');

export const health = async (): Promise<HealthResponse | null> => {
  try {
    // /api/health answers 503 when Postgres is unreachable but still returns
    // the diagnostics we want to display, so read the body regardless.
    const res = await fetch('/api/health', { credentials: 'same-origin' });
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
};

export const saveReport = (input: { fileName: string; period: string; data: ProcessedReport; warnings?: string[] }) =>
  api<{ id: string; replaced: boolean }>('/api/reports', { method: 'POST', body: JSON.stringify(input) });

export const deleteReport = (id: string) => api<{ success: boolean }>(`/api/reports/${id}`, { method: 'DELETE' });

export const purgeReports = () => api<{ success: boolean; removed: number }>('/api/reports-purge/all', { method: 'DELETE' });

export const adminSession = () => api<{ authenticated: boolean; configured: boolean }>('/api/admin/session');

export const adminLogin = (passcode: string) =>
  api<{ authenticated: boolean }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ passcode }) });

export const adminLogout = () => api<{ authenticated: boolean }>('/api/admin/logout', { method: 'POST' });
