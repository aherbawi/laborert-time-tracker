import { useState, useEffect, useMemo, MouseEvent } from 'react';
import { Calendar as CalendarIcon, Clock, Coffee, Trash2, PlusCircle, ChevronLeft, ChevronRight, ArrowLeft, History, Sun, Moon, Download, Settings, Flag, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WorkLog } from './types';

const getLocalDateString = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseLocalDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  const [view, setView] = useState<'calendar' | 'entry' | 'settings' | 'export'>('calendar');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(getLocalDateString());
  
  const [exportStartDate, setExportStartDate] = useState(() => {
    const d = new Date();
    return getLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [exportEndDate, setExportEndDate] = useState(() => {
    const d = new Date();
    return getLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  });
  
  const [defaultStartTime, setDefaultStartTime] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('defaultStartTime') || '08:00';
    return '08:00';
  });
  const [defaultEndTime, setDefaultEndTime] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('defaultEndTime') || '17:00';
    return '17:00';
  });
  const [defaultBreakMinutes, setDefaultBreakMinutes] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('defaultBreakMinutes') || '60';
    return '60';
  });
  const [payPeriodStartDay, setPayPeriodStartDay] = useState(() => {
    if (typeof window !== 'undefined') return parseInt(localStorage.getItem('payPeriodStartDay') || '1', 10);
    return 1;
  });

  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [breakMinutes, setBreakMinutes] = useState<string>(defaultBreakMinutes);
  const [logs, setLogs] = useState<WorkLog[]>([]);

  useEffect(() => {
    localStorage.setItem('defaultStartTime', defaultStartTime);
  }, [defaultStartTime]);

  useEffect(() => {
    localStorage.setItem('defaultEndTime', defaultEndTime);
  }, [defaultEndTime]);

  useEffect(() => {
    localStorage.setItem('defaultBreakMinutes', defaultBreakMinutes);
  }, [defaultBreakMinutes]);

  useEffect(() => {
    localStorage.setItem('payPeriodStartDay', payPeriodStartDay.toString());
  }, [payPeriodStartDay]);

  // Apply dark mode theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Load history on mount
  useEffect(() => {
    const saved = localStorage.getItem('work_logs');
    if (saved) {
      try {
        setLogs(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse logs", e);
      }
    }
  }, []);

  // Save history when logs change
  useEffect(() => {
    localStorage.setItem('work_logs', JSON.stringify(logs));
  }, [logs]);

  const calculateHours = (start: string, end: string, brk: number) => {
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    let startMinutes = sH * 60 + sM;
    let endMinutes = eH * 60 + eM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return Math.max(0, (endMinutes - startMinutes - brk) / 60);
  };

  const handleSave = () => {
    const brk = parseInt(breakMinutes) || 0;
    const total = calculateHours(startTime, endTime, brk);
    const standard = calculateHours(defaultStartTime, defaultEndTime, parseInt(defaultBreakMinutes) || 0);
    const ot = Math.max(0, total - standard);
    
    const newLog: WorkLog = {
      id: crypto.randomUUID(),
      date: selectedDate,
      startTime,
      endTime,
      breakMinutes: brk,
      totalHours: Number(total.toFixed(2)),
      overtimeHours: Number(ot.toFixed(2)),
      timestamp: Date.now()
    };
    setLogs(prev => [newLog, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setBreakMinutes(defaultBreakMinutes);
    setView('calendar');
  };

  const deleteLog = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setLogs(prev => prev.filter(log => log.id !== id));
  };

  const exportCSV = () => {
    const filteredLogs = logs.filter(log => log.date >= exportStartDate && log.date <= exportEndDate);
    if (filteredLogs.length === 0) {
      alert("No logs found in this date range.");
      return;
    }
    const headers = ["Date", "Start Time", "End Time", "Break (Min)", "Total Hours", "Overtime Hours"];
    const csvContent = [
      headers.join(","),
      ...filteredLogs.map(log => `${log.date},${log.startTime},${log.endTime},${log.breakMinutes},${log.totalHours},${log.overtimeHours || 0}`)
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `work_logs_${exportStartDate}_to_${exportEndDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const importCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim() !== '');
      if (lines.length <= 1) return; // Only header or empty
      
      const importedLogs: WorkLog[] = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 5) {
          const [date, startTime, endTime, breakMinutes, totalHours, overtimeHours] = parts;
          
          importedLogs.push({
            id: crypto.randomUUID(),
            date,
            startTime,
            endTime,
            breakMinutes: parseInt(breakMinutes) || 0,
            totalHours: parseFloat(totalHours) || 0,
            overtimeHours: parseFloat(overtimeHours || '0') || 0,
            timestamp: Date.now() + i
          });
        }
      }
      
      setLogs(prev => {
         const newLogsList = [...prev];
         for (const ilog of importedLogs) {
             if (!newLogsList.some(l => l.date === ilog.date && l.startTime === ilog.startTime && l.endTime === ilog.endTime)) {
                 newLogsList.push(ilog);
             }
         }
         return newLogsList.sort((a, b) => b.date.localeCompare(a.date));
      });
      alert('Import successful!');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Calendar Logic
  const daysInMonth = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= totalDays; i++) {
        const d = new Date(year, month, i);
        days.push(getLocalDateString(d));
    }
    return days;
  }, [currentMonth]);

  const changeMonth = (offset: number) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
  };

  const openDate = (dateString: string) => {
    setSelectedDate(dateString);
    setStartTime(defaultStartTime);
    setEndTime(defaultEndTime);
    setBreakMinutes(defaultBreakMinutes);
    setView('entry');
  };

  const logsByDate = useMemo(() => {
    return logs.reduce((acc, log) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
    }, {} as Record<string, WorkLog[]>);
  }, [logs]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      <div className="max-w-xl mx-auto p-4 md:p-8 space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg">
              <Clock size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Work Tracker</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Manage your shifts</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                title="Toggle Dark Mode"
            >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {view === 'calendar' && (
              <>
                <input 
                  type="file" 
                  accept=".csv" 
                  id="csv-import"
                  className="hidden"
                  onChange={importCSV}
                />
                <button 
                    onClick={() => document.getElementById('csv-import')?.click()}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                    title="Import CSV"
                >
                    <Upload size={20} />
                </button>
                <button 
                    onClick={() => setView('export')}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                    title="Export CSV"
                >
                    <Download size={20} />
                </button>
              </>
            )}
            {view === 'calendar' && (
              <button 
                  onClick={() => setView('settings')}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                  title="Settings"
              >
                  <Settings size={20} />
              </button>
            )}
            {(view === 'entry' || view === 'settings' || view === 'export') && (
              <button 
                  onClick={() => setView('calendar')}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
              >
                  <ArrowLeft size={18} />
                  <span className="hidden md:inline">Back</span>
              </button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {view === 'calendar' ? (
            <motion.div 
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Month Selector */}
              <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                  <ChevronLeft size={20} />
                </button>
                <h2 className="text-lg font-bold capitalize">
                  {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </h2>
                <button onClick={() => changeMonth(1)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                  <ChevronRight size={20} />
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-700">
                <div className="grid grid-cols-7 border-b border-slate-50 dark:border-slate-700/50">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                    <div key={idx} className="py-3 text-center text-[10px] uppercase tracking-widest font-black text-slate-400 dark:text-slate-500">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {daysInMonth.map((dateStr, idx) => {
                    const isToday = dateStr === getLocalDateString();
                    const isCycleStart = dateStr && parseLocalDate(dateStr).getDate() === payPeriodStartDay;
                    const dayLogs = dateStr ? logsByDate[dateStr] : [];
                    const totalForDay = dayLogs?.reduce((sum, l) => sum + l.totalHours, 0);

                    return (
                      <div 
                        key={idx} 
                        onClick={() => dateStr && openDate(dateStr)}
                        className={`
                            relative h-20 md:h-24 p-2 border-r border-b border-slate-50 dark:border-slate-700/50 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors
                            ${!dateStr ? 'bg-slate-50/50 dark:bg-slate-800/50 text-transparent' : ''}
                            ${isToday ? 'bg-indigo-50/30 dark:bg-indigo-900/20' : ''}
                        `}
                      >
                        {dateStr && (
                          <>
                            <span className={`text-sm font-semibold ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}>
                              {parseLocalDate(dateStr).getDate()}
                            </span>
                            {isCycleStart && (
                                <div className="absolute top-2 right-2 text-amber-500" title="Cycle Start">
                                    <Flag size={14} className="fill-amber-500" />
                                </div>
                            )}
                            {dayLogs && dayLogs.length > 0 && (
                              <div className="mt-1 space-y-1">
                                <div className="text-[10px] font-bold text-indigo-500 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/50 px-1 rounded inline-block">
                                  {totalForDay.toFixed(1)}h
                                </div>
                                <div className="flex gap-0.5 flex-wrap">
                                  {dayLogs.map((_, i) => (
                                    <div key={i} className="w-1.5 h-1.5 bg-indigo-400 dark:bg-indigo-500 rounded-full" />
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Simple Stats */}
              {(() => {
                  let startDayToUse = payPeriodStartDay;
                  // Handle cases where the month doesn't have the start day (e.g., Feb 30) - JS Date handles this somewhat, but let's just make it robust.
                  const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), startDayToUse);
                  const cycleStartDateStr = getLocalDateString(d);
                  
                  const dEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, startDayToUse);
                  const cycleEndDateStr = getLocalDateString(dEnd);
                  
                  const endDisplayD = new Date(dEnd.getTime() - 86400000);

                  const totalThisCycle = logs
                      .filter(l => l.date >= cycleStartDateStr && l.date < cycleEndDateStr)
                      .reduce((sum, l) => sum + l.totalHours, 0)
                      .toFixed(1);

                  return (
                      <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg shadow-indigo-200 dark:shadow-none relative overflow-hidden">
                        <div className="relative z-10">
                            <p className="text-indigo-100 text-xs font-semibold uppercase tracking-wider mb-1">
                                Cycle Total ({d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - {endDisplayD.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
                            </p>
                            <p className="text-4xl font-black">
                                {totalThisCycle}
                                <span className="text-sm ml-2 font-normal opacity-70">Hours</span>
                            </p>
                        </div>
                        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                            <History size={80} />
                        </div>
                      </div>
                  );
              })()}
            </motion.div>
          ) : view === 'entry' ? (
            <motion.div 
              key="entry"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              {/* Data Entry Card */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none p-6 md:p-8 border border-slate-100 dark:border-slate-700 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 dark:opacity-10 pointer-events-none">
                    <CalendarIcon size={120} className="text-slate-900 dark:text-slate-100" />
                </div>
                
                <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2 relative z-10">
                    {parseLocalDate(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                  <div className="space-y-2 text-left">
                    <label className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300 gap-2">
                      <Coffee size={16} className="text-indigo-500 dark:text-indigo-400" />
                      Break (Minutes)
                    </label>
                    <input 
                      type="number" 
                      placeholder="0"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(e.target.value)}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Start Time</label>
                        <input 
                        type="time" 
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">End Time</label>
                        <input 
                        type="time" 
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                  </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-50 dark:border-slate-700/50 flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
                  <div className="text-center md:text-left">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] font-black">Day Total</p>
                    <div className="flex items-baseline justify-center md:justify-start gap-2">
                        <p className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                          {calculateHours(startTime, endTime, parseInt(breakMinutes) || 0).toFixed(2)} <span className="text-lg font-bold">Hrs</span>
                        </p>
                        {calculateHours(startTime, endTime, parseInt(breakMinutes) || 0) > calculateHours(defaultStartTime, defaultEndTime, parseInt(defaultBreakMinutes) || 0) && (
                          <span className="text-sm font-bold text-amber-500">
                            (+{(calculateHours(startTime, endTime, parseInt(breakMinutes) || 0) - calculateHours(defaultStartTime, defaultEndTime, parseInt(defaultBreakMinutes) || 0)).toFixed(2)} OT)
                          </span>
                        )}
                    </div>
                  </div>
                  <button 
                    onClick={handleSave}
                    className="group w-full md:w-auto inline-flex items-center justify-center gap-3 px-10 py-5 bg-indigo-600 text-white font-black rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform"
                  >
                    <PlusCircle size={24} />
                    Add Entry
                  </button>
                </div>
              </div>

              {/* History for this specific day */}
              {logsByDate[selectedDate] && logsByDate[selectedDate].length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 px-2">Logs for this day</h4>
                  <div className="space-y-3">
                    {logsByDate[selectedDate].map((log) => (
                      <div key={log.id} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 flex items-center justify-between shadow-sm dark:shadow-none">
                        <div className="flex items-center gap-4 text-left">
                          <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center font-black">
                            {log.totalHours}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 dark:text-slate-100">{log.startTime} - {log.endTime}</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                              {log.breakMinutes}m break
                              {log.overtimeHours ? ` • ${log.overtimeHours}h OT` : ''}
                            </p>
                          </div>
                        </div>
                        <button 
                            onClick={(e) => deleteLog(log.id, e)}
                            className="p-3 text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ) : view === 'export' ? (
            <motion.div 
              key="export"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none p-6 md:p-8 border border-slate-100 dark:border-slate-700 relative overflow-hidden">
                <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2 relative z-10">
                    <Download className="text-indigo-500 dark:text-indigo-400" /> Export Data
                </h3>

                <div className="space-y-6 relative z-10">
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Start Date</label>
                        <input 
                        type="date" 
                        value={exportStartDate}
                        onChange={(e) => setExportStartDate(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">End Date</label>
                        <input 
                        type="date" 
                        value={exportEndDate}
                        onChange={(e) => setExportEndDate(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-50 dark:border-slate-700/50 flex items-center justify-end relative z-10">
                  <button 
                    onClick={exportCSV}
                    className="group inline-flex items-center justify-center gap-3 px-10 py-5 bg-indigo-600 text-white font-black rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform"
                  >
                    <Download size={20} /> Download CSV
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none p-6 md:p-8 border border-slate-100 dark:border-slate-700 relative overflow-hidden">
                <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2 relative z-10">
                    <Settings className="text-indigo-500 dark:text-indigo-400" /> Settings
                </h3>

                <div className="space-y-6 relative z-10">
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Start Time</label>
                        <input 
                        type="time" 
                        value={defaultStartTime}
                        onChange={(e) => setDefaultStartTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default End Time</label>
                        <input 
                        type="time" 
                        value={defaultEndTime}
                        onChange={(e) => setDefaultEndTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Break (Minutes)</label>
                        <input 
                        type="number" 
                        value={defaultBreakMinutes}
                        onChange={(e) => setDefaultBreakMinutes(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Cycle Start Day (1-31)</label>
                        <input 
                        type="number" 
                        min="1" max="31"
                        value={payPeriodStartDay}
                        onChange={(e) => setPayPeriodStartDay(parseInt(e.target.value) || 1)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-50 dark:border-slate-700/50 flex items-center justify-end relative z-10">
                  <button 
                    onClick={() => setView('calendar')}
                    className="group inline-flex items-center justify-center gap-3 px-10 py-5 bg-indigo-600 text-white font-black rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
