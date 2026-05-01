import { useState, useEffect, useMemo, MouseEvent } from 'react';
import { Calendar as CalendarIcon, Clock, Coffee, Trash2, PlusCircle, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WorkLog } from './types';

export default function App() {
  const [view, setView] = useState<'calendar' | 'entry'>('calendar');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState<string>('');
  const [logs, setLogs] = useState<WorkLog[]>([]);

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
    const newLog: WorkLog = {
      id: crypto.randomUUID(),
      date: selectedDate,
      startTime,
      endTime,
      breakMinutes: brk,
      totalHours: Number(total.toFixed(2)),
      timestamp: Date.now()
    };
    setLogs(prev => [newLog, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setBreakMinutes('');
    setView('calendar');
  };

  const deleteLog = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setLogs(prev => prev.filter(log => log.id !== id));
  };

  const clearAll = () => {
    if (confirm("Are you sure you want to clear all history?")) {
      setLogs([]);
    }
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
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }, [currentMonth]);

  const changeMonth = (offset: number) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
  };

  const openDate = (dateString: string) => {
    setSelectedDate(dateString);
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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="max-w-xl mx-auto p-4 md:p-8 space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg">
              <Clock size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Work Tracker</h1>
              <p className="text-xs text-slate-500">Manage your shifts</p>
            </div>
          </div>
          {view === 'entry' && (
            <button 
                onClick={() => setView('calendar')}
                className="p-2 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
            >
                <ArrowLeft size={18} />
                Back
            </button>
          )}
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
              <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-slate-50 rounded-lg transition-colors">
                  <ChevronLeft size={20} />
                </button>
                <h2 className="text-lg font-bold capitalize">
                  {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </h2>
                <button onClick={() => changeMonth(1)} className="p-2 hover:bg-slate-50 rounded-lg transition-colors">
                  <ChevronRight size={20} />
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden border border-slate-100">
                <div className="grid grid-cols-7 border-b border-slate-50">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                    <div key={idx} className="py-3 text-center text-[10px] uppercase tracking-widest font-black text-slate-400">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {daysInMonth.map((dateStr, idx) => {
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    const dayLogs = dateStr ? logsByDate[dateStr] : [];
                    const totalForDay = dayLogs?.reduce((sum, l) => sum + l.totalHours, 0);

                    return (
                      <div 
                        key={idx} 
                        onClick={() => dateStr && openDate(dateStr)}
                        className={`
                            relative h-20 md:h-24 p-2 border-r border-b border-slate-50 cursor-pointer hover:bg-indigo-50 transition-colors
                            ${!dateStr ? 'bg-slate-50/50' : ''}
                            ${isToday ? 'bg-indigo-50/30' : ''}
                        `}
                      >
                        {dateStr && (
                          <>
                            <span className={`text-sm font-semibold ${isToday ? 'text-indigo-600' : 'text-slate-600'}`}>
                              {new Date(dateStr).getDate()}
                            </span>
                            {dayLogs && dayLogs.length > 0 && (
                              <div className="mt-1 space-y-1">
                                <div className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1 rounded inline-block">
                                  {totalForDay.toFixed(1)}h
                                </div>
                                <div className="flex gap-0.5">
                                  {dayLogs.map((_, i) => (
                                    <div key={i} className="w-1 h-1 bg-indigo-400 rounded-full" />
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
              <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg shadow-indigo-200 relative overflow-hidden">
                <div className="relative z-10">
                    <p className="text-indigo-100 text-xs font-semibold uppercase tracking-wider mb-1">Total This Month</p>
                    <p className="text-4xl font-black">
                        {logs
                            .filter(l => l.date.startsWith(currentMonth.toISOString().slice(0, 7)))
                            .reduce((sum, l) => sum + l.totalHours, 0)
                            .toFixed(1)}
                        <span className="text-sm ml-2 font-normal opacity-70">Hours</span>
                    </p>
                </div>
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                    <History size={80} />
                </div>
              </div>

              {logs.length > 0 && (
                <div className="text-center pt-4">
                  <button 
                    onClick={clearAll}
                    className="text-xs text-red-500 hover:text-red-600 font-bold uppercase tracking-widest transition-colors"
                  >
                    Clear All History
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="entry"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              {/* Data Entry Card */}
              <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-6 md:p-8 border border-slate-100 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <CalendarIcon size={120} className="text-slate-900" />
                </div>
                
                <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
                    {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2 text-left">
                    <label className="flex items-center text-sm font-medium text-slate-700 gap-2">
                      <Coffee size={16} className="text-indigo-500" />
                      Break (Minutes)
                    </label>
                    <input 
                      type="number" 
                      placeholder="0"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(e.target.value)}
                      className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700">Start Time</label>
                        <input 
                        type="time" 
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700">End Time</label>
                        <input 
                        type="time" 
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold"
                        />
                    </div>
                  </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-50 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="text-center md:text-left">
                    <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black">Day Total</p>
                    <p className="text-4xl font-black text-indigo-600">
                      {calculateHours(startTime, endTime, parseInt(breakMinutes) || 0).toFixed(2)} <span className="text-lg font-bold">Hrs</span>
                    </p>
                  </div>
                  <button 
                    onClick={handleSave}
                    className="group w-full md:w-auto inline-flex items-center justify-center gap-3 px-10 py-5 bg-indigo-600 text-white font-black rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 hover:shadow-indigo-300 transform"
                  >
                    <PlusCircle size={24} />
                    Add Entry
                  </button>
                </div>
              </div>

              {/* History for this specific day */}
              {logsByDate[selectedDate] && logsByDate[selectedDate].length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 px-2">Logs for this day</h4>
                  <div className="space-y-3">
                    {logsByDate[selectedDate].map((log) => (
                      <div key={log.id} className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-4 text-left">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-black">
                            {log.totalHours}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{log.startTime} - {log.endTime}</p>
                            <p className="text-xs text-slate-400 font-medium">{log.breakMinutes}m break</p>
                          </div>
                        </div>
                        <button 
                            onClick={(e) => deleteLog(log.id, e)}
                            className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

