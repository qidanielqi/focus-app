import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ACTIVE_TIMER_STORAGE_KEY } from "../timerState";
import { activePopoutSession, synchronizePopoutSession, TIMER_STATE_CHANGED } from "../popoutLifecycle";

/** Lives in the main shell, so navigation and Timer-page unmounts cannot suspend lifecycle reconciliation. */
export function usePopoutLifecycle(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let disposed = false;
    let previous: string | undefined;
    const reconcile = () => {
      if (disposed) return;
      const session = activePopoutSession();
      const signature = JSON.stringify(session);
      if (signature !== previous) {
        previous = signature;
        void navigator.locks.request("focus.popout.geometry", () => synchronizePopoutSession()).catch(console.error);
      }
    };
    const storage = (event: StorageEvent) => { if (event.key === ACTIVE_TIMER_STORAGE_KEY || event.key === null) reconcile(); };
    const channel = new BroadcastChannel("focus-timer");
    channel.onmessage = reconcile;
    window.addEventListener(TIMER_STATE_CHANGED, reconcile);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    reconcile();
    return () => {
      disposed = true; channel.close();
      window.removeEventListener(TIMER_STATE_CHANGED, reconcile);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [enabled]);
}
