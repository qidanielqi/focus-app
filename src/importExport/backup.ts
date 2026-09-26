import packageMetadata from "../../package.json";
import { db, type FocusDatabase } from "../db";
import { loadSettings, normalizeLegacyRevealShortcut, SETTINGS_KEYS, type FocusSettings } from "../settings";
import type { AcademicYear, AppSetting, FocusSession, Subject } from "../types";
import type { BackupAnalysis, ConflictPolicy, FocusBackup, ImportSummary, RestoreMode } from "./types";

export const BACKUP_FORMAT = "focus-backup" as const;
export const BACKUP_VERSION = 1 as const;
export const APP_VERSION = packageMetadata.version;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isBoolean = (value: unknown) => typeof value === "boolean";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export async function createBackup(database: FocusDatabase = db): Promise<FocusBackup> {
  const [academicYears, subjects, sessions, storedSettings, currentSettings] = await Promise.all([
    database.academicYears.toArray(), database.subjects.toArray(), database.sessions.toArray(), database.settings.toArray(),
    loadSettings(database),
  ]);
  const settingsByKey = new Map(storedSettings.filter(setting => setting.key !== "popoutCloseOnCompletion").map((setting) => [setting.key, setting]));
  for (const key of Object.keys(SETTINGS_KEYS) as (keyof FocusSettings)[]) {
    settingsByKey.set(SETTINGS_KEYS[key], { key: SETTINGS_KEYS[key], value: String(currentSettings[key]) });
  }
  const settings = [...settingsByKey.values()];
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, data: { academicYears, subjects, sessions, settings } };
}

export function validateBackup(value: unknown): FocusBackup {
  if (!isObject(value) || value.format !== BACKUP_FORMAT) throw new Error("This is not a Focus backup.");
  if (value.formatVersion !== BACKUP_VERSION) throw new Error(`Unsupported Focus backup version: ${String(value.formatVersion)}.`);
  if (typeof value.exportedAt !== "string" || typeof value.appVersion !== "string" || !isObject(value.data)) throw new Error("The backup header is incomplete.");
  const { academicYears, subjects, sessions, settings } = value.data;
  if (![academicYears, subjects, sessions, settings].every(Array.isArray)) throw new Error("The backup data structure is incomplete.");
  const years = academicYears as unknown[];
  const subjectRows = subjects as unknown[];
  const sessionRows = sessions as unknown[];
  const settingRows = settings as unknown[];
  const yearIds = new Set<string>();
  years.forEach((row, index) => {
    if (!isObject(row) || typeof row.id !== "string" || !row.id.trim() || typeof row.name !== "string" || !isBoolean(row.archived)) throw new Error(`Invalid Academic Year at item ${index + 1}.`);
    if (yearIds.has(row.id)) throw new Error(`Duplicate Academic Year ID: ${row.id}.`);
    yearIds.add(row.id);
  });
  const subjectIds = new Set<string>();
  subjectRows.forEach((row, index) => {
    if (!isObject(row) || typeof row.id !== "string" || !row.id.trim() || typeof row.name !== "string" || typeof row.academicYearId !== "string" || typeof row.color !== "string" || !isBoolean(row.archived)) throw new Error(`Invalid Subject at item ${index + 1}.`);
    if (!yearIds.has(row.academicYearId)) throw new Error(`Subject "${row.name}" references a missing Academic Year.`);
    if (subjectIds.has(row.id)) throw new Error(`Duplicate Subject ID: ${row.id}.`);
    subjectIds.add(row.id);
  });
  const sessionIds = new Set<string>();
  sessionRows.forEach((row, index) => {
    if (!isObject(row) || typeof row.id !== "string" || !row.id.trim() || typeof row.subjectId !== "string" || typeof row.subjectName !== "string" || typeof row.academicYearId !== "string" || typeof row.academicYearName !== "string" || !isFiniteNumber(row.startTime) || !isFiniteNumber(row.endTime) || !isFiniteNumber(row.focusedDurationSeconds) || !isBoolean(row.archived) || row.endTime <= row.startTime || row.focusedDurationSeconds <= 0 || (row.durationMode !== undefined && row.durationMode !== "locked" && row.durationMode !== "unlocked")) throw new Error(`Invalid Session at item ${index + 1}.`);
    if (!subjectIds.has(row.subjectId)) throw new Error(`Session ${row.id} references a missing Subject.`);
    if (sessionIds.has(row.id)) throw new Error(`Duplicate Session ID: ${row.id}.`);
    sessionIds.add(row.id);
  });
  settingRows.forEach((row, index) => { if (!isObject(row) || typeof row.key !== "string" || typeof row.value !== "string") throw new Error(`Invalid Setting at item ${index + 1}.`); });
  return value as FocusBackup;
}

const equivalent = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export async function analyzeBackup(backup: FocusBackup, database: FocusDatabase = db): Promise<BackupAnalysis> {
  let duplicates = 0, conflicts = 0;
  for (const [table, rows] of [[database.academicYears, backup.data.academicYears], [database.subjects, backup.data.subjects], [database.sessions, backup.data.sessions]] as const) {
    for (const row of rows) { const existing = await table.get(row.id); if (existing) equivalent(existing, row) ? duplicates++ : conflicts++; }
  }
  for (const setting of backup.data.settings) { if (setting.key === "popoutCloseOnCompletion") continue; const existing = await database.settings.get(setting.key); if (existing) equivalent(existing, setting) ? duplicates++ : conflicts++; }
  return { backup, duplicates, conflicts };
}

export async function restoreBackup(backup: FocusBackup, mode: RestoreMode, policy: ConflictPolicy, database: FocusDatabase = db): Promise<ImportSummary> {
  const summary: ImportSummary = { academicYearsCreated: 0, subjectsCreated: 0, sessionsImported: 0, duplicatesSkipped: 0, conflicts: 0, invalidRowsSkipped: 0 };
  await database.transaction("rw", database.academicYears, database.subjects, database.sessions, database.settings, async () => {
    if (mode === "replace") await Promise.all([database.sessions.clear(), database.subjects.clear(), database.academicYears.clear(), database.settings.clear()]);
    const apply = async <T extends { id: string }>(table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<unknown> }, rows: T[], counter: keyof Pick<ImportSummary, "academicYearsCreated" | "subjectsCreated" | "sessionsImported">) => {
      for (const row of rows) {
        const existing = await table.get(row.id);
        if (!existing) { await table.put(row); summary[counter]++; }
        else if (equivalent(existing, row)) summary.duplicatesSkipped++;
        else { summary.conflicts++; if (policy === "use-imported") await table.put(row); }
      }
    };
    await apply(database.academicYears, backup.data.academicYears, "academicYearsCreated");
    await apply(database.subjects, backup.data.subjects, "subjectsCreated");
    await apply(database.sessions, backup.data.sessions, "sessionsImported");
    for (const setting of backup.data.settings) { if (setting.key === "popoutCloseOnCompletion") continue; const existing = await database.settings.get(setting.key); if (!existing || policy === "use-imported" || mode === "replace") await database.settings.put(setting.key === SETTINGS_KEYS.popoutRevealShortcut ? { ...setting, value: normalizeLegacyRevealShortcut(setting.value) } : setting); else if (equivalent(existing, setting)) summary.duplicatesSkipped++; else summary.conflicts++; }
  });
  return summary;
}

export function parseBackupText(text: string) { let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new Error("The selected file is not valid JSON."); } return validateBackup(parsed); }
export function backupFilename(now = new Date()) { const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return `focus-backup-${local}.json`; }
