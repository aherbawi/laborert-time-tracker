import {
  useState,
  useEffect,
  useMemo,
  MouseEvent,
  ChangeEvent,
  FormEvent,
} from "react";
import {
  Calendar as CalendarIcon,
  Clock,
  Coffee,
  Trash2,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  History,
  Sun,
  Moon,
  Download,
  Settings,
  Flag,
  Upload,
  Edit2,
  LogIn,
  LogOut,
  RefreshCw,
  Check,
  X,
  Palmtree,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { WorkLog } from "./types";
import {
  auth,
  db,
  signInWithGoogle,
  logout,
  checkStorageAccess,
} from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { translations, Language } from "./i18n";

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
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
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (
    errorMessage.includes("Firestore shutting down") ||
    errorMessage.includes("client is offline")
  ) {
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
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const getLocalDateString = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseLocalDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [storageRestricted, setStorageRestricted] = useState(false);
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem("language") as Language) || "ar";
  });

  const t = translations[lang];
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme");
      if (stored === null) return true; // Default to dark mode
      return stored === "dark";
    }
    return true;
  });

  const [view, setView] = useState<
    "calendar" | "entry" | "settings" | "export"
  >("calendar");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    if (typeof window !== 'undefined') {
        const mode = localStorage.getItem('calendarViewMode') as 'month' | 'cycle' || 'month';
        const startDay = parseInt(localStorage.getItem('payPeriodStartDay') || '21', 10);
        if (mode === 'cycle' && today.getDate() < startDay) {
            return new Date(today.getFullYear(), today.getMonth() - 1, 1);
        }
    }
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
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
    if (typeof window !== "undefined")
      return localStorage.getItem("defaultStartTime") || "07:30";
    return "07:30";
  });
  const [defaultEndTime, setDefaultEndTime] = useState(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("defaultEndTime") || "16:30";
    return "16:30";
  });
  const [defaultBreakMinutes, setDefaultBreakMinutes] = useState(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("defaultBreakMinutes") || "60";
    return "60";
  });
  const [payPeriodStartDay, setPayPeriodStartDay] = useState(() => {
    if (typeof window !== "undefined")
      return parseInt(localStorage.getItem("payPeriodStartDay") || "21", 10);
    return 21;
  });
  const [calendarViewMode, setCalendarViewMode] = useState<"month" | "cycle">(
    () => {
      if (typeof window !== "undefined")
        return (
          (localStorage.getItem("calendarViewMode") as "month" | "cycle") ||
          "month"
        );
      return "month";
    },
  );
  const [hourlyRate, setHourlyRate] = useState<string>(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("hourlyRate") || "";
    return "";
  });
  const [dailyStandardHours, setDailyStandardHours] = useState<string>(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("dailyStandardHours") || "8";
    return "8";
  });
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [breakMinutes, setBreakMinutes] = useState<string>(defaultBreakMinutes);
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [isDayOff, setIsDayOff] = useState(false);
  const [isWholeDayOT, setIsWholeDayOT] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [showSignInHelp, setShowSignInHelp] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Migration for legacy OT days
  useEffect(() => {
    if (logs.length > 0 && !localStorage.getItem("migration_ot_v2_done")) {
      const storedOtDaysStr = localStorage.getItem("otDays");
      if (storedOtDaysStr) {
        try {
          const storedOtDays = JSON.parse(storedOtDaysStr) as number[];
          if (Array.isArray(storedOtDays) && storedOtDays.length > 0) {
            const migratedLogs = logs.map(log => {
              const day = parseLocalDate(log.date).getDay();
              if (storedOtDays.includes(day)) {
                return { 
                  ...log, 
                  isWholeDayOT: true,
                  overtimeHours: log.totalHours 
                };
              }
              return log;
            });

            const hasChanged = JSON.stringify(logs) !== JSON.stringify(migratedLogs);
            if (hasChanged) {
              setLogs(migratedLogs);
              if (!user) {
                localStorage.setItem("work_logs", JSON.stringify(migratedLogs));
              }
            }
          }
        } catch (e) {
          console.error("Migration error:", e);
        }
      }
      localStorage.setItem("migration_ot_v2_done", "true");
    }
  }, [logs, user]);

  const [reminderTime, setReminderTime] = useState(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("reminderTime") || "";
    return "";
  });
  const [hasNotifiedToday, setHasNotifiedToday] = useState(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("hasNotifiedToday") === getLocalDateString();
    return false;
  });

  useEffect(() => {
    if (!user && !authLoading) localStorage.setItem("language", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang, user, authLoading]);

  // Auth State
  useEffect(() => {
    const checkAccess = async () => {
      const allowed = await checkStorageAccess();
      setStorageRestricted(!allowed);
    };
    checkAccess();

    const unsub = onAuthStateChanged(auth, (u) => {
      console.log("Auth state changed:", u ? `User: ${u.email}` : "No user");
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Firebase Log Subscription
  useEffect(() => {
    if (!user) return;
    const logsRef = collection(db, "users", user.uid, "logs");
    const logsQuery = query(logsRef, where("userId", "==", user.uid));
    const unsub = onSnapshot(
      logsQuery,
      (snapshot) => {
        const dbLogs: WorkLog[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          dbLogs.push({
            id: data.id,
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime,
            breakMinutes:
              typeof data.breakMinutes === "string"
                ? parseInt(data.breakMinutes)
                : data.breakMinutes,
            totalHours: data.totalHours,
            overtimeHours: data.overtimeHours,
            isDayOff: data.isDayOff,
            isWholeDayOT: data.isWholeDayOT,
            timestamp: data.timestamp || new Date(data.createdAt || Date.now()).getTime(),
          });
        });
        dbLogs.sort((a, b) => b.date.localeCompare(a.date));
        setLogs(dbLogs);
      },
      (error) =>
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${user.uid}/logs`,
        ),
    );
    return unsub;
  }, [user]);

  // Firebase Settings Subscription
  useEffect(() => {
    if (!user) return;
    const settingsRef = doc(db, "users", user.uid, "settings", "config");
    const unsub = onSnapshot(
      settingsRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.defaultStartTime) {
            setDefaultStartTime(data.defaultStartTime);
            localStorage.setItem("defaultStartTime", data.defaultStartTime);
          }
          if (data.defaultEndTime) {
            setDefaultEndTime(data.defaultEndTime);
            localStorage.setItem("defaultEndTime", data.defaultEndTime);
          }
          if (data.defaultBreakMinutes !== undefined) {
            const val = data.defaultBreakMinutes.toString();
            setDefaultBreakMinutes(val);
            localStorage.setItem("defaultBreakMinutes", val);
          }
          if (data.payPeriodStartDay) {
            setPayPeriodStartDay(data.payPeriodStartDay);
            localStorage.setItem(
              "payPeriodStartDay",
              data.payPeriodStartDay.toString(),
            );
          }
          if (data.lang) {
            setLang(data.lang);
            localStorage.setItem("language", data.lang);
          }
          if (data.isDarkMode !== undefined) {
            setIsDarkMode(data.isDarkMode);
            localStorage.setItem("theme", data.isDarkMode ? "dark" : "light");
          }
          if (data.reminderTime !== undefined) {
            setReminderTime(data.reminderTime);
            localStorage.setItem("reminderTime", data.reminderTime);
          }
          if (data.calendarViewMode !== undefined) {
            setCalendarViewMode(data.calendarViewMode);
            localStorage.setItem("calendarViewMode", data.calendarViewMode);
          }
          if (data.hourlyRate !== undefined) {
            const hrValue = data.hourlyRate?.toString() || "";
            setHourlyRate(hrValue);
            localStorage.setItem("hourlyRate", hrValue);
          }
          if (data.dailyStandardHours !== undefined) {
            const dshValue = data.dailyStandardHours?.toString() || "8";
            setDailyStandardHours(dshValue);
            localStorage.setItem("dailyStandardHours", dshValue);
          }
        }
      },
      (error) =>
        handleFirestoreError(
          error,
          OperationType.GET,
          `users/${user.uid}/settings/config`,
        ),
    );
    return unsub;
  }, [user]);

  // Sync settings back to Firebase
  useEffect(() => {
    if (!user) return;
    const settingsRef = doc(db, "users", user.uid, "settings", "config");
    setDoc(
      settingsRef,
      {
        defaultStartTime,
        defaultEndTime,
        defaultBreakMinutes: parseInt(defaultBreakMinutes) || 0,
        payPeriodStartDay,
        lang,
        isDarkMode,
        reminderTime,
        calendarViewMode,
        hourlyRate: hourlyRate === "" ? null : parseFloat(hourlyRate),
        dailyStandardHours: dailyStandardHours === "" ? 8 : parseFloat(dailyStandardHours),
      },
      { merge: true },
    ).catch((error) =>
      handleFirestoreError(
        error,
        OperationType.WRITE,
        `users/${user.uid}/settings/config`,
      ),
    );
  }, [
    user,
    defaultStartTime,
    defaultEndTime,
    defaultBreakMinutes,
    payPeriodStartDay,
    lang,
    isDarkMode,
    reminderTime,
    calendarViewMode,
    hourlyRate,
  ]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("calendarViewMode", calendarViewMode);
  }, [calendarViewMode, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("hourlyRate", hourlyRate);
  }, [hourlyRate, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("dailyStandardHours", dailyStandardHours);
  }, [dailyStandardHours, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("reminderTime", reminderTime);
  }, [reminderTime, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("defaultStartTime", defaultStartTime);
  }, [defaultStartTime, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("defaultEndTime", defaultEndTime);
  }, [defaultEndTime, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("defaultBreakMinutes", defaultBreakMinutes);
  }, [defaultBreakMinutes, user, authLoading]);

  useEffect(() => {
    if (!user && !authLoading)
      localStorage.setItem("payPeriodStartDay", payPeriodStartDay.toString());
  }, [payPeriodStartDay, user, authLoading]);

  // Apply dark mode theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
      if (!user && !authLoading) localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      if (!user && !authLoading) localStorage.setItem("theme", "light");
    }
  }, [isDarkMode, user, authLoading]);

  // Notifications logic
  useEffect(() => {
    if (!reminderTime) return;

    const requestPermission = async () => {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    };
    requestPermission();

    const interval = setInterval(() => {
      if ("Notification" in window && Notification.permission === "granted") {
        const now = new Date();
        const currentHours = String(now.getHours()).padStart(2, "0");
        const currentMinutes = String(now.getMinutes()).padStart(2, "0");
        const currentTime = `${currentHours}:${currentMinutes}`;

        const todayDateStr = getLocalDateString(now);
        const hasLogForToday = logs.some((log) => log.date === todayDateStr);

        if (!hasLogForToday && currentTime >= reminderTime) {
          const lastNotified = localStorage.getItem("hasNotifiedToday");
          if (lastNotified !== todayDateStr) {
            new Notification(t.notificationTitle || "Log Reminder", {
              body:
                t.notificationBody ||
                "Don't forget to log your work hours for today!",
            });
            if (!user && !authLoading)
              localStorage.setItem("hasNotifiedToday", todayDateStr);
            setHasNotifiedToday(true);
          }
        }
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [reminderTime, logs, t]);

  // Load history on mount or local changes
  useEffect(() => {
    if (user || authLoading) return; // Ignore local logs when logged in
    const saved = localStorage.getItem("work_logs");
    if (saved) {
      try {
        setLogs(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse logs", e);
      }
    }
  }, [user, authLoading]);

  // Save history when logs change locally
  useEffect(() => {
    if (!user && !authLoading) {
      localStorage.setItem("work_logs", JSON.stringify(logs));
    }
  }, [logs, user, authLoading]);

  const handleLogout = async () => {
    try {
      setLogs([]);
      localStorage.clear();
      await logout();
    } catch (e) {
      console.error(e);
    }
  };

  const syncLocalToFirebase = async () => {
    if (!user || syncing) return;
    setSyncing(true);
    setSyncSuccess(false);
    try {
      // Sync Logs
      const localLogsStr = localStorage.getItem("work_logs");
      const batch = writeBatch(db);
      let haveChanges = false;

      if (localLogsStr) {
        const localLogs: WorkLog[] = JSON.parse(localLogsStr);
        for (const log of localLogs) {
          const existingLog = logs.find((l) => l.date === log.date);
          const idToUpdate = existingLog ? existingLog.id : log.id;

          const logRef = doc(db, "users", user.uid, "logs", idToUpdate);
          batch.set(
            logRef,
            {
              id: idToUpdate,
              userId: user.uid,
              date: log.date,
              startTime: log.startTime,
              endTime: log.endTime,
              breakMinutes: Number(log.breakMinutes),
              totalHours: log.totalHours,
              overtimeHours: log.overtimeHours,
              isDayOff: !!log.isDayOff,
              isWholeDayOT: !!log.isWholeDayOT,
              createdAt: existingLog ? undefined : new Date().toISOString(),
            },
            { merge: true },
          );
          haveChanges = true;
        }
      }

      // Helper to get local setting with fallback to current state
      const getLocalSetting = (
        key: string,
        current: any,
        parser: (v: string) => any = (v) => v,
      ) => {
        const stored = localStorage.getItem(key);
        if (stored === null) return current;
        try {
          return parser(stored);
        } catch {
          return current;
        }
      };

      // Sync Settings
      const settingsRef = doc(db, "users", user.uid, "settings", "config");

      const storedTheme = localStorage.getItem("theme");
      const finalIsDarkMode =
        storedTheme === null ? isDarkMode : storedTheme === "dark";

      batch.set(
        settingsRef,
        {
          defaultStartTime: getLocalSetting(
            "defaultStartTime",
            defaultStartTime,
          ),
          defaultEndTime: getLocalSetting("defaultEndTime", defaultEndTime),
          defaultBreakMinutes: getLocalSetting(
            "defaultBreakMinutes",
            parseInt(defaultBreakMinutes) || 0,
            (v) => parseInt(v) || 0,
          ),
          payPeriodStartDay: getLocalSetting(
            "payPeriodStartDay",
            payPeriodStartDay,
            (v) => parseInt(v, 10) || 21,
          ),
          lang: getLocalSetting("language", lang) as Language,
          isDarkMode: finalIsDarkMode,
          reminderTime: getLocalSetting("reminderTime", reminderTime),
          calendarViewMode: getLocalSetting(
            "calendarViewMode",
            calendarViewMode,
          ) as "month" | "cycle",
          hourlyRate: getLocalSetting("hourlyRate", hourlyRate, (v) => v === "" ? null : parseFloat(v)),
          dailyStandardHours: getLocalSetting("dailyStandardHours", dailyStandardHours, (v) => v === "" ? 8 : parseFloat(v)),
        },
        { merge: true },
      );
      haveChanges = true;

      if (haveChanges) {
        await batch.commit();
        localStorage.clear();
      }

      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  const calculateHours = (start: string, end: string, brk: number) => {
    const [sH, sM] = start.split(":").map(Number);
    const [eH, eM] = end.split(":").map(Number);
    let startMinutes = sH * 60 + sM;
    let endMinutes = eH * 60 + eM;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return Math.max(0, (endMinutes - startMinutes - brk) / 60);
  };

  const handleSave = async () => {
    const brk = isDayOff ? 0 : parseInt(breakMinutes) || 0;
    const total = isDayOff ? 0 : calculateHours(startTime, endTime, brk);
    const dsh = parseFloat(dailyStandardHours) || 8;
    const ot = isDayOff ? 0 : (isWholeDayOT ? total : Math.max(0, total - dsh));

    const existingLog = logs.find((l) => l.date === selectedDate);
    const idToUpdate = editingLogId || (existingLog ? existingLog.id : null);

    if (idToUpdate) {
      const logData = {
        date: selectedDate,
        startTime,
        endTime,
        breakMinutes: brk,
        totalHours: Number(total.toFixed(2)),
        overtimeHours: Number(ot.toFixed(2)),
        isDayOff,
        isWholeDayOT,
      };

      if (user) {
        try {
          const logRef = doc(db, "users", user.uid, "logs", idToUpdate);
          await setDoc(
            logRef,
            { ...logData, userId: user.uid, id: idToUpdate },
            { merge: true },
          );
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.UPDATE,
            `users/${user.uid}/logs/${idToUpdate}`,
          );
        }
      } else {
        setLogs((prev) =>
          prev
            .map((log) =>
              log.id === idToUpdate ? { ...log, ...logData } : log,
            )
            .sort((a, b) => b.date.localeCompare(a.date)),
        );
      }
      setEditingLogId(null);
      setIsDayOff(false);
      setIsWholeDayOT(false);
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
        isDayOff,
        isWholeDayOT,
        timestamp: Date.now(),
      };

      if (user) {
        try {
          const logRef = doc(db, "users", user.uid, "logs", newId);
          await setDoc(logRef, {
            ...newLogData,
            userId: user.uid,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.CREATE,
            `users/${user.uid}/logs/${newId}`,
          );
        }
      } else {
        setLogs((prev) =>
          [newLogData, ...prev].sort((a, b) => b.date.localeCompare(a.date)),
        );
      }
    }

    setBreakMinutes(defaultBreakMinutes);
    setView("calendar");
  };

  const handleEditLog = (log: WorkLog) => {
    setEditingLogId(log.id);
    setSelectedDate(log.date);
    setStartTime(log.startTime);
    setEndTime(log.endTime);
    setBreakMinutes(log.breakMinutes.toString());
    setIsDayOff(!!log.isDayOff);
    setIsWholeDayOT(!!log.isWholeDayOT);
    setView("entry");
  };

  const deleteLog = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (user) {
      try {
        const logRef = doc(db, "users", user.uid, "logs", id);
        await deleteDoc(logRef);
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.DELETE,
          `users/${user.uid}/logs/${id}`,
        );
      }
    } else {
      setLogs((prev) => prev.filter((log) => log.id !== id));
    }
  };

  const exportCSV = () => {
    const filteredLogs = logs.filter(
      (log) => log.date >= exportStartDate && log.date <= exportEndDate,
    );
    if (filteredLogs.length === 0) {
      alert("No logs found in this date range.");
      return;
    }
    const headers = [
      "Date",
      "Start Time",
      "End Time",
      "Break (Min)",
      "Total Hours",
      "Overtime Hours",
      "Day Off",
      "Whole Day OT",
    ];
    const csvContent = [
      headers.join(","),
      ...filteredLogs.map(
        (log) =>
          `${log.date},${log.startTime},${log.endTime},${log.breakMinutes},${log.totalHours},${log.overtimeHours || 0},${log.isDayOff ? "Yes" : "No"},${log.isWholeDayOT ? "Yes" : "No"}`,
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `work_logs_${exportStartDate}_to_${exportEndDate}.csv`,
    );
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
      const lines = text.split("\n").filter((line) => line.trim() !== "");
      if (lines.length <= 1) return; // Only header or empty

      const importedLogs: WorkLog[] = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length >= 5) {
          const [
            date,
            startTime,
            endTime,
            breakMinutes,
            totalHours,
            overtimeHours,
          ] = parts;

          importedLogs.push({
            id: crypto.randomUUID(),
            date,
            startTime,
            endTime,
            breakMinutes: parseInt(breakMinutes) || 0,
            totalHours: parseFloat(totalHours) || 0,
            overtimeHours: parseFloat(overtimeHours || "0") || 0,
            timestamp: Date.now() + i,
          });
        }
      }

      if (user) {
        try {
          const batch = writeBatch(db);
          for (const ilog of importedLogs) {
            const matchingLocal = logs.find(
              (l) =>
                l.date === ilog.date &&
                l.startTime === ilog.startTime &&
                l.endTime === ilog.endTime,
            );
            if (!matchingLocal) {
              const logRef = doc(db, "users", user.uid, "logs", ilog.id);
              batch.set(logRef, {
                ...ilog,
                userId: user.uid,
                createdAt: new Date().toISOString(),
              });
            }
          }
          await batch.commit();
          alert("Import to Firebase successful!");
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.WRITE,
            `users/${user.uid}/logs (batch)`,
          );
        }
      } else {
        setLogs((prev) => {
          const newLogsList = [...prev];
          for (const ilog of importedLogs) {
            if (
              !newLogsList.some(
                (l) =>
                  l.date === ilog.date &&
                  l.startTime === ilog.startTime &&
                  l.endTime === ilog.endTime,
              )
            ) {
              newLogsList.push(ilog);
            }
          }
          return newLogsList.sort((a, b) => b.date.localeCompare(a.date));
        });
        alert("Import successful!");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Calendar Logic
  const daysInMonth = useMemo(() => {
    const today = new Date();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // Determine the start and end dates based on the view mode
    let startDate: Date;
    let endDate: Date;

    if (calendarViewMode === "cycle") {
      const cycleStart = new Date(year, month, payPeriodStartDay);
      // If currentMonth is earlier than today, check logic.
      // Easiest is to go from payPeriodStartDay to next month's payPeriodStartDay - 1
      startDate = new Date(year, month, payPeriodStartDay);
      // adjust if we are before cycle in the current month?
      // Let's just render the grid:
      // 1 month of cycle corresponds to the currentMonth state.
      endDate = new Date(year, month + 1, payPeriodStartDay - 1);
    } else {
      startDate = new Date(year, month, 1);
      endDate = new Date(year, month + 1, 0);
    }

    const firstDay = startDate.getDay();
    const totalDays =
      Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate() + i,
      );
      days.push(getLocalDateString(d));
    }
    return days;
  }, [currentMonth, calendarViewMode, payPeriodStartDay]);

  const changeMonth = (offset: number) => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1),
    );
  };

  const openDate = (dateString: string) => {
    setSelectedDate(dateString);
    setEditingLogId(null);
    setStartTime(defaultStartTime);
    setEndTime(defaultEndTime);
    setBreakMinutes(defaultBreakMinutes);
    setIsDayOff(false);
    setIsWholeDayOT(false);
    setView("entry");
  };

  const logsByDate = useMemo(() => {
    return logs.reduce(
      (acc, log) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
      },
      {} as Record<string, WorkLog[]>,
    );
  }, [logs]);

  const calendarTitle = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const t = translations[lang];

    if (calendarViewMode === "cycle") {
      const start = new Date(year, month, payPeriodStartDay);
      const end = new Date(year, month + 1, payPeriodStartDay - 1);

      if (start.getMonth() !== end.getMonth()) {
        const startMonth = t.months[start.getMonth()];
        const endMonth = t.months[end.getMonth()];
        const startYear = start.getFullYear();
        const endYear = end.getFullYear();

        if (startYear !== endYear) {
          return `${startMonth} ${startYear} - ${endMonth} ${endYear}`;
        }
        return `${startMonth} - ${endMonth} ${startYear}`;
      }
    }
    return `${t.months[month]} ${year}`;
  }, [currentMonth, calendarViewMode, payPeriodStartDay, lang]);

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${isDarkMode ? "dark bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"} ${lang === "ar" ? "font-sans" : ""}`}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <main className="max-w-xl mx-auto p-2 sm:p-4 md:p-8 space-y-4 md:space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg">
                <Clock size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
                {user && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {user.email}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
            {authLoading ? (
              <div className="p-2 flex items-center justify-center">
                <RefreshCw size={20} className="animate-spin text-slate-400" />
              </div>
            ) : !user ? (
              <div className="flex flex-col items-center sm:items-end gap-1">
                {storageRestricted && (
                  <div className="mb-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex flex-col gap-2 max-w-[280px]">
                    <p className="font-semibold flex items-center gap-1">
                      <Flag size={14} /> {t.connectionIssue}
                    </p>
                    <p>{t.storageBlocked}</p>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() =>
                          window.open(window.location.href, "_blank")
                        }
                        className="text-amber-600 dark:text-amber-400 font-bold hover:underline text-left"
                      >
                        → {t.openInNewTab}
                      </button>
                      <p className="opacity-70 italic text-[10px]">
                        {t.allowCookies}
                      </p>
                    </div>
                  </div>
                )}
                <button
                  onClick={signInWithGoogle}
                  className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-800 dark:text-slate-100 font-bold text-sm gap-2 whitespace-nowrap"
                >
                  <LogIn size={16} /> {t.signIn}
                </button>
                <button
                  onClick={() => setShowSignInHelp(true)}
                  className="text-[10px] text-slate-400 hover:text-slate-600 underline"
                >
                  {t.troubleSignIn}
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={syncLocalToFirebase}
                  disabled={syncing}
                  className={`p-2 rounded-lg transition-all duration-300 flex items-center justify-center ${
                    syncSuccess
                      ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400"
                      : "hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                  title={t.sync}
                >
                  {syncSuccess ? (
                    <Check size={20} className="scale-110" />
                  ) : (
                    <RefreshCw
                      size={20}
                      className={syncing ? "animate-spin" : ""}
                    />
                  )}
                </button>
                <button
                  onClick={handleLogout}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                  title={t.signOut}
                >
                  <LogOut size={20} />
                </button>
              </>
            )}

            {view === "calendar" ? (
              <>
                <input
                  type="file"
                  accept=".csv"
                  id="csv-import"
                  className="hidden"
                  onChange={importCSV}
                />
                <button
                  onClick={() => document.getElementById("csv-import")?.click()}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                  title={t.import}
                >
                  <Upload size={20} />
                </button>
                <button
                  onClick={() => setView("export")}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                  title={t.export}
                >
                  <Download size={20} />
                </button>
                <button
                  onClick={() => setView("settings")}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center text-slate-600 dark:text-slate-300"
                  title={t.settings}
                >
                  <Settings size={20} />
                </button>
              </>
            ) : (
              <button
                onClick={() => setView("calendar")}
                className="flex p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors items-center gap-2 text-sm font-medium"
              >
                {lang === "ar" ? (
                  <ChevronRight size={18} />
                ) : (
                  <ArrowLeft size={18} />
                )}
                <span className="hidden sm:inline">{t.cancel}</span>
              </button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {view === "calendar" ? (
            <motion.div
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Month Selector */}
              <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                <button
                  aria-label="Previous Month"
                  onClick={() => changeMonth(-1)}
                  className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  {lang === "ar" ? (
                    <ChevronRight size={20} />
                  ) : (
                    <ChevronLeft size={20} />
                  )}
                </button>
                <div className="flex flex-col items-center">
                  {calendarViewMode === "cycle" && (
                    <span className="text-[10px] font-black uppercase text-indigo-500/60 dark:text-indigo-400/50 tracking-widest mb-0.5">
                      {t.calendarViewCycle}
                    </span>
                  )}
                  <h2
                    className="text-base sm:text-lg font-bold capitalize text-center cursor-pointer hover:text-indigo-600 transition-colors"
                    onClick={() => {
                        const today = new Date();
                        if (calendarViewMode === 'cycle' && today.getDate() < payPeriodStartDay) {
                            setCurrentMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
                        } else {
                            setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                        }
                    }}
                    title={lang === "ar" ? "العودة إلى اليوم" : "Go to Today"}
                  >
                    {calendarTitle}
                  </h2>
                </div>
                <button
                  aria-label="Next Month"
                  onClick={() => changeMonth(1)}
                  className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  {lang === "ar" ? (
                    <ChevronLeft size={20} />
                  ) : (
                    <ChevronRight size={20} />
                  )}
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-700">
                <div className="grid grid-cols-7 border-b border-slate-50 dark:border-slate-700/50">
                  {t.days.map((day, idx) => (
                    <div
                      key={idx}
                      className={`py-3 text-center text-[10px] sm:text-xs uppercase font-black text-slate-400 dark:text-slate-500 ${lang === "ar" ? "tracking-normal" : "tracking-widest"}`}
                    >
                      {lang === "ar" ? day : day[0]}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {daysInMonth.map((dateStr, idx) => {
                    const isToday = dateStr === getLocalDateString();
                    const dayDate = dateStr ? parseLocalDate(dateStr) : null;
                    const isCycleStart =
                      dayDate && dayDate.getDate() === payPeriodStartDay;
                    const isFirstDayOfMonth =
                      dayDate && dayDate.getDate() === 1;
                    const isOtDay = false; // Legacy automatic OT days removed
                    const dayLogs = dateStr ? (logsByDate[dateStr] || []) : [];
                    const isManualDayOff = dayLogs.some((l) => l.isDayOff);
                    const isManualWholeDayOT = dayLogs.some(
                      (l) => l.isWholeDayOT,
                    );
                    const totalForDay = dayLogs?.reduce(
                      (sum, l) => sum + l.totalHours,
                      0,
                    );

                    return (
                      <div
                        key={idx}
                        onClick={() => dateStr && openDate(dateStr)}
                        className={`
                              relative h-20 sm:h-24 md:h-28 p-1.5 sm:p-2 border-r border-b border-slate-50 dark:border-slate-700/50 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex flex-col gap-1
                              ${!dateStr ? "bg-slate-50/50 dark:bg-slate-800/50 pointer-events-none" : ""}
                              ${isToday ? "bg-indigo-50/30 dark:bg-indigo-900/20" : ""}
                              ${isOtDay && !isToday && dateStr ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}
                              ${isManualDayOff ? "bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-900/30" : ""}
                              ${isFirstDayOfMonth ? "ring-1 ring-inset ring-slate-200 dark:ring-slate-700/50" : ""}
                          `}
                      >
                        {dateStr && dayDate && (
                          <>
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col items-start leading-none gap-0.5">
                                <span
                                  className={`text-sm font-bold ${isToday ? "text-indigo-600 dark:text-indigo-400" : isManualDayOff ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"}`}
                                >
                                  {dayDate.getDate()}
                                </span>
                                {isFirstDayOfMonth && (
                                  <span className="text-[7px] sm:text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 truncate max-w-[40px] sm:max-w-none">
                                    {t.months[dayDate.getMonth()]}
                                  </span>
                                )}
                              </div>
                              {(isOtDay || isManualWholeDayOT) && (
                                <span
                                  className={`font-black uppercase text-amber-500/60 dark:text-amber-600/40 ${lang === "ar" ? "text-[8px]" : "text-[8px] tracking-wider"}`}
                                >
                                  {lang === "ar" ? "إضافي" : "OT"}
                                </span>
                              )}
                            </div>

                            {isCycleStart && (
                              <div
                                className={`absolute bottom-1 ${lang === "ar" ? "left-1" : "right-1"} text-amber-500 opacity-30`}
                                title="Cycle Start"
                              >
                                <Flag size={10} className="fill-amber-500" />
                              </div>
                            )}

                            {isManualDayOff && (
                              <div
                                className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 p-1"
                              >
                                <span className="text-[10px] sm:text-xs font-black text-rose-600/90 dark:text-rose-400/90 tracking-tight text-center uppercase break-words leading-tight">
                                  {t.dayOff}
                                </span>
                              </div>
                            )}

                            <div className="mt-auto flex flex-col items-start gap-1">
                              {dayLogs && dayLogs.length > 0 && !isManualDayOff && (
                                <>
                                  <div className="flex flex-col gap-1 w-full items-start">
                                    <span className="text-[9px] sm:text-xs font-bold text-indigo-100 bg-indigo-600 dark:bg-indigo-600 px-1.5 py-0.5 rounded-full inline-flex items-center leading-none border border-indigo-700 shadow-sm">
                                      {totalForDay.toFixed(1)}
                                      <span className="ml-0.5 opacity-80 text-[8px] sm:text-[10px]">
                                        {lang === "ar" ? "س" : "h"}
                                      </span>
                                    </span>
                                    {dayLogs.some((l) => {
                                      const dsh = parseFloat(dailyStandardHours) || 8;
                                      if (l.isDayOff) return false;
                                      if (l.isWholeDayOT) return l.totalHours > 0;
                                      if (l.overtimeHours !== undefined && l.overtimeHours > 0) return true;
                                      return (l.totalHours || 0) > dsh;
                                    }) && (
                                      <span
                                        className={`font-bold text-amber-100 bg-amber-600 dark:bg-amber-700/80 px-1.5 py-0.5 rounded-full inline-flex items-center leading-none border border-amber-700 shadow-sm ${lang === "ar" ? "text-[9px] sm:text-[10px]" : "text-[8px] sm:text-[10px]"}`}
                                      >
                                        {dayLogs
                                          .reduce(
                                            (sum, l) => {
                                              const dsh = parseFloat(dailyStandardHours) || 8;
                                              if (l.isDayOff) return sum;
                                              if (l.isWholeDayOT) return sum + l.totalHours;
                                              if (l.overtimeHours !== undefined && l.overtimeHours > 0) return sum + l.overtimeHours;
                                              return sum + Math.max(0, (l.totalHours || 0) - dsh);
                                            },
                                            0,
                                          )
                                          .toFixed(1)}
                                        <span className="ml-0.5 opacity-80 text-[7px] sm:text-[9px]">
                                          {lang === "ar" ? "إضافي" : "OT"}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Simple Stats */}
              {(() => {
                let startDate: Date;
                let endDate: Date;
                let title: string;

                if (calendarViewMode === "cycle") {
                  startDate = new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth(),
                    payPeriodStartDay,
                  );
                  endDate = new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth() + 1,
                    payPeriodStartDay,
                  );
                  title = lang === "ar" ? "إجمالي الدورة" : "Cycle Total";
                } else {
                  startDate = new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth(),
                    1,
                  );
                  endDate = new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth() + 1,
                    1,
                  );
                  title = lang === "ar" ? "إجمالي الشهر" : "Month Total";
                }

                const startDisplayStr = getLocalDateString(startDate);
                const endSearchStr = getLocalDateString(endDate);

                const endDisplayD = new Date(endDate.getTime() - 86400000);

                const totalThisPeriod = logs
                  .filter(
                    (l) => l.date >= startDisplayStr && l.date < endSearchStr && !l.isDayOff,
                  )
                  .reduce((sum, l) => sum + l.totalHours, 0)
                  .toFixed(1);

                const dshNum = parseFloat(dailyStandardHours) || 8;
                const otThisPeriod = logs
                  .filter(
                    (l) => l.date >= startDisplayStr && l.date < endSearchStr && !l.isDayOff,
                  )
                  .reduce((sum, l) => {
                    if (l.isWholeDayOT) return sum + l.totalHours;
                    // If log has overtimeHours set (new logs), use it.
                    // Otherwise, calculate on the fly for better backward compatibility.
                    if (l.overtimeHours !== undefined && l.overtimeHours > 0) return sum + l.overtimeHours;
                    return sum + Math.max(0, l.totalHours - dshNum);
                  }, 0)
                  .toFixed(1);

                const daysWorkedThisPeriod = new Set(
                  logs
                    .filter(
                      (l) => l.date >= startDisplayStr && l.date < endSearchStr && !l.isDayOff,
                    )
                    .map((l) => l.date),
                ).size;

                const totalDaysOffThisPeriod = logs
                   .filter(
                     (l) => l.date >= startDisplayStr && l.date < endSearchStr && l.isDayOff,
                   ).length;

                const hourlyRateNum = parseFloat(hourlyRate);
                const totalSalary = isNaN(hourlyRateNum) ? 0 : parseFloat(totalThisPeriod) * hourlyRateNum;

                return (
                  <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg shadow-indigo-200 dark:shadow-none relative overflow-hidden">
                    <div className="relative z-10">
                      <p className="text-indigo-100 text-[10px] font-bold uppercase tracking-[0.2em] mb-4 bg-indigo-700/50 w-fit px-3 py-1 rounded-lg border border-indigo-400/20">
                        {title} (
                        {lang === "ar"
                          ? `${startDate.getDate()} ${t.months[startDate.getMonth()]}`
                          : startDate.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}{" "}
                        -{" "}
                        {lang === "ar"
                          ? `${endDisplayD.getDate()} ${t.months[endDisplayD.getMonth()]}`
                          : endDisplayD.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                        )
                      </p>

                      <div className="grid grid-cols-2 divide-x divide-indigo-400/30 rtl:divide-x-reverse">
                        <div className="flex flex-col pr-4 sm:pr-6 rtl:pr-0 rtl:pl-4 sm:rtl:pl-6">
                          <span className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-2 truncate opacity-80">
                            {lang === "ar" ? "إجمالي الساعات" : "Total Hours"}
                          </span>
                          <p className="text-3xl sm:text-4xl font-black tracking-tight leading-none">
                            {totalThisPeriod}
                            <span className="text-xs ml-1.5 font-bold opacity-60 rtl:mr-1.5">
                              {lang === "ar" ? "ساعة" : "Hrs"}
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-col pl-4 sm:pl-6 rtl:pl-0 rtl:pr-4 sm:rtl:pr-6 text-indigo-50">
                          <span className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-2 truncate opacity-80">
                            {t.overtimeTotal}
                          </span>
                          <p className="text-3xl sm:text-4xl font-black tracking-tight leading-none">
                            {otThisPeriod}
                            <span className="text-xs ml-1.5 font-bold opacity-60 rtl:mr-1.5">
                              {lang === "ar" ? "ساعة" : "Hrs"}
                            </span>
                          </p>
                        </div>
                      </div>

                      {hourlyRateNum > 0 && (
                        <div className="mt-6 p-4 bg-white/10 rounded-2xl border border-white/10 backdrop-blur-sm">
                          <span className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-1 block opacity-80">
                            {t.totalSalary}
                          </span>
                          <p className="text-2xl font-black text-white flex items-baseline gap-1">
                            {totalSalary.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span className="text-sm font-bold opacity-60">
                              {t.currency}
                            </span>
                          </p>
                        </div>
                      )}

                      <div className="flex items-center gap-x-8 gap-y-2 mt-6 border-t border-indigo-400/30 pt-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          <p className="text-indigo-100 font-bold text-sm">
                            {t.totalWorkDays}: <span className="text-white">{daysWorkedThisPeriod}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-indigo-100 font-bold text-sm">
                            {t.totalDaysOff}: <span className="text-white">{totalDaysOffThisPeriod}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div
                      className={`absolute top-0 ${lang === "ar" ? "left-0" : "right-0"} p-4 opacity-10 pointer-events-none transform translate-y-2`}
                    >
                      <History size={100} />
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          ) : view === "entry" ? (
            <motion.div
              key="entry"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              {/* Data Entry Card */}
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none p-6 md:p-8 border border-slate-100 dark:border-slate-700 relative overflow-hidden">
                <div
                  className={`absolute top-0 ${lang === "ar" ? "left-0" : "right-0"} p-4 opacity-5 dark:opacity-10 pointer-events-none`}
                >
                  <CalendarIcon
                    size={120}
                    className="text-slate-900 dark:text-slate-100"
                  />
                </div>

                <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2 relative z-10">
                  {(() => {
                    const date = parseLocalDate(selectedDate);
                    if (lang === "ar") {
                      return `${t.days[date.getDay()]}، ${date.getDate()} ${t.months[date.getMonth()]}`;
                    }
                    return date.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    });
                  })()}
                </h3>

                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-4 mb-8 relative z-10">
                  <button
                    onClick={() => {
                      setIsDayOff(!isDayOff);
                      if (!isDayOff) setIsWholeDayOT(false);
                    }}
                    className={`group relative flex flex-col items-center justify-center gap-3 p-5 rounded-3xl border-2 transition-all duration-300 overflow-hidden ${
                      isDayOff
                        ? "bg-rose-500 border-rose-500 text-white shadow-xl shadow-rose-200 dark:shadow-none ring-2 ring-rose-500 ring-offset-2 dark:ring-offset-slate-950"
                        : "bg-white border-slate-100 text-slate-500 dark:bg-slate-900/50 dark:text-slate-400 dark:border-slate-800 hover:border-rose-300 hover:bg-rose-50/50 dark:hover:bg-rose-900/10"
                    }`}
                  >
                    <div className={`p-4 rounded-2xl transition-all duration-300 transform group-hover:scale-110 ${isDayOff ? "bg-white/20" : "bg-rose-50 dark:bg-rose-900/30 text-rose-500"}`}>
                      <Palmtree size={32} className={isDayOff ? "text-white" : "text-rose-500"} />
                    </div>
                    <span className="font-bold text-xs uppercase tracking-[0.2em]">{t.dayOff}</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsWholeDayOT(!isWholeDayOT);
                      if (!isWholeDayOT) setIsDayOff(false);
                    }}
                    className={`group relative flex flex-col items-center justify-center gap-3 p-5 rounded-3xl border-2 transition-all duration-300 overflow-hidden ${
                      isWholeDayOT
                        ? "bg-amber-500 border-amber-500 text-white shadow-xl shadow-amber-200 dark:shadow-none ring-2 ring-amber-500 ring-offset-2 dark:ring-offset-slate-950"
                        : "bg-white border-slate-100 text-slate-500 dark:bg-slate-900/50 dark:text-slate-400 dark:border-slate-800 hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-amber-900/10"
                    }`}
                  >
                    <div className={`p-4 rounded-2xl transition-all duration-300 transform group-hover:scale-110 ${isWholeDayOT ? "bg-white/20" : "bg-amber-50 dark:bg-amber-900/30 text-amber-500"}`}>
                      <Flag size={32} className={isWholeDayOT ? "text-white" : "text-amber-500"} />
                    </div>
                    <span className="font-bold text-xs uppercase tracking-[0.2em]">{t.otDayWhole}</span>
                  </button>
                </div>

                <div
                  className={`grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10 transition-all ${isDayOff ? "opacity-30 pointer-events-none grayscale" : "opacity-100"}`}
                >
                  <div className="space-y-2 text-left rtl:text-right">
                    <label
                      htmlFor="breakMinutes"
                      className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300 gap-2"
                    >
                      <Coffee
                        size={16}
                        className="text-indigo-500 dark:text-indigo-400"
                      />
                      {t.break}
                    </label>
                    <input
                      id="breakMinutes"
                      type="number"
                      placeholder="0"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(e.target.value)}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white text-left rtl:text-right"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2 text-left rtl:text-right">
                      <label
                        htmlFor="startTime"
                        className="text-sm font-medium text-slate-700 dark:text-slate-300"
                      >
                        {t.startTime}
                      </label>
                      <input
                        id="startTime"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                      />
                    </div>

                    <div className="space-y-2 text-left rtl:text-right">
                      <label
                        htmlFor="endTime"
                        className="text-sm font-medium text-slate-700 dark:text-slate-300"
                      >
                        {t.endTime}
                      </label>
                      <input
                        id="endTime"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-50 dark:border-slate-700/50 flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
                  <div className="text-center md:text-left rtl:md:text-right">
                    {(() => {
                      const totalTemp = isDayOff
                        ? 0
                        : calculateHours(
                            startTime,
                            endTime,
                            parseInt(breakMinutes) || 0,
                          );
                      const dsh = parseFloat(dailyStandardHours) || 8;
                      const otTemp = isDayOff
                        ? 0
                        : (isWholeDayOT ? totalTemp : Math.max(0, totalTemp - dsh));

                      return (
                        <>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] font-black">
                            {t.totalHours}
                          </p>
                          <div className="flex items-baseline justify-center md:justify-start gap-2">
                            <p className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                              {totalTemp.toFixed(2)}{" "}
                              <span className="text-lg font-bold">
                                {lang === "ar" ? "ساعة" : "Hrs"}
                              </span>
                            </p>
                            {otTemp > 0 && (
                              <span className="text-sm font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                                (+{otTemp.toFixed(2)}{" "}
                                {lang === "ar" ? "إضافي" : "OT"})
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
                      {editingLogId ? (
                        <Edit2 size={24} />
                      ) : (
                        <PlusCircle size={24} />
                      )}
                      {editingLogId ? t.editEntry : t.addEntry}
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
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* History for this specific day */}
              {logsByDate[selectedDate] &&
                logsByDate[selectedDate].length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 px-2">
                      Logs for this day
                    </h4>
                    <div className="space-y-3">
                      {logsByDate[selectedDate].map((log) => (
                        <div
                          key={log.id}
                          className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl border border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0 shadow-sm dark:shadow-none"
                        >
                          <div className="flex items-center gap-3 sm:gap-4 text-left">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center font-black text-sm sm:text-base">
                              {log.totalHours}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100 truncate">
                                {log.isDayOff
                                  ? t.dayOff
                                  : `${log.startTime} - ${log.endTime}`}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                {!log.isDayOff && (
                                  <p className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 font-medium truncate">
                                    {log.breakMinutes}m break
                                  </p>
                                )}
                                {log.isWholeDayOT && (
                                  <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                                    {t.otDayWhole}
                                  </span>
                                )}
                                {(() => {
                                  const dsh = parseFloat(dailyStandardHours) || 8;
                                  let otValue = 0;
                                  if (!log.isDayOff) {
                                    if (log.isWholeDayOT) otValue = log.totalHours;
                                    else if (log.overtimeHours !== undefined && log.overtimeHours > 0) otValue = log.overtimeHours;
                                    else otValue = Math.max(0, log.totalHours - dsh);
                                  }
                                  
                                  return otValue > 0 ? (
                                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                      {otValue.toFixed(2)}h {lang === 'ar' ? 'إضافي' : 'OT'}
                                    </span>
                                  ) : null;
                                })()}
                              </div>
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
          ) : view === "export" ? (
            <motion.div
              key="export"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none p-6 md:p-8 border border-slate-100 dark:border-slate-700 relative overflow-hidden">
                <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2 relative z-10">
                  <Download className="text-indigo-500 dark:text-indigo-400" />{" "}
                  {t.export}
                </h3>

                <div className="space-y-6 relative z-10">
                  <div className="space-y-2 text-left rtl:text-right">
                    <label
                      htmlFor="exportStartDate"
                      className="text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      {t.startTime} ({t.date})
                    </label>
                    <input
                      id="exportStartDate"
                      type="date"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>

                  <div className="space-y-2 text-left rtl:text-right">
                    <label
                      htmlFor="exportEndDate"
                      className="text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      {t.endTime} ({t.date})
                    </label>
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
                    <Download size={20} /> {t.export}
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
                  <Settings className="text-indigo-500 dark:text-indigo-400" />{" "}
                  {t.settings}
                </h3>

                <div className="space-y-8 relative z-10">
                  {/* Appearance & Language */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-6 border-b border-slate-100 dark:border-slate-700/50">
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                        {t.language}
                      </label>
                      <div className="flex bg-slate-100 dark:bg-slate-900 rounded-xl p-1 gap-1">
                        <button
                          onClick={() => setLang("en")}
                          className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all ${lang === "en" ? "bg-white dark:bg-slate-800 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                        >
                          English
                        </button>
                        <button
                          onClick={() => setLang("ar")}
                          className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all ${lang === "ar" ? "bg-white dark:bg-slate-800 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                        >
                          العربية
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                        {t.darkMode}
                      </label>
                      <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className="w-full flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-900 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-900/50 transition-colors"
                      >
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                          {isDarkMode ? t.darkMode : t.lightMode}
                        </span>
                        <div
                          className={`p-1.5 rounded-lg ${isDarkMode ? "bg-indigo-500 text-white" : "bg-amber-500 text-white"}`}
                        >
                          {isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-8">
                    {/* App Installation */}
                    {deferredPrompt && (
                      <div className="space-y-4">
                        <label className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-left rtl:text-right block">
                          App Installation
                        </label>
                        <button
                          onClick={async () => {
                            if (deferredPrompt) {
                              deferredPrompt.prompt();
                              const { outcome } = await deferredPrompt.userChoice;
                              if (outcome === 'accepted') {
                                setDeferredPrompt(null);
                              }
                            }
                          }}
                          className="w-full flex items-center justify-between p-4 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors border border-indigo-100 dark:border-indigo-800"
                        >
                          <div className="flex flex-col text-left rtl:text-right">
                            <span className="font-bold">Install Work Tracker</span>
                            <span className="text-xs opacity-80 mt-1">Add to your home screen for quick access</span>
                          </div>
                          <Download size={20} />
                        </button>
                      </div>
                    )}

                    {/* Time Settings */}
                    <div className="space-y-6">
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="defaultStartTime"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.defaultStart}
                        </label>
                        <input
                          id="defaultStartTime"
                          type="time"
                          value={defaultStartTime}
                          onChange={(e) => setDefaultStartTime(e.target.value)}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                        />
                      </div>
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="defaultEndTime"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.defaultEnd}
                        </label>
                        <input
                          id="defaultEndTime"
                          type="time"
                          value={defaultEndTime}
                          onChange={(e) => setDefaultEndTime(e.target.value)}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                        />
                      </div>
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="defaultBreakMinutes"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.defaultBreak}
                        </label>
                        <input
                          id="defaultBreakMinutes"
                          type="number"
                          value={defaultBreakMinutes}
                          onChange={(e) => setDefaultBreakMinutes(e.target.value)}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                        />
                      </div>
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="dailyStandardHours"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.dailyStandardHours}
                        </label>
                        <input
                          id="dailyStandardHours"
                          type="number"
                          step="0.5"
                          placeholder="8"
                          value={dailyStandardHours}
                          onChange={(e) => setDailyStandardHours(e.target.value)}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                        />
                      </div>
                    </div>

                    <hr className="border-slate-100 dark:border-slate-700/50" />

                    {/* Calendar Settings */}
                    <div className="space-y-6">
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="payPeriodStartDay"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.payPeriodStart} (1-31)
                        </label>
                        <input
                          id="payPeriodStartDay"
                          type="number"
                          min="1"
                          max="31"
                          value={payPeriodStartDay}
                          onChange={(e) =>
                            setPayPeriodStartDay(parseInt(e.target.value) || 1)
                          }
                          className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                        />
                      </div>
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="calendarViewMode"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.calendarViewMode}
                        </label>
                        <select
                          id="calendarViewMode"
                          value={calendarViewMode}
                          onChange={(e) => {
                            const newMode = e.target.value as "month" | "cycle";
                            setCalendarViewMode(newMode);
                            const today = new Date();
                            if (newMode === 'cycle') {
                                if (today.getDate() < payPeriodStartDay) {
                                    setCurrentMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
                                } else {
                                    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                                }
                            } else {
                                setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                            }
                          }}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white appearance-none select-custom text-left rtl:text-right"
                        >
                          <option value="month">{t.calendarViewMonth}</option>
                          <option value="cycle">{t.calendarViewCycle}</option>
                        </select>
                      </div>
                    </div>

                    <hr className="border-slate-100 dark:border-slate-700/50" />

                    {/* Financial Settings */}
                    <div className="space-y-6">
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="hourlyRate"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.hourlyRate}
                        </label>
                        <div className="relative">
                          <input
                            id="hourlyRate"
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={hourlyRate}
                            onChange={(e) => setHourlyRate(e.target.value)}
                            className="w-full p-4 pl-4 pr-12 rtl:pr-4 rtl:pl-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                          />
                          <div className={`absolute top-1/2 -translate-y-1/2 ${lang === "ar" ? "left-4" : "right-4"} font-bold text-slate-400`}>
                            {t.currency}
                          </div>
                        </div>
                      </div>
                    </div>

                    <hr className="border-slate-100 dark:border-slate-700/50" />

                    {/* Notification Settings */}
                    <div className="space-y-6">
                      <div className="space-y-2 text-left rtl:text-right">
                        <label
                          htmlFor="reminderTime"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          {t.reminderTime}
                          <span className="block text-xs text-slate-500 font-normal mt-1">
                            {t.reminderTimeDesc}
                          </span>
                        </label>
                        <div className="relative">
                          <input
                            id="reminderTime"
                            type="time"
                            value={reminderTime}
                            onChange={(e) => {
                              setReminderTime(e.target.value);
                              if (
                                e.target.value &&
                                "Notification" in window &&
                                Notification.permission === "default"
                              ) {
                                Notification.requestPermission();
                              }
                            }}
                            className="w-full p-4 pl-4 pr-12 rtl:pr-4 rtl:pl-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold dark:text-white [color-scheme:light] dark:[color-scheme:dark] text-left rtl:text-right"
                          />
                          {reminderTime && (
                            <button
                              onClick={() => setReminderTime("")}
                              className={`absolute top-1/2 -translate-y-1/2 ${lang === "ar" ? "left-3" : "right-3"} p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors`}
                              title={lang === "ar" ? "مسح" : "Clear"}
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 sm:mt-10 sm:pt-8 border-t border-slate-50 dark:border-slate-700/50 flex flex-col sm:flex-row items-center justify-center sm:justify-end relative z-10 w-full">
                  <button
                    onClick={() => setView("calendar")}
                    className="group w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 sm:px-10 py-4 sm:py-5 bg-indigo-600 text-white font-black rounded-2xl sm:rounded-3xl hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-200 dark:shadow-none transform text-sm sm:text-base"
                  >
                    {t.save}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      {/* Modals placed here */}
      <AnimatePresence>
        {showSignInHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setShowSignInHelp(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-slate-100 dark:border-slate-700 space-y-4"
              dir={lang === "ar" ? "rtl" : "ltr"}
            >
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 mb-2">
                {lang === "ar" ? "مساعدة في تسجيل الدخول" : "Sign-in help"}
              </h3>
              <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-disc list-inside">
                {lang === "ar" ? (
                  <>
                    <li>
                      إذا كنت تستخدم الجوال، جرب استخدام متصفح عادي وتجنب وضع
                      التصفح المتخفي.
                    </li>
                    <li>
                      تأكد من السماح بـ "ملفات تعريف الارتباط للجهات الخارجية"
                      (Third-party cookies) في إعدادات المتصفح.
                    </li>
                    <li>
                      في حال حظر النوافذ المنبثقة، سيحاول التطبيق إعادة التوجيه
                      تلقائياً لتسجيل الدخول.
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      If on mobile, try using a normal browser tab (not
                      incognito/private).
                    </li>
                    <li>
                      Ensure "Third-party cookies" are allowed in your browser
                      settings.
                    </li>
                    <li>
                      If popups are blocked, the app will try to redirect.
                    </li>
                  </>
                )}
              </ul>
              <button
                onClick={() => setShowSignInHelp(false)}
                className="w-full mt-4 p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
              >
                {lang === "ar" ? "حسناً، فهمت" : "OK, I got it"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
