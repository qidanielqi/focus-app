import { db } from "../db";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, reconcileDefaultSubject, loadSettings, saveSetting, type FocusSettings } from "../settings";

// Match the early HTML paint while IndexedDB loads; this is only a theme hint,
// never a replacement for persisted settings or a reason to delay rendering.
const initialSettings: FocusSettings = {
  ...DEFAULT_SETTINGS,
  theme: typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark",
};

export function useSettings() {
  const [migrated, setMigrated] = useState(false);
  // Dexie live queries are read-only; complete compatibility writes outside them.
  useEffect(() => { let active = true; void loadSettings().then(() => { if (active) setMigrated(true); }).catch(console.error); return () => { active = false; }; }, []);
  const stored = useLiveQuery(async () => { if (!migrated) return; await db.subjects.toArray(); await db.academicYears.toArray(); return loadSettings(undefined, false); }, [migrated]);
  useEffect(() => { if (stored) void reconcileDefaultSubject().catch(console.error); }, [stored]);
  const settings = stored ?? initialSettings;
  const setSetting = useCallback(<K extends keyof FocusSettings>(key: K, value: FocusSettings[K]) => saveSetting(key, value), []);
  return {
    settings,
    loaded: stored !== undefined,
    setSetting,
  };
}
