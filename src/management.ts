import { db, type FocusDatabase } from "./db";
import { CURRENT_YEAR_KEY } from "./data";
import type { AcademicYear, FocusSession, Subject } from "./types";
import type { DurationMode } from "./sessionDuration";
import { sessionSpanSeconds } from "./sessionDuration";

export function isSessionEffectivelyArchived(session: FocusSession, subjects: Subject[], years: AcademicYear[]) {
  const subject = subjects.find((item) => item.id === session.subjectId);
  const year = years.find((item) => item.id === session.academicYearId);
  return Boolean(subject?.archived || year?.archived);
}

export async function setAcademicYearArchived(id: string, archived: boolean, database: FocusDatabase = db) {
  await database.academicYears.update(id, { archived });
}

export async function deleteSubjectCascade(id: string, database: FocusDatabase = db) {
  await database.transaction("rw", database.subjects, database.sessions, async () => {
    await database.sessions.where("subjectId").equals(id).delete();
    await database.subjects.delete(id);
  });
}

export async function deleteAcademicYearCascade(id: string, database: FocusDatabase = db) {
  await database.transaction("rw", database.academicYears, database.subjects, database.sessions, database.settings, async () => {
    const subjectIds = (await database.subjects.where("academicYearId").equals(id).primaryKeys()) as string[];
    if (subjectIds.length) await database.sessions.where("subjectId").anyOf(subjectIds).delete();
    await database.sessions.where("academicYearId").equals(id).delete();
    await database.subjects.where("academicYearId").equals(id).delete();
    await database.academicYears.delete(id);
    if ((await database.settings.get(CURRENT_YEAR_KEY))?.value === id) {
      const replacement = await database.academicYears.filter((year) => !year.archived).first();
      if (replacement) await database.settings.put({ key: CURRENT_YEAR_KEY, value: replacement.id });
      else await database.settings.delete(CURRENT_YEAR_KEY);
    }
  });
}

export async function deleteSession(id: string, database: FocusDatabase = db) {
  await database.sessions.delete(id);
}

export async function deleteSessions(ids: string[], database: FocusDatabase = db) {
  await database.transaction("rw", database.sessions, () => database.sessions.bulkDelete(ids));
}

export async function moveSessions(ids: string[], subjectId: string, database: FocusDatabase = db) {
  await database.transaction("rw", database.academicYears, database.subjects, database.sessions, async () => {
    const subject = await database.subjects.get(subjectId);
    if (!subject || subject.archived) throw new Error("Choose an active Subject.");
    const academicYear = await database.academicYears.get(subject.academicYearId);
    if (!academicYear || academicYear.archived) throw new Error("Choose a Subject in an active Academic Year.");
    await database.sessions.where("id").anyOf(ids).modify({
      subjectId: subject.id,
      subjectName: subject.name,
      academicYearId: academicYear.id,
      academicYearName: academicYear.name,
    });
  });
}

export async function updateSessionDetails(id: string, input: { academicYearId: string; subjectId: string; startTime: number; endTime: number; focusedDurationSeconds: number; durationMode: DurationMode; note?: string }, database: FocusDatabase = db) {
  await database.transaction("rw", database.academicYears, database.subjects, database.sessions, async () => {
    const session = await database.sessions.get(id);
    const subject = await database.subjects.get(input.subjectId);
    const academicYear = await database.academicYears.get(input.academicYearId);
    if (!session) throw new Error("Session not found.");
    if (!subject || !academicYear || subject.academicYearId !== academicYear.id) throw new Error("Choose a Subject from the selected Academic Year.");
    if (!Number.isFinite(input.startTime) || !Number.isFinite(input.endTime) || input.endTime <= input.startTime) throw new Error("End time must be after start time.");
    const spanSeconds = sessionSpanSeconds(input.startTime, input.endTime);
    const focusedDurationSeconds = input.durationMode === "locked" ? spanSeconds : Math.round(input.focusedDurationSeconds);
    if (focusedDurationSeconds <= 0) throw new Error("Duration must be greater than zero.");
    if (focusedDurationSeconds > spanSeconds) throw new Error("Duration cannot exceed the available Start and End span.");
    await database.sessions.update(id, {
      subjectId: subject.id,
      subjectName: subject.name,
      academicYearId: academicYear.id,
      academicYearName: academicYear.name,
      startTime: input.startTime,
      endTime: input.endTime,
      focusedDurationSeconds,
      durationMode: input.durationMode,
      // Recorded intervals describe the original timer, not manually edited timing.
      focusIntervals: session.startTime === input.startTime && session.endTime === input.endTime && session.focusedDurationSeconds === focusedDurationSeconds ? session.focusIntervals : undefined,
      note: input.note?.trim() || undefined,
    });
  });
}

export function canDeleteManagedRecord(archived: boolean, allowDirectActiveDeletion: boolean) {
  return archived || allowDirectActiveDeletion;
}
