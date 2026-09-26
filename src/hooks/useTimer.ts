import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db";
import type { AcademicYear, Subject } from "../types";
import { ACTIVE_TIMER_STORAGE_KEY, closeRunningInterval, completedSession, extendTimerState, finishTimerState, focusedSecondsAt, idleTimerState, initialTimerState, normalizeTimerState, startTimerState, startStopwatchState, restoreExpiredTimer, type TimerState } from "../timerState";
import { handleTimerCompletion } from "../timerCompletion";
import { saveFocusSession } from "../saveFocusSession";
import { showToast } from "../toasts";
import { TIMER_STATE_CHANGED } from "../popoutLifecycle";

const CHANNEL = "focus-timer";
const TIMER_INITIALIZED_KEY = "focus.timerInitialized";

function readStored(): TimerState {
  try {
    const raw = localStorage.getItem(ACTIVE_TIMER_STORAGE_KEY);
    return raw ? normalizeTimerState(JSON.parse(raw)) : initialTimerState;
  } catch { return initialTimerState; }
}

function stateAt(state: TimerState, now = Date.now()) {
  if (state.mode === "stopwatch") return { ...state, remainingSeconds: focusedSecondsAt(state, now) };
  if (!state.running || state.paused || state.finished || !state.targetEnd) return state;
  return { ...state, remainingSeconds: Math.max(0, Math.ceil((state.targetEnd - now) / 1000)) };
}

export type TimerRecovery = "checking" | "running" | "relationship" | "save-failed" | null;

