import { isTauri } from "@tauri-apps/api/core";
import type { UpdateState } from "./updater";

// Deliberately owns no updater candidate, IPC, download, or relaunch functions.
let state: UpdateState | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
export const updatePreview = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  open: (currentVersion: string) => {
    if (!import.meta.env.DEV || !isTauri()) return;
    const [major, minor, patch] = currentVersion.split(".").map(part => parseInt(part, 10) || 0);
    state = {
      phase: "available", currentVersion, availableVersion: `${major}.${minor}.${patch + 1}`,
      promptOpen: true, automaticPrompt: false, downloaded: 0,
      notes: "## A little more focus\n\nThis preview uses **sample release notes** to demonstrate the update dialog.\n\n### Improvements\n- A smoother transition between study sessions.\n- Clearer feedback when saving your work.\n- More consistent keyboard navigation.\n\n### Fixes\n- Improved recovery of paused sessions.\n- Refined layout at smaller window sizes.\n- Updated translations throughout Settings.\n\n### Tips\nUse `Ctrl + Alt + F` to reveal the timer Popout. Your study data stays on this device.\n\nRead the [Focus source and release information](https://github.com/catcredibly/study-app).\n\n### Before you continue\nThese notes are for visual inspection only. No update will be downloaded or installed from this preview.",
    };
    publish();
  },
  close: () => { state = null; publish(); },
};
