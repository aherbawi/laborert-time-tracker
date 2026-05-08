export interface WorkLog {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number;
  overtimeHours?: number;
  isDayOff?: boolean;
  isWholeDayOT?: boolean;
  timestamp: number;
}
