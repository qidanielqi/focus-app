import { loadSettings, saveSetting } from "./settings";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import packageMetadata from "../package.json";
import { checkWithDiagnostics, classifyUpdateError, sanitizeUpdateError, type UpdateCategory } from "./updateDiagnostics";

type UpdateCandidate = Pick<Update, "version" | "body" | "downloadAndInstall" | "close">;
type Phase = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "restarting" | "error";
export type UpdateState = {
  phase: Phase;
  currentVersion: string;
  availableVersion?: string;
  notes?: string;
  promptOpen: boolean;
  automaticPrompt?: boolean;
  downloaded: number;
  contentLength?: number;
  error?: "check" | "install" | "restart";
  checkCategory?: UpdateCategory;
};
type Dependencies = { startupEnabled?: () => Promise<boolean>; disableStartup?: () => Promise<void>; enabled: () => boolean; version: () => Promise<string>; check: (manual: boolean) => Promise<UpdateCandidate | null>; restart: () => Promise<void> };

/** One controller per main-window lifetime: Settings, About and startup share requests and dismissals. */
export function createUpdateController(deps: Dependencies) {
  let state: UpdateState = { phase: "idle", currentVersion: packageMetadata.version, promptOpen: false, downloaded: 0 };
  const listeners = new Set<() => void>(), dismissed = new Set<string>();
  let candidate: UpdateCandidate | null = null;
  let inFlight: Promise<void> | undefined;
  let manualRequested = false, started = false;
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const busy = () => ["downloading", "installing", "restarting"].includes(state.phase);
  const runCheck = (manual = false): Promise<void> => {
    if (busy()) return Promise.resolve();
    manualRequested ||= manual;
    if (inFlight) { if (manual) set({ phase: "checking" }); return inFlight; }
    set({ phase: manual ? "checking" : state.phase, error: undefined, checkCategory: undefined });
    inFlight = (async () => {
      try {
        await Promise.resolve();
        if (!deps.enabled()) throw new Error("Native updater unavailable");
        const version = await deps.version();
        set({ currentVersion: version });
        const next = await deps.check(manualRequested);
        if (candidate && candidate !== next) await candidate.close().catch(() => undefined);
        candidate = next;
        if (next) set({ phase: "available", availableVersion: next.version, notes: next.body, automaticPrompt: !manualRequested, promptOpen: manualRequested || !dismissed.has(next.version) });
        else set({ phase: manualRequested ? "current" : "idle", availableVersion: undefined, notes: undefined, promptOpen: false });
      } catch (error) {
        // Offline startup is normal. Only explicit manual checks surface a non-destructive error.
        set({ phase: manualRequested ? "error" : "idle", error: manualRequested ? "check" : undefined, checkCategory: classifyUpdateError(error), promptOpen: false });
      } finally { inFlight = undefined; manualRequested = false; }
    })();
    return inFlight;
  };
  const restart = async () => {
    set({ phase: "restarting", error: undefined });
    try { await deps.restart(); } catch { set({ phase: "error", error: "restart" }); }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check: runCheck,
    start: async () => {
      if (started || !deps.enabled()) return;
      started = true;
      try { if (await (deps.startupEnabled?.() ?? Promise.resolve(true))) await runCheck(); }
      catch { /* Preference storage unavailable: skip the automatic network check. */ }
    },
    dontShowAgain: async () => {
      if (busy() || !state.automaticPrompt) return;
      await deps.disableStartup?.();
      if (candidate) dismissed.add(candidate.version);
      set({ promptOpen: false });
    },
    later: () => { if (busy()) return; if (candidate) dismissed.add(candidate.version); set({ promptOpen: false, error: undefined, phase: candidate ? "available" : "idle" }); },
    install: async () => {
      if (!candidate || busy() || inFlight || !state.promptOpen) return;
      if (state.error === "restart") { await restart(); return; }
      set({ phase: "downloading", downloaded: 0, contentLength: undefined, error: undefined });
      try {
        // Only Tauri downloads, verifies the embedded public-key signature and invokes the installer.
        // Windows exits when its installer starts; other supported platforms need an explicit restart.
        await candidate.downloadAndInstall((event: DownloadEvent) => {
          if (event.event === "Started") set({ contentLength: event.data.contentLength });
          if (event.event === "Progress") set({ downloaded: state.downloaded + event.data.chunkLength });
          if (event.event === "Finished") set({ phase: "installing" });
        });
        await restart();
      } catch (error) {
        if (import.meta.env.DEV) console.info("Focus updater install", { category: classifyUpdateError(error), error: sanitizeUpdateError(error) });
        set({ phase: "error", error: "install" });
      }
    },
  };
}

export const updater = createUpdateController({ enabled: isTauri, version: getVersion, check: checkWithDiagnostics, restart: relaunch, startupEnabled: async () => (await loadSettings()).checkForUpdatesOnLaunch, disableStartup: () => saveSetting("checkForUpdatesOnLaunch", false) });