export function useTimer() {
  const isPopout = window.location.hash.includes("popout");
  const firstMainMount = !isPopout && sessionStorage.getItem(TIMER_INITIALIZED_KEY) !== "true";
  const initial = useRef(readStored());
  const [state, setState] = useState<TimerState>(() => stateAt(initial.current));
  const [recovery, setRecovery] = useState<TimerRecovery>(() => firstMainMount && initial.current.running && !initial.current.paused ? "checking" : null);
  const [saveError, setSaveError] = useState(false);
  const stateRef = useRef(state);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const completingRef = useRef(false);
  const noteTimerRef = useRef(0);
  const startupHandledRef = useRef(false);
  const retryLiveRef = useRef(false);
  const currentSubject = useLiveQuery(() => state.running && state.subjectId ? db.subjects.get(state.subjectId) : undefined, [state.running, state.subjectId]);

  const persist = useCallback((next: TimerState) => {
    if (next.running) localStorage.setItem(ACTIVE_TIMER_STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
    window.dispatchEvent(new Event(TIMER_STATE_CHANGED));
  }, []);

  const commit = useCallback((next: TimerState, shouldPersist = true) => {
    stateRef.current = next; setState(next);
    if (shouldPersist) persist(next);
    channelRef.current?.postMessage(next);
  }, [persist]);

  useEffect(() => {
    if (currentSubject && stateRef.current.subjectId === currentSubject.id && stateRef.current.subjectColor !== currentSubject.color) commit({ ...stateRef.current, subjectColor: currentSubject.color });
  }, [currentSubject, commit]);

  const saveAndClear = useCallback(async (snapshot: TimerState, endTime: number, live = false) => {
    const session = completedSession(snapshot, endTime);
    try {
      const notifications = session ? await saveFocusSession(session, live) : [];
      retryLiveRef.current = false;
      setSaveError(false); setRecovery(null); commit(idleTimerState(snapshot));
      // A notification transport failure must never turn a committed save into a failed one.
      for (const toast of notifications) { try { showToast(toast.message, toast.kind); } catch { /* Session is already safely saved. */ } }
      return true;
    } catch {
      retryLiveRef.current = live;
      const preserved = { ...closeRunningInterval(snapshot, endTime), saveFailed: true, finished: true, finishedAt: endTime, targetEnd: null, remainingSeconds: 0 };
      setSaveError(true); setRecovery("save-failed"); commit(preserved);
      return false;
    }
  }, [commit]);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => { const next = normalizeTimerState(event.data as TimerState); stateRef.current = next; setState(next); };
    channelRef.current = channel;
    return () => channel.close();
  }, []);

  useEffect(() => {
    if (!firstMainMount || startupHandledRef.current) return;
    startupHandledRef.current = true; sessionStorage.setItem(TIMER_INITIALIZED_KEY, "true");
    if (!initial.current.running) return;
    const stored = initial.current;
    void (async () => {
      if (stored.sessionId && await db.sessions.get(stored.sessionId)) { commit(idleTimerState(stored)); setRecovery(null); return; }
      if (stored.saveFailed) { setSaveError(true); setRecovery("save-failed"); return; }
      const [subject, year] = await Promise.all([db.subjects.get(stored.subjectId), db.academicYears.get(stored.academicYearId)]);
      if (!subject || subject.archived || !year || year.archived || subject.academicYearId !== year.id) { setRecovery("relationship"); return; }
      if (stored.paused) { setRecovery(null); return; }
      const restored = restoreExpiredTimer(stored);
      if (restored.finished) { commit(restored); setRecovery(null); return; }
      setRecovery("running");
    })();
  }, [commit, firstMainMount, saveAndClear]);

  const reconcile = useCallback(() => {
    const current = stateRef.current;
    if (recovery || !current.running || current.paused || current.finished) return;
    if (current.mode === "stopwatch") { setState(stateAt(current)); return; }
    if (!current.targetEnd) return;
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((current.targetEnd - now) / 1000));
    if (remaining > 0) { setState((value) => ({ ...value, remainingSeconds: remaining })); return; }
    if (completingRef.current) return;
    completingRef.current = true;
    const completed = finishTimerState(current, current.targetEnd);
    if (isPopout) { setState(completed); completingRef.current = false; return; }
    commit(completed);
    const effects = handleTimerCompletion(completed);
    void effects.finally(() => { completingRef.current = false; });
  }, [commit, isPopout, recovery]);

  useEffect(() => {
    reconcile();
    const id = window.setInterval(reconcile, 250);
    const wake = () => reconcile();
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    return () => { window.clearInterval(id); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [reconcile]);

  useEffect(() => {
    if (isPopout || recovery) return;
    const checkpoint = () => {
      const current = stateRef.current;
      if (!current.running || current.paused || current.finished || !current.runningSince) return;
      const now = Date.now(), snapshot = stateAt(current, now), focused = focusedSecondsAt(current, now);
      const intervals = now > current.runningSince ? [...current.focusIntervals, { startTime: current.runningSince, endTime: Math.min(now, current.targetEnd ?? now) }] : current.focusIntervals;
      commit({ ...snapshot, checkpointAt: now, checkpointRemainingSeconds: snapshot.remainingSeconds, checkpointFocusedSeconds: focused, checkpointIntervals: intervals });
    };
    const id = window.setInterval(checkpoint, 60_000);
    return () => window.clearInterval(id);
  }, [commit, isPopout, recovery]);

  useEffect(() => {
    const beforeUnload = () => persist(stateAt(stateRef.current));
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [persist]);

  const start = useCallback((seconds: number, subject: Subject, year: AcademicYear) => { if (seconds > 0 && Number.isFinite(seconds)) commit(startTimerState(stateRef.current, seconds, subject, year)); }, [commit]);

  const startStopwatch = useCallback((subject: Subject, year: AcademicYear) => commit(startStopwatchState(stateRef.current, subject, year)), [commit]);
  const dismissExpiredNotice = useCallback(() => commit({ ...stateRef.current, expiredNoticeDismissed: true }), [commit]);

  const pause = useCallback(() => {
    const current = stateAt(stateRef.current), now = Date.now();
    if (!current.running || current.finished) return;
    if (current.paused) commit({ ...current, paused: false, runningSince: now, targetEnd: current.mode === "stopwatch" ? null : now + current.remainingSeconds * 1000, checkpointAt: now, checkpointRemainingSeconds: current.remainingSeconds, checkpointFocusedSeconds: current.accumulatedFocusedSeconds, checkpointIntervals: current.focusIntervals });
    else commit({ ...closeRunningInterval(current, now), paused: true, targetEnd: null });
  }, [commit]);

  const stop = useCallback(async () => {
    const current = stateAt(stateRef.current), now = Date.now();
    if (current.running) await saveAndClear(current, current.finishedAt ?? now, true);
  }, [saveAndClear]);

  const finish = useCallback(async () => {
    const current = stateRef.current;
    if (current.running && current.finished) await saveAndClear(current, current.finishedAt ?? Date.now(), true);
  }, [saveAndClear]);

  const retrySave = useCallback(async () => {
    const current = stateRef.current;
    await saveAndClear(current, current.finishedAt ?? Date.now(), retryLiveRef.current);
  }, [saveAndClear]);

  const extend = useCallback((seconds: number) => { const current = stateRef.current; if (current.running) commit(extendTimerState(current, seconds)); }, [commit]);
  const setNote = useCallback((note: string) => {
    const next = { ...stateRef.current, note };
    stateRef.current = next; setState(next); channelRef.current?.postMessage(next);
    window.clearTimeout(noteTimerRef.current); noteTimerRef.current = window.setTimeout(() => persist(stateRef.current), 350);
  }, [persist]);

  const continueRecovery = useCallback(() => { const next = stateAt(stateRef.current); setRecovery(null); commit(next); }, [commit]);
  const resumeCheckpoint = useCallback(() => {
    const current = stateRef.current, now = Date.now();
    const next = { ...current, paused: false, finished: false, finishedAt: null, remainingSeconds: current.checkpointRemainingSeconds, accumulatedFocusedSeconds: current.checkpointFocusedSeconds, focusIntervals: current.checkpointIntervals, runningSince: now, targetEnd: current.mode === "stopwatch" ? null : now + current.checkpointRemainingSeconds * 1000, checkpointAt: now };
    setRecovery(null); commit(next);
  }, [commit]);
  const discard = useCallback(() => { setRecovery(null); setSaveError(false); commit(idleTimerState(stateRef.current)); }, [commit]);
  const reassign = useCallback((subject: Subject, year: AcademicYear) => {
    const next = { ...stateRef.current, subjectId: subject.id, subject: subject.name, subjectColor: subject.color, academicYearId: year.id, academicYearName: year.name };
    setRecovery(null); commit(restoreExpiredTimer(stateAt(next)));
  }, [commit]);

  const display = useMemo(() => {
    const total = Math.max(0, state.remainingSeconds);
    return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
  }, [state.remainingSeconds]);

  return { state, display, start, startStopwatch, dismissExpiredNotice, pause, stop, finish, extend, setNote, recovery, saveError, retrySave, continueRecovery, resumeCheckpoint, discard, reassign };
}
