import { useState, useEffect, useMemo, MouseEvent, ChangeEvent, FormEvent } from 'react';
import { Calendar as CalendarIcon, Clock, Coffee, Trash2, PlusCircle, ChevronLeft, ChevronRight, ArrowLeft, History, Sun, Moon, Download, Settings, Flag, Upload, Edit2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WorkLog } from './types';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, query, where, writeBatch } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (errorMessage.includes('Firestore shutting down') || errorMessage.includes('client is offline')) {
      return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
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
    if (typeof window !== 'undefined') return localStorage.getItem('defaultStartTime') || '07:30';
    return '07:30';
  });
  const [defaultEndTime, setDefaultEndTime] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('defaultEndTime') || '16:30';
    return '16:30';
  });
  const [defaultBreakMinutes, setDefaultBreakMinutes] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('defaultBreakMinutes') || '60';
    return '60';
  });
  const [payPeriodStartDay, setPayPeriodStartDay] = useState(() => {
    if (typeof window !== 'undefined') return parseInt(localStorage.getItem('payPeriodStartDay') || '19', 10);
    return 19;
  });
  const [otDays, setOtDays] = useState<number[]>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('otDays');
      if (stored) return JSON.parse(stored);
      const oldStored = localStorage.getItem('otDay');
      if (oldStored) return [parseInt(oldStored, 10)];
      return [5];
    }
    return [5];
  });

  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [breakMinutes, setBreakMinutes] = useState<string>(defaultBreakMinutes);
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  // Auth State
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Firebase Log Subscription
  useEffect(() => {
    if (!user) return;
    const logsRef = collection(db, 'users', user.uid, 'logs');
    const logsQuery = query(logsRef, where('userId', '==', user.uid));
    const unsub = onSnapshot(logsQuery, (snapshot) => {
      const dbLogs: WorkLog[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        dbLogs.push({
          id: data.id,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          breakMinutes: typeof data.breakMinutes === 'string' ? parseInt(data.breakMinutes) : data.breakMinutes,
          totalHours: data.totalHours,
          overtimeHours: data.overtimeHours,
          timestamp: new Date(data.createdAt || Date.now()).getTime(),
        });
      });
      dbLogs.sort((a, b) => b.date.localeCompare(a.date));
      setLogs(dbLogs);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/logs`));
    return unsub;
  }, [user]);

  // Firebase Settings Subscription
  useEffect(() => {
    if (!user) return;
    const settingsRef = doc(db, 'users', user.uid, 'settings', 'config');
    const unsub = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.defaultStartTime) setDefaultStartTime(data.defaultStartTime);
        if (data.defaultEndTime) setDefaultEndTime(data.defaultEndTime);
        if (data.defaultBreakMinutes) setDefaultBreakMinutes(data.defaultBreakMinutes.toString());
        if (data.payPeriodStartDay) setPayPeriodStartDay(data.payPeriodStartDay);
        if (data.otDays) setOtDays(data.otDays);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}/settings/config`));
    return unsub;
  }, [user]);

  // Sync settings back to Firebase
  useEffect(() => {
    if (!user) return;
    const settingsRef = doc(db, 'users', user.uid, 'settings', 'config');
    setDoc(settingsRef, {
      defaultStartTime,
      defaultEndTime,
      defaultBreakMinutes: parseInt(defaultBreakMinutes) || 0,
      payPeriodStartDay,
      otDays
    }, { merge: true }).catch(error => handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/settings/config`));
  }, [user, defaultStartTime, defaultEndTime, defaultBreakMinutes, payPeriodStartDay, otDays]);

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

  useEffect(() => {
    localStorage.setItem('otDays', JSON.stringify(otDays));
  }, [otDays]);

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

  // Load history on mount or local changes
  useEffect(() => {
    if (user) return; // Ignore local logs when logged in 
    const saved = localStorage.getItem('work_logs');
    if (saved) {
      try {
        setLogs(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse logs", e);
      }
    }
  }, [user]);

  // Save history when logs change locally
  useEffect(() => {
    if (!user) {
      localStorage.setItem('work_logs', JSON.stringify(logs));
    }
  }, [logs, user]);

  const handleLogout = async () => {
    try {
      setLogs([]);
      localStorage.removeItem('work_logs');
      await logout();
    } catch (e) {
      console.error(e);
    }
  };

  const syncLocalToFirebase = async () => {
    if (!user) return;
    try {
      const localLogsStr = localStorage.getItem('work_logs');
      if (localLogsStr) {
        const localLogs: WorkLog[] = JSON.parse(localLogsStr);
        const batch = writeBatch(db);
        for (const log of localLogs) {
          const logRef = doc(db, 'users', user.uid, 'logs', log.id);
          batch.set(logRef, {
            id: log.id,
            userId: user.uid,
            date: log.date,
            startTime: log.startTime,
            endTime: log.endTime,
            breakMinutes: Number(log.breakMinutes),
            totalHours: log.totalHours,
            overtimeHours: log.overtimeHours,
            createdAt: new Date().toISOString()
          }, { merge: true });
        }
        await batch.commit();
        localStorage.removeItem('work_logs');
        alert('Local logs synced to Firebase!');
      }
    } catch(err) {
      console.error(err);
      alert('Failed to sync. Check console.');
    }
  };

  const calculateHours = (start: string, end: string, brk: number) => {
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    let startMinutes = sH * 60 + sM;
    let endMinutes = eH * 60 + eM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return Math.max(0, (endMinutes - startMinutes - brk) / 60);
  };

  const handleSave = async () => {
    const brk = parseInt(breakMinutes) || 0;
    const total = calculateHours(startTime, endTime, brk);
    const parsedDate = parseLocalDate(selectedDate);
    const isOtDay = otDays.includes(parsedDate.getDay());
    const standard = isOtDay ? 0 : calculateHours(defaultStartTime, defaultEndTime, parseInt(defaultBreakMinutes) || 0);
    const ot = Math.max(0, total - standard);
    
    if (editingLogId) {
      const logData = {
          date: selectedDate,
          startTime,
          endTime,
          breakMinutes: brk,
          totalHours: Number(total.toFixed(2)),
          overtimeHours: Number(ot.toFixed(2))
      };
      
      if (user) {
        try {
          const logRef = doc(db, 'users', user.uid, 'logs', editingLogId);
          await setDoc(logRef, { ...logData, userId: user.uid, id: editingLogId }, { merge: true });
        } catch(error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/logs/${editingLogId}`);
        }
      } else {
        setLogs(prev => prev.map(log => 
          log.id === editingLogId ? { ...log, ...logData } : log
        ).sort((a, b) => b.date.localeCompare(a.date)));
      }
      setEditingLogId(null);
    } else {
      const newId = crypto.randomUUID();
      const newLogData = {
        id: newId,
        date: selectedDate,
        startTime,
        endTime,
        breakMinutes: brk,
        totalHours: Number(total.toFixed(2)),
        overtimeHours: Number(ot.toFixed(2)),
        timestamp: Date.now()
      };

      if (user) {
        try {
          const logRef = doc(db, 'users', user.uid, 'logs', newId);
          await setDoc(logRef, { ...newLogData, userId: user.uid, createdAt: new Date().toISOString() });
        } catch(error) {
           handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/logs/${newId}`);
        }
      } else {
        setLogs(prev => [newLogData, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
      }
    }
    
    setBreakMinutes(defaultBreakMinutes);
    setView('calendar');
  };

  const handleEditLog = (log: WorkLog) => {
    setEditingLogId(log.id);
    setSelectedDate(log.date);
    setStartTime(log.startTime);
    setEndTime(log.endTime);
    setBreakMinutes(log.breakMinutes.toString());
  };

  const deleteLog = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (user) {
      try {
        const logRef = doc(db, 'users', user.uid, 'logs', id);
        await deleteDoc(logRef);
      } catch(error) {
        handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/logs/${id}`);
      }
    } else {
      setLogs(prev => prev.filter(log => log.id !== id));
    }
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

  const importCSV = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
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
      
      if (user) {
         try {
           const batch = writeBatch(db);
           for (const ilog of importedLogs) {
              const matchingLocal = logs.find(l => l.date === ilog.date && l.startTime === ilog.startTime && l.endTime === ilog.endTime);
              if (!matchingLocal) {
                 const logRef = doc(db, 'users', user.uid, 'logs', ilog.id);
                 batch.set(logRef, {
                    ...ilog,
                    userId: user.uid,
                    createdAt: new Date().toISOString()
                 });
              }
           }
           await batch.commit();
           alert('Import to Firebase successful!');
         } catch(error) {
            handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/logs (batch)`);
         }
      } else {
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
      }
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
      <main className="max-w-xl mx-auto p-2 sm:p-4 md:p-8 space-y-4 md:space-y-6">
        
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg">
                <Clock size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Work Tracker</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">Manage your shifts</p>
              </div>
            </div>
            
            {(view === 'entry' || view === 'settings' || view === 'export') && (
              <button 
                  onClick={() => setView('calendar')}
                  aria-label="Back to calendar"
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex sm:hidden items-center gap-1 text-sm font-medium"
              >
                  <ArrowLeft size={18} />
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
            {authLoading ? (
               <div className="p-2 flex items-center justify-center">
                  <RefreshCw size={20} className="animate-spin text-slate-400" />
               </div>
            ) : !user ? (
               <div className="flex flex-col items-center sm:items-end gap-1">
                  <button onClick={signInWithGoogle} className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-800 dark:text-slate-100 font-bold text-sm gap-2 whitespace-nowrap">
                     <LogIn size={16} /> Sign In
                  </button>
                  <button 
                    onClick={() => alert('Sign-in help:\n1. If on mobile, try using a non-incognito tab.\n2. Ensure "Third-party cookies" are allowed in settings.\n3. If viewed inside AI Studio, click the "Open in new tab" icon at the top right.\n4. If popups are blocked, the app will try to redirect.')}
                    className="text-[10px] text-slate-400 hover:text-slate-600 underline"
                  >
                    Trouble signing in?
                  </button>
               </div>
            ) : (
               <>
                 <button onClick={syncLocalToFirebase} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300 pointer-events-auto" title="Sync Local to Cloud">
                    <RefreshCw size={20} />
                 </button>
                 <button onClick={handleLogout} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300 pointer-events-auto" title="Sign Out">
                    <LogOut size={20} />
                 </button>
               </>
            )}
            <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                title="Toggle Dark Mode"
                aria-label="Toggle Dark Mode"
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
                    aria-label="Import CSV"
                >
                    <Upload size={20} />
                </button>
                <button 
                    onClick={() => setView('export')}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                    title="Export CSV"
                    aria-label="Export CSV"
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
                  aria-label="Settings"
              >
                  <Settings size={20} />
              </button>
            )}
            {(view === 'entry' || view === 'settings' || view === 'export') && (
              <button 
                  onClick={() => setView('calendar')}
                  className="hidden sm:flex p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors items-center gap-2 text-sm font-medium"
              >
                  <ArrowLeft size={18} />
                  <span>Back</span>
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
                <button aria-label="Previous Month" onClick={() => changeMonth(-1)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                  <ChevronLeft size={20} />
                </button>
                <h2 className="text-lg font-bold capitalize">
                  {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </h2>
                <button aria-label="Next Month" onClick={() => changeMonth(1)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
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
                    const isOtDay = dateStr ? otDays.includes(parseLocalDate(dateStr).getDay()) : false;
                    const dayLogs = dateStr ? logsByDate[dateStr] : [];
                    const totalForDay = dayLogs?.reduce((sum, l) => sum + l.totalHours, 0);

                    return (
                      <div 
                        key={idx} 
                        onClick={() => dateStr && openDate(dateStr)}
                        className={`
                            relative h-16 sm:h-20 md:h-24 p-1 sm:p-2 border-r border-b border-slate-50 dark:border-slate-700/50 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors
                            ${!dateStr ? 'bg-slate-50/50 dark:bg-slate-800/50 text-transparent' : ''}
                            ${isToday ? 'bg-indigo-50/30 dark:bg-indigo-900/20' : ''}
                            ${isOtDay && !isToday && dateStr ? 'bg-amber-50/40 dark:bg-amber-900/20' : ''}
                        `}
                      >
                        {dateStr && (
                          <>
                            <div className="flex justify-between items-start">
                              <span className={`text-sm font-semibold ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                {parseLocalDate(dateStr).getDate()}
                              </span>
                              {isOtDay && (
                                <span className="text-[9px] font-black uppercase text-amber-500/70 dark:text-amber-400/50 tracking-wider">
                                  OT
                                </span>
                              )}
                            </div>
                            {isCycleStart && (
                                <div className="absolute top-2 right-2 text-amber-500" title="Cycle Start">
                                    <Flag size={14} className="fill-amber-500" />
                                </div>
                            )}
                            {dayLogs && dayLogs.length > 0 && (
                              <div className="mt-0.5 sm:mt-1 flex flex-col gap-0.5 sm:gap-1">
                                <span className="text-[10px] sm:text-xs font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/60 px-1 sm:px-1.5 py-0 sm:py-0.5 rounded sm:rounded-md inline-block w-fit leading-tight min-w-[20px] text-center">
                                  {totalForDay.toFixed(1)}<span className="hidden sm:inline">h</span>
                                </span>
                                {dayLogs.some(l => l.overtimeHours) && (
                                  <span className="text-[8px] sm:text-[10px] font-bold text-amber-600 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-0.5 sm:px-1 py-0 sm:py-0.5 rounded inline-block w-fit max-w-full overflow-hidden text-ellipsis whitespace-nowrap leading-tight">
                                    {dayLogs.reduce((sum, l) => sum + (l.overtimeHours || 0), 0).toFixed(1)}<span className="hidden sm:inline">h OT</span>
                                  </span>
                                )}
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
                  const now = new Date();
                  const isCurrentMonth = currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth();
                  const refD = parseLocalDate(selectedDate);
                  const isSelectedInView = refD.getFullYear() === currentMonth.getFullYear() && refD.getMonth() === currentMonth.getMonth();
                  
                  const targetDate = isCurrentMonth ? now : (isSelectedInView ? refD : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15));
                  
                  let cycleStartMonth = targetDate.getMonth();
                  let cycleStartYear = targetDate.getFullYear();

                  if (targetDate.getDate() < payPeriodStartDay) {
                      cycleStartMonth -= 1;
                      if (cycleStartMonth < 0) {
                          cycleStartMonth = 11;
                          cycleStartYear -= 1;
                      }
                  }

                  const d = new Date(cycleStartYear, cycleStartMonth, payPeriodStartDay);
                  const cycleStartDateStr = getLocalDateString(d);
                  
                  const dEnd = new Date(cycleStartYear, cycleStartMonth + 1, payPeriodStartDay);
                  const cycleEndDateStr = getLocalDateString(dEnd);
                  
                  const endDisplayD = new Date(dEnd.getTime() - 86400000);

                  const totalThisCycle = logs
                      .filter(l => l.date >= cycleStartDateStr && l.date < cycleEndDateStr)
                      .reduce((sum, l) => sum + l.totalHours, 0)
                      .toFixed(1);

                  const otThisCycle = logs
                      .filter(l => l.date >= cycleStartDateStr && l.date < cycleEndDateStr)
                      .reduce((sum, l) => sum + (l.overtimeHours || 0), 0)
                      .toFixed(1);

                  const daysWorkedThisCycle = new Set(
                      logs
                          .filter(l => l.date >= cycleStartDateStr && l.date < cycleEndDateStr)
                          .map(l => l.date)
                  ).size;

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
                            <div className="flex items-center gap-6 mt-3 border-t border-indigo-500/50 pt-3 flex-wrap">
                                <p className="text-indigo-200 font-bold text-sm">
                                    Overtime Total: {otThisCycle} Hours
                                </p>
                                <p className="text-indigo-200 font-bold text-sm">
                                    Total Work Days: {daysWorkedThisCycle}
                                </p>
                            </div>
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
                    <label htmlFor="breakMinutes" className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300 gap-2">
                      <Coffee size={16} className="text-indigo-500 dark:text-indigo-400" />
                      Break (Minutes)
                    </label>
                    <input 
                      id="breakMinutes"
                      type="number" 
                      placeholder="0"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(e.target.value)}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2 text-left">
                        <label htmlFor="startTime" className="text-sm font-medium text-slate-700 dark:text-slate-300">Start Time</label>
                        <input 
                        id="startTime"
                        type="time" 
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label htmlFor="endTime" className="text-sm font-medium text-slate-700 dark:text-slate-300">End Time</label>
                        <input 
                        id="endTime"
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
                    {(() => {
                        const totalTemp = calculateHours(startTime, endTime, parseInt(breakMinutes) || 0);
                        const isOtDayPreview = otDays.includes(parseLocalDate(selectedDate).getDay());
                        const standardTemp = isOtDayPreview ? 0 : calculateHours(defaultStartTime, defaultEndTime, parseInt(defaultBreakMinutes) || 0);
                        const otTemp = Math.max(0, totalTemp - standardTemp);
                        
                        return (
                            <>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] font-black">Day Total</p>
                                <div className="flex items-baseline justify-center md:justify-start gap-2">
                                    <p className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                                      {totalTemp.toFixed(2)} <span className="text-lg font-bold">Hrs</span>
                                    </p>
                                    {otTemp > 0 && (
                                      <span className="text-sm font-bold text-amber-500">
                                        (+{otTemp.toFixed(2)} OT)
                                      </span>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                  </div>
                  <div className="flex flex-col gap-3 w-full md:w-auto">
                    <button 
                      onClick={handleSave}
                      className="group w-full md:w-auto inline-flex items-center justify-center gap-3 px-10 py-5 bg-indigo-600 text-white font-black rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform"
                    >
                      {editingLogId ? <Edit2 size={24} /> : <PlusCircle size={24} />}
                      {editingLogId ? 'Update Entry' : 'Add Entry'}
                    </button>
                    {editingLogId && (
                      <button 
                        onClick={() => {
                          setEditingLogId(null);
                          setStartTime(defaultStartTime);
                          setEndTime(defaultEndTime);
                          setBreakMinutes(defaultBreakMinutes);
                        }}
                        className="text-sm font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        Cancel Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* History for this specific day */}
              {logsByDate[selectedDate] && logsByDate[selectedDate].length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 px-2">Logs for this day</h4>
                  <div className="space-y-3">
                    {logsByDate[selectedDate].map((log) => (
                      <div key={log.id} className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl border border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0 shadow-sm dark:shadow-none">
                        <div className="flex items-center gap-3 sm:gap-4 text-left">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center font-black text-sm sm:text-base">
                            {log.totalHours}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100 truncate">{log.startTime} - {log.endTime}</p>
                            <p className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 font-medium truncate">
                              {log.breakMinutes}m break
                              {log.overtimeHours ? ` • ${log.overtimeHours}h OT` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button 
                              onClick={() => handleEditLog(log)}
                              aria-label="Edit"
                              className="p-2 sm:p-3 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all"
                          >
                            <Edit2 size={18} className="sm:w-5 sm:h-5" />
                          </button>
                          <button 
                              onClick={(e) => deleteLog(log.id, e)}
                              aria-label="Delete"
                              className="p-2 sm:p-3 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                          >
                            <Trash2 size={18} className="sm:w-5 sm:h-5" />
                          </button>
                        </div>
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
                        <label htmlFor="exportStartDate" className="text-sm font-medium text-slate-700 dark:text-slate-300">Start Date</label>
                        <input 
                        id="exportStartDate"
                        type="date" 
                        value={exportStartDate}
                        onChange={(e) => setExportStartDate(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label htmlFor="exportEndDate" className="text-sm font-medium text-slate-700 dark:text-slate-300">End Date</label>
                        <input 
                        id="exportEndDate"
                        type="date" 
                        value={exportEndDate}
                        onChange={(e) => setExportEndDate(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-50 dark:border-slate-700/50 flex items-center justify-center sm:justify-end relative z-10">
                  <button 
                    onClick={exportCSV}
                    className="group w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 sm:px-10 py-4 sm:py-5 bg-indigo-600 text-white font-black rounded-2xl sm:rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform text-sm sm:text-base"
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
                </h3>                <div className="space-y-6 relative z-10">
                    <div className="space-y-2 text-left">
                        <label htmlFor="defaultStartTime" className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Start Time</label>
                        <input 
                        id="defaultStartTime"
                        type="time" 
                        value={defaultStartTime}
                        onChange={(e) => setDefaultStartTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label htmlFor="defaultEndTime" className="text-sm font-medium text-slate-700 dark:text-slate-300">Default End Time</label>
                        <input 
                        id="defaultEndTime"
                        type="time" 
                        value={defaultEndTime}
                        onChange={(e) => setDefaultEndTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="space-y-2 text-left">
                        <label htmlFor="defaultBreakMinutes" className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Break (Minutes)</label>
                        <input 
                        id="defaultBreakMinutes"
                        type="number" 
                        value={defaultBreakMinutes}
                        onChange={(e) => setDefaultBreakMinutes(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="space-y-2 text-left">
                        <label htmlFor="payPeriodStartDay" className="text-sm font-medium text-slate-700 dark:text-slate-300">Cycle Start Day (1-31)</label>
                        <input 
                        id="payPeriodStartDay"
                        type="number" 
                        min="1" max="31"
                        value={payPeriodStartDay}
                        onChange={(e) => setPayPeriodStartDay(parseInt(e.target.value) || 1)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="space-y-2 text-left">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">OT Days (Weekends)</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => (
                                <label key={day} className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-transparent has-[:checked]:border-indigo-500/30 has-[:checked]:bg-indigo-50/50 dark:has-[:checked]:bg-indigo-900/20">
                                    <input 
                                        type="checkbox" 
                                        name="otDays"
                                        checked={otDays.includes(index)}
                                        onChange={(e) => {
                                            if (e.target.checked) setOtDays(prev => [...prev, index]);
                                            else setOtDays(prev => prev.filter(d => d !== index));
                                        }}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                    />
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{day.substring(0, 3)}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 sm:mt-10 sm:pt-8 border-t border-slate-50 dark:border-slate-700/50 flex flex-col sm:flex-row items-center justify-center sm:justify-end relative z-10 w-full">
                  <button 
                    onClick={() => setView('calendar')}
                    className="group w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 sm:px-10 py-4 sm:py-5 bg-indigo-600 text-white font-black rounded-2xl sm:rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform text-sm sm:text-base"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
