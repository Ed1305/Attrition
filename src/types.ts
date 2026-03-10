export interface EmployeeRecord {
  empCode: string;
  employeeName: string;
  startDate: string;
  team: string;
  baseTeam: string;
  status: string;
  category: 'ACTIVE' | 'AWOL' | 'RESIGNED' | 'DROPPED_OUT' | 'TERMINATED' | 'OTHER';
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

export interface SavedReport {
  id: number;
  fileName: string;
  period: string;
  data: ProcessedReport;
  createdAt: string;
}

export interface ReportSummary {
  id: number;
  fileName: string;
  period: string;
  createdAt: string;
}
