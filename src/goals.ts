import type { FocusSession } from "./types";

export function localDayBounds(now = Date.now()) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return { start, end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() };
}

export function localWeekBounds(now = Date.now()) {
  const date = new Date(now);
  const mondayOffset = (date.getDay() + 6) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset).getTime();
  const endDate = new Date(start); endDate.setDate(endDate.getDate() + 7);
  return { start, end: endDate.getTime() };
}

const overlapSeconds = (start: number, end: number, rangeStart: number, rangeEnd: number) => Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart)) / 1000;

export function sessionFocusedSecondsInRange(session: FocusSession, rangeStart: number, rangeEnd: number) {
  if (session.archived) return 0;
  const intervals = session.focusIntervals;
  // Older edited/imported Sessions can retain obsolete recorded intervals.
  // Use exact pause-aware allocation only when it still matches canonical timing.
  const recordedSeconds = intervals?.reduce((sum, interval) => sum + (interval.endTime - interval.startTime) / 1000, 0) ?? 0;
  if (intervals?.length && Math.abs(recordedSeconds - session.focusedDurationSeconds) <= 0.5 && intervals.every(interval => interval.startTime >= session.startTime && interval.endTime <= session.endTime && interval.endTime >= interval.startTime)) {
    return intervals.reduce((sum, interval) => sum + overlapSeconds(interval.startTime, interval.endTime, rangeStart, rangeEnd), 0);
  }
  const wallSeconds = Math.max(0, (session.endTime - session.startTime) / 1000);
  if (!wallSeconds) return 0;
  return overlapSeconds(session.startTime, session.endTime, rangeStart, rangeEnd) * Math.min(1, session.focusedDurationSeconds / wallSeconds);
}

export function goalProgress(sessions: FocusSession[], now = Date.now()) {
  const day = localDayBounds(now), week = localWeekBounds(now);
  return {
    dailySeconds: Math.round(sessions.reduce((sum, session) => sum + sessionFocusedSecondsInRange(session, day.start, day.end), 0)),
    weeklySeconds: Math.round(sessions.reduce((sum, session) => sum + sessionFocusedSecondsInRange(session, week.start, week.end), 0)),
  };
}
