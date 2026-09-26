import { invoke, isTauri } from "@tauri-apps/api/core";
import { ACTIVE_TIMER_STORAGE_KEY, type TimerState } from "./timerState";

export const TIMER_STATE_CHANGED = "focus:timer-state-changed";
export const POPOUT_CLOSED = "focus:popout-closed";

/** Finished Timers remain extendable until the Session is finalized or voided. */
export function activePopoutSession() {
  try {
    const timer = JSON.parse(localStorage.getItem(ACTIVE_TIMER_STORAGE_KEY) ?? "null") as TimerState | null;
    if (timer?.running && timer.sessionId) return { sessionId: timer.sessionId, deadline: null };
  } catch { /* Invalid recovery state must never create an empty window. */ }
  return null;
}

/** Call inside the shared geometry lock; always read current storage, not a React snapshot. */
export async function synchronizePopoutSession() {
  const session = activePopoutSession();
  await invoke("sync_popout_session", { sessionId: session?.sessionId ?? null, deadline: session?.deadline ?? null });
  return session;
}

export async function closeTimerPopout() {
  window.dispatchEvent(new Event(POPOUT_CLOSED));
  // Do not queue Close behind geometry work. Native generation invalidation
  // prevents the work already in progress from showing the windows afterward.
  if (isTauri()) await invoke("hide_timer_popout");
}
