export type EmployeeCategory = 'ACTIVE' | 'AWOL' | 'RESIGNED' | 'DROPPED_OUT' | 'TERMINATED' | 'OTHER';

export interface EmployeeRecord {
  empCode: string;
  employeeName: string;
  startDate: string;
  team: string;
  baseTeam: string;
  status: string;
  category: EmployeeCategory;
  basedHeadcount: string;
  endDate: string;
  attendance: Record<string, number | string>;
  branch: string;
}

export interface ProcessedReport {
  fileName: string;
  records: EmployeeRecord[];
  attendanceColumns: string[];
}

/** Row shape returned by GET /api/reports (Neon `report_overview` view). */
export interface ReportSummary {
  id: string;
  fileName: string;
  period: string;
  source: string;
  createdAt: string;
  records: number;
  active: number;
  awol: number;
  resigned: number;
  droppedOut: number;
  terminated: number;
  inactive: number;
}

/** Row shape returned by GET /api/trends (Neon `period_trend` view). */
export interface TrendPoint {
  period: string;
  records: number;
  active: number;
  inactive: number;
  lastSaved: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: { configured: boolean; connected: boolean; error?: string };
  admin: { configured: boolean };
  storage: string;
}
