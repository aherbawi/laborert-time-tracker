export interface WorkLog {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number;
  overtimeHours?: number;
  timestamp: number;
}
