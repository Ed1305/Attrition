/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight, 
  FileText, 
  History, 
  BookOpen, 
  HelpCircle, 
  Trash2, 
  ExternalLink,
  Calendar,
  Save,
  Menu,
  X,
  User,
  MessageCircle,
  Settings,
  ShieldCheck,
  RefreshCw,
  BarChart3,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { EmployeeRecord, ProcessedReport, ReportSummary, SavedReport } from './types';

type Tab = 'dashboard' | 'upload' | 'history' | 'documentation' | 'support' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [report, setReport] = useState<ProcessedReport | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [missingReport, setMissingReport] = useState<{ hasReport: boolean, period: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    fetchHistory();
    checkMonthlyStatus();
  }, []);

  const handleLogin = () => {
    if (passcode === 'ak_2026!') {
      setIsAdmin(true);
      setShowLoginModal(false);
      setPasscode('');
    } else {
      alert('Incorrect passcode');
    }
  };

  const logout = () => {
    setIsAdmin(false);
    if (['upload', 'settings'].includes(activeTab)) {
      setActiveTab('dashboard');
    }
  };

  const checkMonthlyStatus = async () => {
    try {
      const res = await fetch('/api/status/current-month');
      if (res.ok) {
        const data = await res.json();
        setMissingReport(data);
      }
    } catch (err) {
      console.error("Failed to check monthly status", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error("Failed to fetch history", err);
    }
  };

  const loadReportFromHistory = async (id: number) => {
    try {
      setIsProcessing(true);
      const res = await fetch(`/api/reports/${id}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.data);
        setSelectedPeriod(data.period);
        
        const branches = Array.from(new Set(data.data.records.map((r: any) => r.branch)));
        if (branches.length > 0) {
          setSelectedBranch(branches[0]);
        }
        
        setShowSummary(true);
        setActiveTab('upload');
      }
    } catch (err) {
      setError("Failed to load report from history");
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteReport = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      isOpen: true,
      title: 'Delete Report',
      message: 'Are you sure you want to delete this report? This action cannot be undone.',
      isDanger: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
          if (res.ok) {
            fetchHistory();
            checkMonthlyStatus();
          }
        } catch (err) {
          console.error("Failed to delete report", err);
        }
      }
    });
  };

  const purgeHistory = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Purge All History',
      message: 'Are you sure you want to delete ALL historical reports? This action is permanent and cannot be undone.',
      isDanger: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/reports-purge/all', { method: 'DELETE' });
          if (res.ok) {
            fetchHistory();
            checkMonthlyStatus();
          }
        } catch (err) {
          console.error("Failed to purge history", err);
        }
      }
    });
  };

  const saveReport = async () => {
    if (!report) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: report.fileName,
          period: selectedPeriod,
          data: report
        })
      });
      if (res.ok) {
        fetchHistory();
        checkMonthlyStatus();
        alert("Report saved successfully to history!");
      }
    } catch (err) {
      setError("Failed to save report");
    } finally {
      setIsSaving(false);
    }
  };

  const processExcel = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      
      const allRecords: EmployeeRecord[] = [];
      let globalAttendanceColumns: string[] = [];

      const sheetsToProcess = [
        { name: 'INVNT CAPE TOWN', branch: 'INVNT CAPE TOWN' },
        { name: 'ALPHA', branch: 'ALPHA' }
      ];

      for (const sheetInfo of sheetsToProcess) {
        const actualSheetName = workbook.SheetNames.find(
          name => name.trim().toUpperCase() === sheetInfo.name.toUpperCase()
        );
        
        if (!actualSheetName) continue;

        const worksheet = workbook.Sheets[actualSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
        
        let headerRowIdx = -1;
        for (let i = 0; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (row && row.some(cell => String(cell).toUpperCase().includes('EMP CODE'))) {
            headerRowIdx = i;
            break;
          }
        }

        if (headerRowIdx === -1) continue;

        const headerRow = jsonData[headerRowIdx];
        const subHeaderRow = jsonData[headerRowIdx + 1] || [];
        
        const empCodeIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('EMP CODE'));
        const nameIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('EMPLOYEE NAME'));
        const startIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('START DATE'));
        const teamColIdx = headerRow.findIndex((h: any) => {
          const s = String(h).toUpperCase();
          return s === 'TEAM' || s === 'TEAM NAME' || s.includes('TEAM');
        });
        const managerIdx = headerRow.findIndex((h: any) => String(h).toUpperCase().includes('MANAGER'));
        const termIdx = headerRow.findIndex((h: any) => {
          const s = String(h).toUpperCase();
          return s.includes('TERMINATE') || s.includes('TERMINATION');
        });

        const startDayIdx = subHeaderRow.findIndex(h => String(h).trim() === '26');
        let endDayIdx = -1;
        if (startDayIdx !== -1) {
          for (let j = startDayIdx; j < subHeaderRow.length; j++) {
            if (String(subHeaderRow[j]).trim() === '25') {
              endDayIdx = j;
              break;
            }
          }
        }

        const attendanceHeaders: string[] = [];
        if (startDayIdx !== -1 && endDayIdx !== -1) {
          for (let j = startDayIdx; j <= endDayIdx; j++) {
            const day = String(subHeaderRow[j]).trim();
            const weekday = String(headerRow[j] || '').trim();
            attendanceHeaders.push(`${weekday}(${day})`);
          }
        }

        if (globalAttendanceColumns.length === 0) {
          globalAttendanceColumns = attendanceHeaders;
        }

        let currentTeam = '';
        let lastBaseTeam = '';
        
        const isAlpha = sheetInfo.branch === 'ALPHA';
        const baseTeams = isAlpha 
          ? ['TEAM AYABONGA', 'TEAM ISIPHO', 'TEAM KHAYALETHU', 'TEAM THANDUXOLO', 'ALPHA INCUBATION']
          : ['TEAM PROSPER', 'TEAM SONWABILE', 'TEAM MOSES', 'INVNT INCUBATION', 'NOMBEKO'];
        
        const targetTeams = isAlpha
          ? ['TEAM AYABONGA', 'TEAM ISIPHO', 'TEAM KHAYALETHU', 'TEAM THANDUXOLO', 'ALPHA INCUBATION', 'RESIGNED EMPLOYEES', 'AWOL EMPLOYEES', 'DROPPED OUT INCUBATION', 'TERMINATED']
          : ['TEAM PROSPER', 'TEAM SONWABILE', 'TEAM MOSES', 'INVNT INCUBATION', 'RESIGNED EMPLOYEES', 'AWOLEMPLOYEES', 'AWOL EMPLOYEES', 'AWOL', 'DROPPED OUT TRAINING/INCUBATION', 'TERMINATED', 'NOMBEKO'];

        const excludedValues = [
          'FAILED PRACTICAL\'S', 'TEMPORARY LAID OFF', 'MATERNITY LEAVE', 
          'EMPLOYEE CODE', 'EMPLOYEE NAME', 'START DATE', 'TERMINATION DATE'
        ];

        for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const empCode = String(row[empCodeIdx] || '').trim();
          const empName = String(row[nameIdx] || '').trim();
          const rowString = row.join(' ').toUpperCase();
          
          const foundTeam = targetTeams.find(team => rowString.includes(team));
          if (foundTeam && (empCode === '' || empCode.toUpperCase() === 'EMPLOYEE CODE')) {
            currentTeam = foundTeam;
            const upperFound = foundTeam.toUpperCase();
            if (baseTeams.includes(upperFound)) {
              lastBaseTeam = upperFound === 'NOMBEKO' ? 'INVNT INCUBATION' : upperFound;
            }
            continue;
          }

          const nameAsTeam = targetTeams.find(team => empName.toUpperCase() === team);
          if (nameAsTeam && (empCode === '' || empCode.toUpperCase() === 'EMPLOYEE CODE')) {
            currentTeam = nameAsTeam;
            const upperNameTeam = nameAsTeam.toUpperCase();
            if (baseTeams.includes(upperNameTeam)) {
              lastBaseTeam = upperNameTeam === 'NOMBEKO' ? 'INVNT INCUBATION' : upperNameTeam;
            }
            continue;
          }

          if (currentTeam && empCode !== '' && empName !== '') {
            const upperEmpCode = empCode.toUpperCase();
            const upperEmpName = empName.toUpperCase();

            if (upperEmpCode === 'EMPLOYEE CODE' || upperEmpName === 'EMPLOYEE NAME') continue;
            if (excludedValues.some(val => upperEmpName.includes(val.toUpperCase()))) continue;
            if (targetTeams.some(team => upperEmpName === team)) continue;

            const isInactive = currentTeam.toUpperCase().includes('RESIGNED') || 
                              currentTeam.toUpperCase().includes('AWOL') ||
                              currentTeam.toUpperCase().includes('DROPPED') ||
                              currentTeam.toUpperCase().includes('TERMINATED');
            
            const status = isInactive ? 'INACTIVE' : 'ACTIVE';
            
            let category: EmployeeRecord['category'] = 'ACTIVE';
            if (currentTeam.toUpperCase().includes('RESIGNED')) category = 'RESIGNED';
            else if (currentTeam.toUpperCase().includes('AWOL')) category = 'AWOL';
            else if (currentTeam.toUpperCase().includes('DROPPED')) category = 'DROPPED_OUT';
            else if (currentTeam.toUpperCase().includes('TERMINATED')) category = 'TERMINATED';

            let baseTeam = '';
            
            // Branch specific team mapping
            if (isAlpha) {
              if (rowString.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
              else if (rowString.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
              else if (rowString.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
              else if (rowString.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
              else if (rowString.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
            } else {
              if (rowString.includes('MOSES')) baseTeam = 'TEAM MOSES';
              else if (rowString.includes('PROSPER')) baseTeam = 'TEAM PROSPER';
              else if (rowString.includes('SONWABILE')) baseTeam = 'TEAM SONWABILE';
              else if (rowString.includes('INCUBATION') || rowString.includes('NOMBEKO')) baseTeam = 'INVNT INCUBATION';
            }

            if (!baseTeam && teamColIdx !== -1) {
              const teamFromCol = String(row[teamColIdx] || '').toUpperCase();
              if (teamFromCol) {
                if (isAlpha) {
                  if (teamFromCol.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
                  else if (teamFromCol.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
                  else if (teamFromCol.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
                  else if (teamFromCol.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
                  else if (teamFromCol.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
                } else {
                  if (teamFromCol.includes('NOMBEKO')) baseTeam = 'INVNT INCUBATION';
                  else if (teamFromCol.includes('MOSES')) baseTeam = 'TEAM MOSES';
                  else if (teamFromCol.includes('PROSPER')) baseTeam = 'TEAM PROSPER';
                  else if (teamFromCol.includes('SONWABILE')) baseTeam = 'TEAM SONWABILE';
                  else if (teamFromCol.includes('INCUBATION')) baseTeam = 'INVNT INCUBATION';
                }
              }
            }

            // Manager column logic for ALPHA inactive employees
            if (isAlpha && isInactive && !baseTeam && managerIdx !== -1) {
              const managerName = String(row[managerIdx] || '').toUpperCase();
              if (managerName) {
                if (managerName.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
                else if (managerName.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
                else if (managerName.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
                else if (managerName.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
                else if (managerName.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
              }
            }

            if (!baseTeam) {
              if (category === 'ACTIVE') {
                baseTeam = currentTeam.toUpperCase();
                if (!isAlpha && baseTeam === 'NOMBEKO') baseTeam = 'INVNT INCUBATION';
              } else {
                baseTeam = lastBaseTeam || 'UNASSIGNED';
              }
            }

            // Normalizing baseTeam names
            if (isAlpha) {
              if (baseTeam.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
              else if (baseTeam.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
              else if (baseTeam.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
              else if (baseTeam.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
              else if (baseTeam.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
            } else {
              if (baseTeam.includes('MOSES')) baseTeam = 'TEAM MOSES';
              else if (baseTeam.includes('PROSPER')) baseTeam = 'TEAM PROSPER';
              else if (baseTeam.includes('SONWABILE')) baseTeam = 'TEAM SONWABILE';
              else if (baseTeam.includes('INCUBATION')) baseTeam = 'INVNT INCUBATION';
              else if (baseTeam.includes('NOMBEKO')) baseTeam = 'INVNT INCUBATION';
            }

            let displayTeam = currentTeam;
            if (category === 'RESIGNED') displayTeam = 'RESIGNED EMP.';
            else if (category === 'AWOL') displayTeam = 'AWOL EMP.';
            else if (category === 'DROPPED_OUT') displayTeam = 'DROPPED OUT';
            else if (category === 'TERMINATED') displayTeam = 'TERMINATED';
            
            const attendance: Record<string, number | string> = {};
            if (startDayIdx !== -1 && endDayIdx !== -1) {
              for (let j = startDayIdx; j <= endDayIdx; j++) {
                const header = attendanceHeaders[j - startDayIdx];
                const val = row[j];
                const isPresent = val === 1 || String(val).trim() === '1' || String(val).trim().toUpperCase() === 'P';
                attendance[header] = isPresent ? 1 : (val || 0);
              }
            }

            const rawEndDate = row[termIdx];
            const formattedEndDate = isInactive 
              ? (rawEndDate ? (typeof rawEndDate === 'number' ? new Date(Math.round((rawEndDate - 25569) * 86400 * 1000)).toLocaleDateString() : String(rawEndDate)) : 'N/A')
              : 'Not Applicable';

            allRecords.push({
              empCode: empCode,
              employeeName: empName,
              startDate: row[startIdx] ? (typeof row[startIdx] === 'number' ? new Date(Math.round((row[startIdx] - 25569) * 86400 * 1000)).toLocaleDateString() : String(row[startIdx])) : 'N/A',
              team: displayTeam,
              baseTeam: baseTeam,
              status: status,
              category: category,
              basedHeadcount: status,
              endDate: formattedEndDate,
              attendance,
              branch: sheetInfo.branch
            });
          }
        }
      }

      if (allRecords.length === 0) {
        throw new Error(`Could not find valid data in "INVNT CAPE TOWN" or "ALPHA" sheets.`);
      }

      setReport({
        fileName: file.name,
        records: allRecords,
        attendanceColumns: globalAttendanceColumns
      });
      
      const branches = Array.from(new Set(allRecords.map(r => r.branch)));
      if (branches.length > 0) {
        setSelectedBranch(branches[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process Excel file');
    } finally {
      setIsProcessing(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      processExcel(file);
    } else {
      setError('Please upload a valid Excel file (.xlsx or .xls)');
    }
  }, []);

  const downloadReport = () => {
    if (!report) return;
    const exportData = report.records.map(r => ({
      'EMPLOYEE CODE': r.empCode,
      'EMPLOYEE NAME': r.employeeName,
      'START DATE': r.startDate,
      'TEAM': r.team,
      'STATUS': r.status,
      'TERMINATION DATE': r.endDate,
      ...r.attendance
    }));
    const totals: any = { 'EMPLOYEE CODE': 'TOTAL' };
    report.attendanceColumns.forEach(col => {
      totals[col] = report.records.reduce((sum, r) => sum + (Number(r.attendance[col]) || 0), 0);
    });
    exportData.push(totals);
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attrition Report");
    XLSX.writeFile(wb, `Attrition_Report_${selectedPeriod}.xlsx`);
  };

  return (
    <div className="flex h-screen bg-mesh text-[#1A1A1A] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "gradient-sidebar border-r border-white/5 transition-all duration-300 flex flex-col z-50 text-white/70",
        isSidebarOpen ? "w-64" : "w-20"
      )}>
        <div className="p-6 flex items-center justify-between border-b border-white/5">
          {isSidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#5A7D4A] to-[#7A9D6A] rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-[#5A7D4A]/20">A</div>
              <span className="font-bold tracking-tight text-sm text-white">Alpha Konnect</span>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white">
            {isSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <NavItem 
            icon={<FileText size={18} />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            collapsed={!isSidebarOpen}
          />
          {isAdmin && (
            <NavItem 
              icon={<Upload size={18} />} 
              label="Upload & Report" 
              active={activeTab === 'upload'} 
              onClick={() => setActiveTab('upload')} 
              collapsed={!isSidebarOpen}
            />
          )}
          <NavItem 
            icon={<History size={18} />} 
            label="History" 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')} 
            collapsed={!isSidebarOpen}
          />
          <NavItem 
            icon={<BookOpen size={18} />} 
            label="Documentation" 
            active={activeTab === 'documentation'} 
            onClick={() => setActiveTab('documentation')} 
            collapsed={!isSidebarOpen}
          />
          <NavItem 
            icon={<HelpCircle size={18} />} 
            label="Support" 
            active={activeTab === 'support'} 
            onClick={() => setActiveTab('support')} 
            collapsed={!isSidebarOpen}
          />
          {isAdmin && (
            <NavItem 
              icon={<Settings size={18} />} 
              label="Settings" 
              active={activeTab === 'settings'} 
              onClick={() => setActiveTab('settings')} 
              collapsed={!isSidebarOpen}
            />
          )}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-2">
          <button
            onClick={isAdmin ? logout : () => setShowLoginModal(true)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-xs uppercase tracking-tight",
              isAdmin ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white",
              !isSidebarOpen && "justify-center px-0"
            )}
          >
            {isAdmin ? <ShieldCheck size={18} /> : <Settings size={18} />}
            {isSidebarOpen && (isAdmin ? "Admin Access" : "Admin Login")}
          </button>
          
          <div className={cn("flex items-center gap-3 p-2 rounded-xl bg-white/5", !isSidebarOpen && "justify-center")}>
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white">
              <User size={16} />
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-widest text-white/40">System User</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 md:p-12">
        <div className="max-w-6xl mx-auto space-y-8">
          {missingReport && !missingReport.hasReport && activeTab === 'upload' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }}
              className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg text-amber-700">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-900">Missing Monthly Data</h4>
                  <p className="text-xs text-amber-700">You haven't uploaded the attrition data for {new Date(missingReport.period + '-01').toLocaleString('en-GB', { month: 'long', year: 'numeric' })} yet.</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedPeriod(missingReport.period);
                  document.getElementById('file-upload')?.click();
                }}
                className="bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-amber-700 transition-all shadow-lg shadow-amber-600/20"
              >
                Upload Now
              </button>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <DashboardView 
                history={history} 
                onLoadReport={loadReportFromHistory} 
                report={report}
                selectedPeriod={selectedPeriod}
                selectedBranch={selectedBranch}
                setSelectedBranch={setSelectedBranch}
                showSummary={showSummary}
                setShowSummary={setShowSummary}
                downloadReport={downloadReport}
                saveReport={saveReport}
                isSaving={isSaving}
                setReport={setReport}
              />
            )}
            {activeTab === 'upload' && isAdmin && (
              <motion.div key="upload" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-black/10 pb-4 mb-8">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight gradient-text">Attrition Report</h1>
                    <p className="text-[10px] text-black/50 mt-1 uppercase tracking-widest font-bold">Mission Control / Data Processor</p>
                  </div>
                  {report && (
                    <div className="flex flex-col md:flex-row gap-4 items-center">
                      <div className="flex bg-white/5 p-1 rounded-full border border-black/5">
                        {Array.from(new Set(report.records.map(r => r.branch))).map(branch => (
                          <button
                            key={branch}
                            onClick={() => setSelectedBranch(branch)}
                            className={cn(
                              "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                              selectedBranch === branch ? "bg-black text-white shadow-lg" : "text-black/40 hover:text-black"
                            )}
                          >
                            {branch}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={saveReport}
                        disabled={isSaving}
                        className="flex items-center gap-2 border border-black/10 bg-white text-black px-4 py-2 rounded-full hover:bg-black/5 transition-all text-xs font-bold"
                      >
                        <Save size={14} />
                        {isSaving ? "Saving..." : "Save to History"}
                      </button>
                      <button
                        onClick={() => setShowSummary(!showSummary)}
                        className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-full hover:bg-black/80 transition-all text-xs font-bold shadow-lg shadow-black/10"
                      >
                        <FileText size={14} />
                        {showSummary ? "Show Data Table" : "Process"}
                      </button>
                      <button
                        onClick={downloadReport}
                        className="flex items-center gap-2 border border-black/10 bg-white text-black px-4 py-2 rounded-full hover:bg-black/5 transition-all text-xs font-bold"
                      >
                        <Download size={14} />
                        Export
                      </button>
                    </div>
                  </div>
                )}
              </header>

                {!report ? (
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4">
                      <div className="p-3 bg-black/5 rounded-xl text-black">
                        <Calendar size={20} />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-black/40 block mb-1">Select Report Period</label>
                        <input 
                          type="month" 
                          value={selectedPeriod}
                          onChange={(e) => setSelectedPeriod(e.target.value)}
                          className="bg-transparent border-none p-0 text-sm font-bold focus:ring-0 w-full"
                        />
                      </div>
                    </div>

                    <div
                      className={cn(
                        "relative group border-2 border-dashed rounded-3xl p-16 transition-all duration-300 flex flex-col items-center justify-center text-center cursor-pointer bg-white",
                        isDragging ? "border-black bg-black/5 scale-[0.99]" : "border-black/10 hover:border-black/30"
                      )}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={onDrop}
                      onClick={() => document.getElementById('file-upload')?.click()}
                    >
                      <input id="file-upload" type="file" className="hidden" accept=".xlsx, .xls" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) processExcel(file);
                      }} />
                      <div className="w-20 h-20 bg-black/5 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        {isProcessing ? <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Upload className="text-black" size={32} />}
                      </div>
                      <h2 className="text-2xl font-medium mb-2">{isProcessing ? "Processing File..." : "Upload Attrition Data"}</h2>
                      <p className="text-black/50 max-w-md">Drag and drop your Excel file here, or click to browse. Supported formats: .xlsx, .xls</p>
                      {error && (
                        <div className="mt-6 flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-full text-sm">
                          <AlertCircle size={16} />
                          {error}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Stats Bar */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <StatCard label="Total Records" value={report.records.length} />
                      <StatCard label="Active Staff" value={report.records.filter(r => r.status === 'ACTIVE').length} color="text-emerald-600" />
                      <StatCard label="Resigned" value={report.records.filter(r => r.category === 'RESIGNED').length} color="text-amber-600" />
                      <StatCard label="AWOL" value={report.records.filter(r => r.category === 'AWOL').length} color="text-red-600" />
                    </div>

                    {showSummary ? (
                      <SummaryReport report={report} period={selectedPeriod} branch={selectedBranch} />
                    ) : (
                      <DataTable report={report} branch={selectedBranch} onClear={() => setReport(null)} />
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <header className="border-b border-black/10 pb-4 mb-8 flex items-end justify-between">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight gradient-text">Report History</h1>
                    <p className="text-[10px] text-black/50 mt-1 uppercase tracking-widest font-bold">Saved Monthly Reports</p>
                  </div>
                  {history.length > 0 && (
                    <button 
                      onClick={purgeHistory}
                      className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-xl transition-all text-[10px] uppercase tracking-widest font-bold border border-red-100"
                    >
                      <Trash2 size={14} />
                      Purge All History
                    </button>
                  )}
                </header>
                
                <div className="grid grid-cols-1 gap-4">
                  {history.length === 0 ? (
                    <div className="glass-card p-12 rounded-3xl text-center space-y-4">
                      <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto text-black/20">
                        <History size={32} />
                      </div>
                      <p className="text-black/40 font-bold uppercase tracking-widest text-xs">No saved reports found</p>
                    </div>
                  ) : (
                    history.map(item => (
                      <div 
                        key={item.id} 
                        onClick={() => loadReportFromHistory(item.id)}
                        className="glass-card p-6 rounded-2xl hover:border-[#5A7D4A]/30 transition-all cursor-pointer flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-gradient-to-br from-[#5A7D4A]/10 to-[#7A9D6A]/10 rounded-xl text-[#5A7D4A]">
                            <FileSpreadsheet size={24} />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm">{item.fileName}</h3>
                            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold text-black/40 mt-1">
                              <span>Period: {item.period}</span>
                              <span className="w-1 h-1 bg-black/10 rounded-full" />
                              <span>Saved: {new Date(item.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={(e) => deleteReport(item.id, e)}
                            className="p-2 text-black/20 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                          <ChevronRight className="text-black/20 group-hover:text-[#5A7D4A] group-hover:translate-x-1 transition-all" size={20} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'documentation' && <DocumentationView />}
            {activeTab === 'support' && <SupportView />}
            {activeTab === 'settings' && <SettingsView />}
          </AnimatePresence>
        </div>
      </main>

      <ConfirmModal 
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        isDanger={confirmModal.isDanger}
        onConfirm={() => {
          confirmModal.onConfirm();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Login Modal */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLoginModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative glass-card rounded-[32px] shadow-2xl w-full max-w-sm overflow-hidden p-8"
            >
              <div className="w-12 h-12 bg-[#5A7D4A]/10 text-[#5A7D4A] rounded-2xl flex items-center justify-center mb-6">
                <ShieldCheck size={24} />
              </div>
              <h3 className="text-xl font-bold text-black mb-2">Admin Access</h3>
              <p className="text-xs text-black/50 mb-6 font-bold uppercase tracking-widest">Enter passcode to unlock full access</p>
              
              <div className="space-y-4">
                <input 
                  type="password" 
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Enter passcode"
                  autoFocus
                  className="w-full bg-black/5 border-none rounded-xl p-4 text-center font-mono tracking-widest focus:ring-2 focus:ring-[#5A7D4A]/20 transition-all"
                />
                <button 
                  onClick={handleLogin}
                  className="w-full bg-black text-white p-4 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-black/80 transition-all shadow-lg shadow-black/10"
                >
                  Unlock System
                </button>
                <button 
                  onClick={() => setShowLoginModal(false)}
                  className="w-full text-black/40 p-2 font-bold text-[10px] uppercase tracking-widest hover:text-black transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DashboardView({ 
  history, 
  onLoadReport, 
  report, 
  selectedPeriod, 
  selectedBranch, 
  setSelectedBranch,
  showSummary,
  setShowSummary,
  downloadReport,
  saveReport,
  isSaving,
  setReport
}: { 
  history: ReportSummary[], 
  onLoadReport: (id: number) => void,
  report: ProcessedReport | null,
  selectedPeriod: string,
  selectedBranch: string,
  setSelectedBranch: (b: string) => void,
  showSummary: boolean,
  setShowSummary: (s: boolean) => void,
  downloadReport: () => void,
  saveReport: () => void,
  isSaving: boolean,
  setReport: (r: ProcessedReport | null) => void
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-black/10 pb-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">System Dashboard</h1>
          <p className="text-[10px] text-black/50 mt-1 uppercase tracking-widest font-bold">Real-time Attrition Overview</p>
        </div>
        
        {report && (
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="flex bg-white/5 p-1 rounded-full border border-black/5">
              {Array.from(new Set(report.records.map(r => r.branch))).map(branch => (
                <button
                  key={branch}
                  onClick={() => setSelectedBranch(branch)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                    selectedBranch === branch ? "bg-black text-white shadow-lg" : "text-black/40 hover:text-black"
                  )}
                >
                  {branch}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={saveReport}
                disabled={isSaving}
                className="flex items-center gap-2 border border-black/10 bg-white text-black px-4 py-2 rounded-full hover:bg-black/5 transition-all text-xs font-bold"
              >
                <Save size={14} />
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setShowSummary(!showSummary)}
                className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-full hover:bg-black/80 transition-all text-xs font-bold shadow-lg shadow-black/10"
              >
                <FileText size={14} />
                {showSummary ? "Data Table" : "Summary"}
              </button>
              <button
                onClick={downloadReport}
                className="flex items-center gap-2 border border-black/10 bg-white text-black px-4 py-2 rounded-full hover:bg-black/5 transition-all text-xs font-bold"
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </div>
        )}
      </header>

      {report ? (
        <div className="space-y-6">
          {showSummary ? (
            <SummaryReport report={report} period={selectedPeriod} branch={selectedBranch} />
          ) : (
            <DataTable report={report} branch={selectedBranch} onClear={() => setReport(null)} />
          )}
        </div>
      ) : (
        <>
          <div className="glass-card p-8 rounded-[32px]">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-xl font-bold">Recent Reports</h2>
                <p className="text-[10px] text-black/50 uppercase tracking-widest font-bold">Quick access to latest data</p>
              </div>
              <div className="p-2 bg-black/5 rounded-xl">
                <History size={18} className="text-black/40" />
              </div>
            </div>

            {history.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-black/5 rounded-2xl">
                <p className="text-xs font-bold uppercase tracking-widest text-black/20">No reports available yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {history.slice(0, 6).map(item => (
                  <button
                    key={item.id}
                    onClick={() => onLoadReport(item.id)}
                    className="flex flex-col items-start p-5 rounded-2xl bg-black/[0.02] hover:bg-black/[0.05] border border-black/5 transition-all text-left group"
                  >
                    <div className="flex items-center justify-between w-full mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#5A7D4A]">{item.period}</span>
                      <ChevronRight size={14} className="text-black/20 group-hover:translate-x-1 transition-transform" />
                    </div>
                    <h4 className="font-bold text-sm truncate w-full">{item.fileName}</h4>
                    <p className="text-[9px] text-black/40 mt-1 uppercase tracking-widest font-bold">View Summary</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

function NavItem({ icon, label, active, onClick, collapsed }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, collapsed: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-xs uppercase tracking-tight",
        active ? "bg-gradient-to-r from-[#5A7D4A] to-[#7A9D6A] text-white shadow-lg shadow-[#5A7D4A]/20" : "text-white/40 hover:bg-white/5 hover:text-white",
        collapsed && "justify-center px-0"
      )}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function StatCard({ label, value, color = "text-black" }: { label: string, value: number | string, color?: string }) {
  return (
    <div className="glass-card p-4 rounded-xl">
      <p className="text-[9px] uppercase tracking-wider text-black/40 font-bold mb-1">{label}</p>
      <p className={cn("text-xl font-bold", color)}>{value}</p>
    </div>
  );
}

function SummaryReport({ report, period, branch }: { report: ProcessedReport, period: string, branch: string }) {
  const formattedPeriod = new Date(period + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).replace(/ /g, '-');
  
  // Ensure we have a branch if none is selected
  const activeBranch = branch || (report.records.length > 0 ? report.records[0].branch : '');
  const filteredRecords = report.records.filter(r => r.branch === activeBranch);
  
  const isAlpha = activeBranch === 'ALPHA';
  const teams = isAlpha 
    ? ['TEAM AYABONGA', 'TEAM ISIPHO', 'TEAM KHAYALETHU', 'TEAM THANDUXOLO', 'ALPHA INCUBATION']
    : ['TEAM MOSES', 'TEAM PROSPER', 'TEAM SONWABILE', 'INVNT INCUBATION'];

  const getTeamLabel = (t: string) => {
    if (t === 'INVNT INCUBATION' || t === 'ALPHA INCUBATION') return 'Incubation';
    return t.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };

  return (
    <div className="space-y-8 glass-card p-8 rounded-3xl">
      <div className="space-y-1 border-b border-black/10 pb-4">
        <h2 className="text-sm font-bold uppercase tracking-widest bg-[#5A7D4A] text-white px-3 py-1 inline-block">Detailed Attrition Report - {branch}</h2>
        <div className="flex items-center gap-4 text-xs font-bold">
          <span className="bg-[#5A7D4A] text-white px-3 py-1 uppercase tracking-widest">Period</span>
          <span className="border border-[#5A7D4A] px-4 py-1">{formattedPeriod}</span>
        </div>
      </div>

      {/* Data Integrity Warning */}
      {filteredRecords.some(r => r.baseTeam === 'UNASSIGNED') && (
        <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-center gap-3 text-amber-800">
          <AlertCircle size={18} />
          <div className="text-[10px] leading-tight">
            <p className="font-bold uppercase tracking-widest mb-1">Data Integrity Warning</p>
            <p>Some agents could not be automatically assigned to a team. They are marked as "UNASSIGNED" in the data table. Please check the Excel sheet structure.</p>
          </div>
        </div>
      )}

      {/* Section 1: Total Floor Team Report */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest bg-[#5A7D4A] text-white px-3 py-1 inline-block">Total Floor Team Report</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-black/[0.02]">
                <th className="p-2 border border-black/10 font-bold uppercase">TYPE</th>
                <th colSpan={teams.length + 1} className="p-2 border border-black/10"></th>
              </tr>
              <tr className="bg-black/[0.01]">
                <th className="p-2 border border-black/10 font-bold">Row Labels</th>
                {teams.map(t => (
                  <th key={t} className="p-2 border border-black/10 font-bold text-center bg-[#5A7D4A]/10">{getTeamLabel(t)}</th>
                ))}
                <th className="p-2 border border-black/10 font-bold text-center bg-[#5A7D4A]/20">Grand Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {(() => {
                const getCount = (t: string, cat: string) => filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category === cat).length;
                const rows = [
                  { label: 'Active', cat: 'ACTIVE' },
                  { label: 'AWOL EMPLOYEES', cat: 'AWOL' },
                  { label: 'RESIGNED EMPLOYEES', cat: 'RESIGNED' },
                  { label: 'Dropped Out Of Incubation', cat: 'DROPPED_OUT' },
                  { label: 'TERMINATION', cat: 'TERMINATED' }
                ];
                return (
                  <>
                    {rows.map(row => (
                      <tr key={row.label}>
                        <td className="p-2 border border-black/10 font-medium">{row.label}</td>
                        {teams.map(t => (<td key={t} className="p-2 border border-black/10 text-center">{getCount(t, row.cat)}</td>))}
                        <td className="p-2 border border-black/10 text-center font-bold bg-black/[0.02]">{filteredRecords.filter(r => r.category === row.cat).length}</td>
                      </tr>
                    ))}
                    <tr className="bg-black/[0.03] font-bold">
                      <td className="p-2 border border-black/10">Team Total From Register</td>
                      {teams.map(t => (
                        <td key={t} className="p-2 border border-black/10 text-center">
                          {filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length}
                        </td>
                      ))}
                      <td className="p-2 border border-black/10 text-center">{filteredRecords.filter(r => ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length}</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Total Floor Including Incubation */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest bg-[#5A7D4A] text-white px-3 py-1 inline-block">Total Floor Including Incubation</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-black/[0.01]">
                <th className="p-2 border border-black/10 font-bold">Type</th>
                {teams.map(t => (
                  <th key={t} className="p-2 border border-black/10 font-bold text-center bg-[#5A7D4A]/10">{getTeamLabel(t)}</th>
                ))}
                <th className="p-2 border border-black/10 font-bold text-center bg-[#5A7D4A]/10">Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                return (
                  <>
                    <tr>
                      <td className="p-2 border border-black/10 font-bold">Team Total From Register</td>
                      {teams.map(t => (
                        <td key={t} className="p-2 border border-black/10 text-center">
                          {filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length}
                        </td>
                      ))}
                      <td className="p-2 border border-black/10 text-center font-bold bg-black/[0.02]">{filteredRecords.filter(r => ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length}</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-black/10 font-bold">Resigned/Awol Staff/Terminated/Dropped Out Incubation</td>
                      {teams.map(t => (
                        <td key={t} className="p-2 border border-black/10 text-center">
                          {filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category !== 'ACTIVE').length}
                        </td>
                      ))}
                      <td className="p-2 border border-black/10 text-center font-bold bg-black/[0.02]">{filteredRecords.filter(r => r.category !== 'ACTIVE').length}</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-black/10 font-bold">Attrition rate(Team)</td>
                      {teams.map(t => {
                        const teamTotal = filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length;
                        const teamAttrition = filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category !== 'ACTIVE').length;
                        const rate = teamTotal > 0 ? (teamAttrition / teamTotal) * 100 : 0;
                        return (
                          <td key={t} className={cn("p-2 border border-black/10 text-center font-bold", rate > 10 ? "text-red-600" : "text-emerald-600")}>
                            {Math.round(rate)}%
                          </td>
                        );
                      })}
                      {(() => {
                        const totalFromRegister = filteredRecords.filter(r => ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length;
                        const totalAttrition = filteredRecords.filter(r => r.category !== 'ACTIVE').length;
                        const totalRate = totalFromRegister > 0 ? (totalAttrition / totalFromRegister) * 100 : 0;
                        return (
                          <td className={cn("p-2 border border-black/10 text-center font-bold bg-black/[0.02]", totalRate > 10 ? "text-red-600" : "text-emerald-600")}>
                            {Math.round(totalRate)}%
                          </td>
                        );
                      })()}
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Total Floor Excluding Incubation */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest bg-[#5A7D4A] text-white px-3 py-1 inline-block">Total Floor Excluding Incubation</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-black/[0.01]">
                <th className="p-2 border border-black/10 font-bold">Type</th>
                {teams.filter(t => !t.includes('INCUBATION')).map(t => (
                  <th key={t} className="p-2 border border-black/10 font-bold text-center bg-[#5A7D4A]/10">{getTeamLabel(t)}</th>
                ))}
                <th className="p-2 border border-black/10 font-bold text-center bg-[#5A7D4A]/10">Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filteredTeams = teams.filter(t => !t.includes('INCUBATION'));
                return (
                  <>
                    <tr>
                      <td className="p-2 border border-black/10 font-bold">Team Total From Register</td>
                      {filteredTeams.map(t => (
                        <td key={t} className="p-2 border border-black/10 text-center">
                          {filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length}
                        </td>
                      ))}
                      <td className="p-2 border border-black/10 text-center font-bold bg-black/[0.02]">{filteredRecords.filter(r => filteredTeams.some(t => r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length}</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-black/10 font-bold">Resigned/Awol Staff/Terminated</td>
                      {filteredTeams.map(t => (
                        <td key={t} className="p-2 border border-black/10 text-center">
                          {filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category !== 'ACTIVE').length}
                        </td>
                      ))}
                      <td className="p-2 border border-black/10 text-center font-bold bg-black/[0.02]">{filteredRecords.filter(r => filteredTeams.some(t => r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category !== 'ACTIVE').length}</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-black/10 font-bold">Attrition rate(Team)</td>
                      {filteredTeams.map(t => {
                        const teamTotal = filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length;
                        const teamAttrition = filteredRecords.filter(r => (r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category !== 'ACTIVE').length;
                        const rate = teamTotal > 0 ? (teamAttrition / teamTotal) * 100 : 0;
                        return (
                          <td key={t} className={cn("p-2 border border-black/10 text-center font-bold", rate > 10 ? "text-red-600" : "text-emerald-600")}>
                            {Math.round(rate)}%
                          </td>
                        );
                      })}
                      {(() => {
                        const totalFromRegister = filteredRecords.filter(r => filteredTeams.some(t => r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && ['ACTIVE', 'AWOL', 'RESIGNED'].includes(r.category)).length;
                        const totalAttrition = filteredRecords.filter(r => filteredTeams.some(t => r.baseTeam === t || r.baseTeam.includes(t.replace('TEAM ', ''))) && r.category !== 'ACTIVE').length;
                        const totalRate = totalFromRegister > 0 ? (totalAttrition / totalFromRegister) * 100 : 0;
                        return (
                          <td className={cn("p-2 border border-black/10 text-center font-bold bg-black/[0.02]", totalRate > 10 ? "text-red-600" : "text-emerald-600")}>
                            {Math.round(totalRate)}%
                          </td>
                        );
                      })()}
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DataTable({ report, branch, onClear }: { report: ProcessedReport, branch: string, onClear: () => void }) {
  const activeBranch = branch || (report.records.length > 0 ? report.records[0].branch : '');
  const filteredRecords = report.records.filter(r => r.branch === activeBranch);
  
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-3 border-b border-black/5 flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="text-black/40" size={16} />
          <span className="text-xs font-bold uppercase tracking-tight">{report.fileName} - {activeBranch}</span>
        </div>
        <button onClick={onClear} className="text-[9px] uppercase tracking-widest font-bold text-black/40 hover:text-black transition-colors">Clear</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-black/[0.02]">
              {['Employee Code', 'Employee Name', 'Start Date', 'Team', 'Status', 'Termination Date'].map(h => (
                <th key={h} className="p-1.5 text-[8px] uppercase tracking-widest font-bold text-black/40 border-b border-black/5">{h}</th>
              ))}
              {report.attendanceColumns.map(col => (
                <th key={col} className="p-1.5 text-[8px] uppercase tracking-widest font-bold text-black/40 border-b border-black/5 text-center">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filteredRecords.map((record, idx) => (
              <tr key={idx} className="hover:bg-black/[0.01] transition-colors group">
                <td className="p-1.5 text-[10px] font-mono text-black/60">{record.empCode}</td>
                <td className="p-1.5 text-[10px] font-bold">{record.employeeName}</td>
                <td className="p-1.5 text-[10px] text-black/60">{record.startDate}</td>
                <td className="p-1.5"><span className="px-1 py-0.5 rounded bg-black/5 text-[8px] text-black/60 uppercase font-bold tracking-tighter">{record.team}</span></td>
                <td className="p-1.5">
                  <span className={cn(
                    "inline-flex items-center gap-1 px-1 py-0.5 rounded-full font-bold uppercase text-[8px] tracking-tighter",
                    record.status === 'ACTIVE' ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  )}>
                    <span className={cn("w-1 h-1 rounded-full", record.status === 'ACTIVE' ? "bg-emerald-500" : "bg-amber-500")} />
                    {record.status}
                  </span>
                </td>
                <td className="p-1.5 text-[10px] text-black/60 italic">{record.endDate}</td>
                {report.attendanceColumns.map(col => (
                  <td key={col} className="p-1.5 text-[10px] text-center">
                    <span className={cn("inline-block w-3.5 h-3.5 leading-3.5 rounded text-[9px]", record.attendance[col] === 1 ? "bg-black text-white font-bold" : "text-black/10")}>
                      {record.attendance[col]}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-black/[0.05] font-bold">
              <td colSpan={6} className="p-1.5 text-[10px] text-right uppercase tracking-widest">Total Attendance</td>
              {report.attendanceColumns.map(col => (
                <td key={col} className="p-1.5 text-[10px] text-center">
                  {filteredRecords.reduce((sum, r) => sum + (Number(r.attendance[col]) || 0), 0)}
                </td>
              ))}
            </tr>
            <tr className="bg-black/[0.02] text-[8px] uppercase tracking-widest font-bold">
              <td colSpan={report.attendanceColumns.length + 6} className="p-2">
                <div className="flex gap-4 items-center">
                  <span>Summary:</span>
                  <span className="text-emerald-600">Active: {filteredRecords.filter(r => r.category === 'ACTIVE').length}</span>
                  <span className="text-amber-600">Resigned: {filteredRecords.filter(r => r.category === 'RESIGNED').length}</span>
                  <span className="text-red-600">AWOL: {filteredRecords.filter(r => r.category === 'AWOL').length}</span>
                  <span className="text-blue-600">Terminated: {filteredRecords.filter(r => r.category === 'TERMINATED').length}</span>
                  <span className="text-purple-600">Dropped Out: {filteredRecords.filter(r => r.category === 'DROPPED_OUT').length}</span>
                  {filteredRecords.some(r => r.baseTeam === 'UNASSIGNED') && (
                    <span className="text-red-500 animate-pulse">Unassigned: {filteredRecords.filter(r => r.baseTeam === 'UNASSIGNED').length}</span>
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function DocumentationView() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <header className="border-b border-black/10 pb-4">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Documentation</h1>
        <p className="text-[10px] text-black/50 mt-1 uppercase tracking-widest font-bold">How to use the application</p>
      </header>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <DocSection title="1. Data Preparation" icon={<FileSpreadsheet size={20} />}>
          <p>Ensure your Excel file contains a sheet named <span className="font-bold">"INVNT CAPE TOWN"</span>. The application specifically looks for this sheet to process data.</p>
          <p className="mt-2">Required columns include <span className="font-bold">"EMP CODE"</span>, <span className="font-bold">"EMPLOYEE NAME"</span>, and attendance data between columns <span className="font-bold">"26"</span> and <span className="font-bold">"25"</span>.</p>
        </DocSection>
        
        <DocSection title="2. Uploading & Processing" icon={<Upload size={20} />}>
          <p>Drag and drop your file into the upload zone or click to browse. Once uploaded, select the <span className="font-bold">Report Period</span> (Month/Year) to categorize the data accurately.</p>
          <p className="mt-2">Click the <span className="font-bold">"Process"</span> button to generate the summary report with attrition calculations.</p>
        </DocSection>

        <DocSection title="3. Understanding the Report" icon={<FileText size={20} />}>
          <p>The report is divided into three main sections:</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><span className="font-bold">Total Floor Team Report:</span> Detailed breakdown of Active, AWOL, and Resigned staff by team.</li>
            <li><span className="font-bold">Attrition Rate:</span> Calculated as (Inactive / Total Register) × 100.</li>
            <li><span className="font-bold">Color Coding:</span> Red indicates attrition &gt; 10%, Green indicates &le; 10%.</li>
          </ul>
        </DocSection>

        <DocSection title="4. Scalability & History" icon={<History size={20} />}>
          <p>Use the <span className="font-bold">"Save to History"</span> button to store your processed reports in the database. This allows you to view historical data for each month without re-uploading files.</p>
          <p className="mt-2">Access saved reports anytime via the <span className="font-bold">History</span> tab in the sidebar.</p>
        </DocSection>
      </div>
    </motion.div>
  );
}

function DocSection({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <div className="glass-card p-6 rounded-3xl space-y-4">
      <div className="flex items-center gap-3 text-[#5A7D4A]">
        <div className="p-2 bg-gradient-to-br from-[#5A7D4A]/10 to-[#7A9D6A]/10 rounded-lg">{icon}</div>
        <h3 className="font-bold text-sm uppercase tracking-tight">{title}</h3>
      </div>
      <div className="text-xs leading-relaxed text-black/60">{children}</div>
    </div>
  );
}

function SupportView() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto text-center space-y-8 py-12">
      <div className="w-24 h-24 bg-gradient-to-br from-[#5A7D4A]/10 to-[#7A9D6A]/10 rounded-full flex items-center justify-center mx-auto text-[#5A7D4A] shadow-xl shadow-[#5A7D4A]/5">
        <HelpCircle size={48} />
      </div>
      
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight gradient-text">Need Assistance?</h1>
        <p className="text-black/50 font-bold uppercase tracking-widest text-[10px]">Technical Support & Development</p>
      </div>

      <div className="glass-card p-8 rounded-[40px] space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold gradient-text">Technical Support</h2>
          <p className="text-sm text-black/60">Systems Development & Support</p>
          <p className="text-xs font-bold uppercase tracking-widest text-[#5A7D4A]">@Alpha Konnect</p>
        </div>

        <div className="pt-6 border-t border-black/5">
          <a 
            href="https://wa.me/27844727319" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 bg-gradient-to-r from-[#25D366] to-[#128C7E] text-white px-8 py-4 rounded-full font-bold hover:scale-105 transition-all shadow-lg shadow-[#25D366]/20"
          >
            <MessageCircle size={20} />
            Contact via WhatsApp
            <ExternalLink size={14} />
          </a>
        </div>

        <div className="pt-6 border-t border-black/5 text-left space-y-4">
          <div className="flex items-center gap-2 text-[#5A7D4A]">
            <CheckCircle2 size={16} />
            <h3 className="text-xs font-bold uppercase tracking-widest">Automated Reminder System</h3>
          </div>
          <p className="text-[10px] text-black/60 leading-relaxed">
            The system automatically checks for missing monthly reports every 12 hours. If a report for the current month is missing, an email reminder is sent to <span className="font-bold">EdenKabamba10@gmail.com</span>.
          </p>
          <div className="bg-[#5A7D4A]/5 p-3 rounded-xl border border-[#5A7D4A]/10">
            <p className="text-[9px] text-[#5A7D4A] font-bold uppercase tracking-tighter">Configuration Required</p>
            <p className="text-[9px] text-black/40 mt-1">SMTP credentials must be configured in the environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS) for emails to be delivered.</p>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-black/30 uppercase tracking-widest font-bold">Available for system updates, bug fixes, and custom feature requests.</p>
    </motion.div>
  );
}

function SettingsView() {
  const [settings, setSettings] = useState({
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: ''
  });
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message });
      } else {
        throw new Error(data.message || 'Verification failed');
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-8">
      <header className="border-b border-black/10 pb-4">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">System Settings</h1>
        <p className="text-[10px] text-black/50 mt-1 uppercase tracking-widest font-bold">Configure automated reminder emails</p>
      </header>

      <div className="glass-card p-8 rounded-[40px] space-y-6">
        <div className="flex items-center gap-3 text-[#5A7D4A] mb-4">
          <div className="p-2 bg-gradient-to-br from-[#5A7D4A]/10 to-[#7A9D6A]/10 rounded-lg">
            <ShieldCheck size={20} />
          </div>
          <h3 className="font-bold text-sm uppercase tracking-tight">SMTP Configuration</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">SMTP Host</label>
            <input 
              type="text" 
              value={settings.smtp_host}
              onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
              placeholder="smtp.gmail.com"
              className="w-full bg-black/5 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#5A7D4A]/20 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">SMTP Port</label>
            <input 
              type="number" 
              value={settings.smtp_port}
              onChange={(e) => setSettings({ ...settings, smtp_port: parseInt(e.target.value) })}
              placeholder="587"
              className="w-full bg-black/5 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#5A7D4A]/20 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">SMTP User (Email)</label>
            <input 
              type="email" 
              value={settings.smtp_user}
              onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
              placeholder="your-email@gmail.com"
              className="w-full bg-black/5 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#5A7D4A]/20 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">SMTP Password / App Password</label>
            <input 
              type="password" 
              value={settings.smtp_pass}
              onChange={(e) => setSettings({ ...settings, smtp_pass: e.target.value })}
              placeholder="••••••••••••••••"
              className="w-full bg-black/5 border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-[#5A7D4A]/20 transition-all"
            />
          </div>
        </div>

        {message && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }} 
            animate={{ opacity: 1, height: 'auto' }}
            className={cn(
              "p-4 rounded-2xl text-xs font-medium flex items-center gap-3",
              message.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
            )}
          >
            {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {message.text}
          </motion.div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <button
            onClick={handleTest}
            disabled={isTesting || isSaving}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-black/10 text-black px-6 py-3 rounded-2xl font-bold text-xs hover:bg-black/5 transition-all disabled:opacity-50"
          >
            {isTesting ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Test Connection
          </button>
          <button
            onClick={handleSave}
            disabled={isTesting || isSaving}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-[#5A7D4A] to-[#3D5432] text-white px-6 py-3 rounded-2xl font-bold text-xs hover:scale-[1.02] transition-all shadow-lg shadow-[#5A7D4A]/20 disabled:opacity-50"
          >
            {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            Save Settings
          </button>
        </div>

        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
          <p className="text-[10px] text-amber-800 leading-relaxed">
            <span className="font-bold">Pro Tip:</span> If using Gmail, you must enable 2-Step Verification and generate an <span className="font-bold">App Password</span> to use as your SMTP password. Standard account passwords will be blocked for security.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onClose, 
  isDanger 
}: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  onConfirm: () => void, 
  onClose: () => void,
  isDanger?: boolean
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative glass-card rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-8">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center mb-6",
                isDanger ? "bg-red-50 text-red-600" : "bg-black/5 text-black"
              )}>
                {isDanger ? <AlertCircle size={24} /> : <HelpCircle size={24} />}
              </div>
              <h3 className="text-xl font-medium text-black mb-2">{title}</h3>
              <p className="text-sm text-black/50 leading-relaxed">{message}</p>
            </div>
            <div className="flex border-t border-black/5">
              <button 
                onClick={onClose}
                className="flex-1 px-6 py-4 text-xs font-bold uppercase tracking-widest text-black/40 hover:bg-black/5 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={onConfirm}
                className={cn(
                  "flex-1 px-6 py-4 text-xs font-bold uppercase tracking-widest transition-all",
                  isDanger ? "bg-red-600 text-white hover:bg-red-700" : "bg-black text-white hover:bg-black/80"
                )}
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
