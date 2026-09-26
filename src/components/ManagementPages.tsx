import { nextSubjectColor } from "../subjectColors";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, CalendarDays, Check, Lock, LockOpen, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { db } from "../db";
import { createSession, CURRENT_YEAR_KEY, formatDuration, makeId, setCurrentAcademicYear } from "../data";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { localDateInputValue } from "../timerState";
import { canDeleteManagedRecord, deleteAcademicYearCascade, deleteSession, deleteSessions, deleteSubjectCascade, isSessionEffectivelyArchived, moveSessions, setAcademicYearArchived, updateSessionDetails } from "../management";
import { managementViewState } from "../managementViewState";
import { useSettings } from "../hooks/useSettings";
import { useTranslation } from "react-i18next";
import { localeCode } from "../i18n";
import { durationParts, formatClockDuration, inferDurationMode, normalizeDurationParts, sessionSpanSeconds, type DurationMode } from "../sessionDuration";


const activeTimerRelationship = () => {
  try {
    const timer = JSON.parse(localStorage.getItem("focus.activeTimer") ?? "null");
    return timer?.sessionId && timer?.startedAt ? { subjectId: String(timer.subjectId ?? ""), academicYearId: String(timer.academicYearId ?? "") } : undefined;
  } catch { return undefined; }
};
const dateText = (value?: string) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(localeCode(), {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No dates set";

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

function DeleteConfirmation({ title, children, onCancel, onDelete, deleteLabel = "Delete" }: { title: string; children: React.ReactNode; onCancel: () => void; onDelete: () => Promise<void>; deleteLabel?: string }) {
  const { t } = useTranslation();
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="delete-confirmation">
        <p>{children}</p>
        <p>{t("This action cannot be undone.")}</p>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>{t("Cancel")}</button>
        <button type="button" className="danger-action" onClick={onDelete}>{t(deleteLabel)}</button>
      </div>
    </Modal>
  );
}

export function AcademicYearsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const years = useLiveQuery(() => db.academicYears.orderBy("name").toArray(), []) ?? [];
  const currentId = useLiveQuery(async () => (await db.settings.get(CURRENT_YEAR_KEY))?.value ?? "", []) ?? "";
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const [archived, setArchivedState] = useState(managementViewState.academicYearsArchived);
  const setArchived = (value: boolean) => { managementViewState.academicYearsArchived = value; setArchivedState(value); };
  const [editing, setEditing] = useState<AcademicYear | null | undefined>();
  const [deleting, setDeleting] = useState<AcademicYear>();
  const [warning, setWarning] = useState("");
  const academicYearIsActive = (id: string) => activeTimerRelationship()?.academicYearId === id;
  const save = async (form: FormData) => {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const year: AcademicYear = {
      id: editing?.id ?? makeId(),
      name,
      startDate: String(form.get("startDate") || "") || undefined,
      endDate: String(form.get("endDate") || "") || undefined,
      archived: editing?.archived ?? false,
    };
    await db.academicYears.put(year);
    if (!currentId && !year.archived) await setCurrentAcademicYear(year.id);
    setEditing(undefined);
  };
  return (
    <main className="page">
      <PageHeader
        title={t("Academic Years")}
        subtitle={t("Organise subjects without forcing calendar ranges to be exclusive.")}
        action={
          <button className="primary-action" onClick={() => setEditing(null)}>
            <Plus size={17} /> {t("Add Academic Year")}
          </button>
        }
      />
      <div className="tabs">
        <button className={!archived ? "active" : ""} onClick={() => setArchived(false)}>
          {t("Active")}
        </button>
        <button className={archived ? "active" : ""} onClick={() => setArchived(true)}>
          {t("Archived")}
        </button>
      </div>
      <div className="data-list">
        {years
          .filter((y) => y.archived === archived)
          .map((year) => {
            const yearSubjects = subjects.filter((s) => s.academicYearId === year.id);
            const ids = new Set(yearSubjects.map((s) => s.id));
            const total = sessions.filter((s) => ids.has(s.subjectId) && !s.archived).reduce((n, s) => n + s.focusedDurationSeconds, 0);
            return (
              <article className="data-row" key={year.id}>
                <CalendarDays />
                <div className="row-main">
                  <strong>
                    {year.name} {currentId === year.id && <span className="badge">{t("Current")}</span>}
                  </strong>
                  <span>{year.startDate ? `${dateText(year.startDate)} - ${dateText(year.endDate)}` : t("Flexible dates")}</span>
                  <small>
                    {t("{{count}} subjects", { count: yearSubjects.length })} · {formatDuration(total)}
                  </small>
                </div>
                <div className="row-actions">
                  <button title={t("Edit")} onClick={() => setEditing(year)}>
                    <Pencil />
                  </button>
                  {!year.archived && currentId !== year.id && (
                    <button title={t("Set current")} onClick={() => setCurrentAcademicYear(year.id)}>
                      <Check />
                    </button>
                  )}
                  <button
                    title={t(year.archived ? "Restore" : "Archive")}
                    onClick={async () => {
                      if (!year.archived && academicYearIsActive(year.id)) { setWarning(t("This Academic Year is used by the active timer. Finish or discard the timer before archiving it.")); return; }
                      if (!year.archived && currentId === year.id) { setWarning(t("Choose another current Academic Year before archiving this one.")); return; }
                      await setAcademicYearArchived(year.id, !year.archived);
                    }}
                  >
                    {year.archived ? <RotateCcw /> : <Archive />}
                  </button>
                  {canDeleteManagedRecord(year.archived, settings.allowDirectActiveDeletion) && <button className="danger-icon" title={t("Delete permanently")} onClick={() => academicYearIsActive(year.id) ? setWarning(t("This Academic Year is used by the active timer. Finish or discard the timer before deleting it.")) : setDeleting(year)}><Trash2/></button>}
                </div>
              </article>
            );
          })}
      </div>
      {!years.some((y) => y.archived === archived) && (
        <div className="empty-state">
          <h2>{t(archived ? "No archived Academic Years" : "Create your first Academic Year")}</h2>
          <p>{t(archived ? "Archived Academic Years will remain available here." : "Add a year, course period, or Independent Study.")}</p>
        </div>
      )}
      {editing !== undefined && (
        <Modal title={t(editing ? "Edit Academic Year" : "New Academic Year")} onClose={() => setEditing(undefined)}>
          <form action={save} className="form">
            <label>
              {t("Name")}
              <input name="name" defaultValue={editing?.name} required autoFocus />
            </label>
            <div className="form-grid">
              <label>
                {t("Start date")}
                <input type="date" name="startDate" defaultValue={editing?.startDate} />
              </label>
              <label>
                {t("End date")}
                <input type="date" name="endDate" defaultValue={editing?.endDate} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                {t("Cancel")}
              </button>
              <button className="primary-action">{t("Save")}</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (() => { const affectedSubjects = subjects.filter((subject) => subject.academicYearId === deleting.id); const ids = new Set(affectedSubjects.map((subject) => subject.id)); const affectedSessions = sessions.filter((session) => session.academicYearId === deleting.id || ids.has(session.subjectId)); const total = affectedSessions.reduce((sum, session) => sum + session.focusedDurationSeconds, 0); return <DeleteConfirmation title={t("Delete Academic Year?")} deleteLabel="Delete Academic Year and Data" onCancel={() => setDeleting(undefined)} onDelete={async () => { await deleteAcademicYearCascade(deleting.id); setDeleting(undefined); }}>{t("Permanently delete Academic Year with data", { name: deleting.name, subjects: affectedSubjects.length, sessions: affectedSessions.length, duration: formatDuration(total) })}</DeleteConfirmation>; })()}
      {warning && <Modal title={t("Active timer protected")} onClose={() => setWarning("")}><p>{warning}</p><div className="modal-actions"><button className="primary-action" onClick={() => setWarning("")}>{t("OK")}</button></div></Modal>}
    </main>
  );
}

export function SubjectsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const years = useLiveQuery(() => db.academicYears.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const currentId = useLiveQuery(async () => (await db.settings.get(CURRENT_YEAR_KEY))?.value ?? "", []) ?? "";
  const [yearId, setYearId] = useState("current");
  const [archived, setArchivedState] = useState(managementViewState.subjectsArchived);
  const setArchived = (value: boolean) => { managementViewState.subjectsArchived = value; setArchivedState(value); };
  const [deleting, setDeleting] = useState<Subject>();
  const [editing, setEditing] = useState<Subject | null | undefined>();
  const [warning, setWarning] = useState("");
  const selectedYear = yearId === "current" ? currentId : yearId;
  const save = async (form: FormData) => {
    const name = String(form.get("name") ?? "").trim();
    const academicYearId = String(form.get("year"));
    if (!name || !academicYearId) return;
    await db.subjects.put({
      id: editing?.id ?? makeId(),
      academicYearId,
      name,
      color: editing?.color ?? nextSubjectColor(subjects, academicYearId),
      archived: editing?.archived ?? false,
    });
    setEditing(undefined);
  };
  const visible = subjects.filter((s) => s.archived === archived && (selectedYear === "all" || !selectedYear || s.academicYearId === selectedYear));
  const subjectIsActive = (id: string) => activeTimerRelationship()?.subjectId === id;
  return (
    <main className="page">
      <PageHeader
        title={t("Subjects")}
        subtitle={t("Manage lightweight subjects within each Academic Year.")}
        action={
          <button className="primary-action" disabled={!years.some((y) => !y.archived)} onClick={() => setEditing(null)}>
            <Plus /> {t("Add Subject")}
          </button>
        }
      />
      <div className="filter-bar">
        <label>
          {t("Academic Year")}
          <select value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="current">{t("Current Academic Year")}</option>
            <option value="all">{t("All Academic Years")}</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.id === currentId ? ` (${t("Current")})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tabs">
        <button className={!archived ? "active" : ""} onClick={() => setArchived(false)}>
          {t("Active")}
        </button>
        <button className={archived ? "active" : ""} onClick={() => setArchived(true)}>
          {t("Archived")}
        </button>
      </div>
      <div className="data-list">
        {visible.map((subject) => {
          const used = sessions.filter((s) => s.subjectId === subject.id);
          const total = used.reduce((n, s) => n + s.focusedDurationSeconds, 0);
          const active = subjectIsActive(subject.id);
          return (
            <article className="data-row" key={subject.id}>
              <span className="list-dot" style={{ background: subject.color }} />
              <div className="row-main">
                <strong>{subject.name}</strong>
                <span>{years.find((y) => y.id === subject.academicYearId)?.name ?? t("Unknown Academic Year")}</span>
                <small>
                  {t("{{count}} sessions", { count: used.length })} · {formatDuration(total)}
                </small>
              </div>
              <div className="row-actions">
                <button title={t("Edit")} onClick={() => setEditing(subject)}>
                  <Pencil />
                </button>
                <button
                  title={t(subject.archived ? "Restore" : "Archive")}
                  onClick={() => active && !subject.archived ? setWarning(t("This Subject is used by the active timer. Finish or discard the timer before archiving it.")) : void db.subjects.update(subject.id, { archived: !subject.archived })
                  }
                >
                  {subject.archived ? <RotateCcw /> : <Archive />}
                </button>
                {canDeleteManagedRecord(subject.archived, settings.allowDirectActiveDeletion) && (
                  <button className="danger-icon" title={t("Delete permanently")} onClick={() => active ? setWarning(t("This Subject is used by the active timer. Finish or discard the timer before deleting it.")) : setDeleting(subject)}>
                    <Trash2 />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="empty-state">
          <h2>{t(archived ? "No archived Subjects" : "Add a Subject to start tracking focus time")}</h2>
        </div>
      )}
      {editing !== undefined && (
        <Modal title={t(editing ? "Edit Subject" : "New Subject")} onClose={() => setEditing(undefined)}>
          <form action={save} className="form">
            <label>
              {t("Name")}
              <input name="name" defaultValue={editing?.name} required autoFocus />
            </label>
            <label>
              {t("Academic Year")}
              <select name="year" defaultValue={editing?.academicYearId || currentId} required>
                {years
                  .filter((y) => !y.archived || y.id === editing?.academicYearId)
                  .map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                {t("Cancel")}
              </button>
              <button className="primary-action">{t("Save")}</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (() => { const affected = sessions.filter((session) => session.subjectId === deleting.id); const total = affected.reduce((sum, session) => sum + session.focusedDurationSeconds, 0); return <DeleteConfirmation title={t("Delete Subject?")} deleteLabel="Delete Subject and Data" onCancel={() => setDeleting(undefined)} onDelete={async () => { await deleteSubjectCascade(deleting.id); setDeleting(undefined); }}>{t("Permanently delete Subject with data", { name: deleting.name, sessions: affected.length, duration: formatDuration(total) })}</DeleteConfirmation>; })()}
      {warning && <Modal title={t("Active timer protected")} onClose={() => setWarning("")}><p>{warning}</p><div className="modal-actions"><button className="primary-action" onClick={() => setWarning("")}>{t("OK")}</button></div></Modal>}
    </main>
  );
}

const timeInputValue = (stamp: number) => new Date(stamp).toTimeString().slice(0, 5);
const durationInputFields = (seconds: number) => {
  const parts = durationParts(seconds);
  return { hours: String(parts.hours).padStart(2, "0"), minutes: String(parts.minutes).padStart(2, "0") };
};

function SessionEditor({ session, years, subjects, currentYearId, onClose }: { currentYearId: string; session: FocusSession | null; years: AcademicYear[]; subjects: Subject[]; onClose: () => void }) {
  const { t } = useTranslation();
  const initialYearId = session?.academicYearId ?? currentYearId;
  const initialSubjectId = session?.subjectId ?? subjects.find((subject) => subject.academicYearId === initialYearId && !subject.archived)?.id ?? "";
  const [openedAt] = useState(() => Date.now());
  const initialEnd = session?.endTime ?? openedAt;
  // This editor has one date field; keep the suggested start on that same day.
  const initialStart = session?.startTime ?? Math.max(new Date(openedAt).setHours(0, 0, 0, 0), openedAt - 3_600_000);
  const initialMode = session ? inferDurationMode(session) : "locked";
  const [academicYearId, setAcademicYearId] = useState(initialYearId);
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [date, setDate] = useState(localDateInputValue(initialStart));
  const [start, setStart] = useState(timeInputValue(initialStart));
  const [end, setEnd] = useState(timeInputValue(initialEnd));
  const [mode, setMode] = useState<DurationMode>(initialMode);
  const [duration, setDuration] = useState(() => durationInputFields(session?.focusedDurationSeconds ?? sessionSpanSeconds(initialStart, initialEnd)));
  const [preserveStoredDuration, setPreserveStoredDuration] = useState(Boolean(session && initialMode === "unlocked"));
  const [note, setNote] = useState(session?.note ?? "");
  const [relockPending, setRelockPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const availableSubjects = subjects.filter((subject) => subject.academicYearId === academicYearId && (session || !subject.archived));
  useEffect(() => { if (!session && academicYearId !== currentYearId) { setAcademicYearId(currentYearId); setSubjectId(""); } }, [session, academicYearId, currentYearId]);
  const startTime = new Date(`${date}T${start}`).getTime();
  const endTime = new Date(`${date}T${end}`).getTime();
  const validSpan = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime;
  const spanSeconds = validSpan ? sessionSpanSeconds(startTime, endTime) : 0;
  const normalizedDuration = normalizeDurationParts(Number(duration.hours), Number(duration.minutes), 0);
  const focusedDurationSeconds = mode === "locked" ? spanSeconds : preserveStoredDuration && session ? session.focusedDurationSeconds : normalizedDuration.totalSeconds;
  const relationshipValid = Boolean(academicYearId && subjectId && availableSubjects.some((subject) => subject.id === subjectId));
  const durationError = mode === "unlocked" && focusedDurationSeconds <= 0
    ? t("Duration must be greater than zero.")
    : mode === "unlocked" && focusedDurationSeconds > spanSeconds
      ? t("Duration cannot exceed the available Start and End span.")
      : "";

  useEffect(() => {
    if (mode === "locked" && validSpan) {
      setDuration(durationInputFields(spanSeconds));
      setPreserveStoredDuration(false);
    }
  }, [date, start, end, mode, spanSeconds, validSpan]);

  const normalizeDuration = () => setDuration(durationInputFields(normalizedDuration.totalSeconds));
  const requestModeToggle = () => {
    setSaveError("");
    if (mode === "locked") { setPreserveStoredDuration(false); setMode("unlocked"); return; }
    if (focusedDurationSeconds !== spanSeconds) setRelockPending(true);
    else setMode("locked");
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError("");
    if (!academicYearId) { setSaveError(t("Choose an Academic Year.")); return; }
    if (!relationshipValid) { setSaveError(t("Choose a Subject from the selected Academic Year.")); return; }
    if (!validSpan) { setSaveError(t("End time must be after start time.")); return; }
    if (durationError) return;
    try {
      if (session) await updateSessionDetails(session.id, { academicYearId, subjectId, startTime, endTime, focusedDurationSeconds, durationMode: mode, note });
      else {
        const subject = subjects.find((item) => item.id === subjectId)!;
        const academicYear = years.find((item) => item.id === academicYearId)!;
        await createSession({ subject, academicYear, startTime, endTime, focusedDurationSeconds, durationMode: mode, note });
      }
      onClose();
    } catch (error) {
      setSaveError(t(error instanceof Error ? error.message : "Invalid session"));
    }
  };

  return <>
    <form onSubmit={save} className="form session-editor">
      <label>
        {t("Academic Year")}
        <select value={academicYearId} onChange={(event) => { const next = event.target.value; setAcademicYearId(next); if (!subjects.some((subject) => subject.id === subjectId && subject.academicYearId === next)) setSubjectId(""); }} required autoFocus>
          <option value="">{t("Choose Academic Year")}</option>
          {years.filter(year => session || (!year.archived && year.id === currentYearId)).map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
        </select>
      </label>
      <label>
        {t("Subject")}
        <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={!academicYearId} required>
          <option value="">{t("Choose Subject")}</option>
          {availableSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </label>
      <label>
        {t("Date")}
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <div className="form-grid">
        <label>{t("Start")}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
        <label>{t("End")}<input className={!validSpan ? "input-error" : ""} type="time" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
      </div>
      {!validSpan && <p className="field-error">{t("End time must be after start time.")}</p>}
      <div className="duration-field">
        <span className="field-label">{t("Duration")}</span>
        <div className={`duration-editor-fields ${durationError ? "has-error" : ""} ${mode === "locked" ? "is-locked" : ""}`}>
          {(["hours", "minutes"] as const).map((part, index) => <div className="duration-part" key={part}>
            <input aria-label={t(part === "hours" ? "Hours" : "Minutes")} inputMode="numeric" pattern="[0-9]*" value={duration[part]} readOnly={mode === "locked"} onChange={(event) => { setPreserveStoredDuration(false); setDuration((current) => ({ ...current, [part]: event.target.value.replace(/\D/g, "") })); }} onBlur={normalizeDuration} />
            <small>{t(part === "hours" ? "HH" : "MM")}</small>
            {index === 0 && <b aria-hidden="true">:</b>}
          </div>)}
          <button type="button" className="duration-lock tooltip-button" aria-label={t(mode === "locked" ? "Unlock duration" : "Lock duration")} data-tooltip={t(mode === "locked" ? "Unlock duration" : "Lock duration")} onClick={requestModeToggle}>{mode === "locked" ? <Lock /> : <LockOpen />}</button>
        </div>
        {durationError && <p className="field-error">{durationError}</p>}
      </div>
      <label>{t("Note")}<input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("Add a note (optional)...")} /></label>
      {saveError && <p className="field-error">{saveError}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>{t("Cancel")}</button><button className="primary-action" disabled={!relationshipValid || !validSpan || Boolean(durationError)}>{t("Save")}</button></div>
    </form>
    {relockPending && <Modal title={t("Reconnect Duration to Start and End?")} onClose={() => setRelockPending(false)}>
      <p className="modal-copy">{t("Duration will change from {{current}} to {{next}}.", { current: formatClockDuration(focusedDurationSeconds), next: formatClockDuration(spanSeconds) })}</p>
      <div className="modal-actions"><button type="button" onClick={() => setRelockPending(false)}>{t("Cancel")}</button><button type="button" className="primary-action" onClick={() => { setDuration(durationInputFields(spanSeconds)); setPreserveStoredDuration(false); setMode("locked"); setRelockPending(false); }}>{t("Lock and update")}</button></div>
    </Modal>}
  </>;
}

export function HistoryPage() {
  const currentId = useLiveQuery(async () => (await db.settings.get(CURRENT_YEAR_KEY))?.value ?? "", []) ?? "";
  const { t } = useTranslation();
  const years = useLiveQuery(() => db.academicYears.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.orderBy("startTime").reverse().toArray(), []) ?? [];
  const [status, setStatusState] = useState(managementViewState.historyStatus);
  const setStatus = (value: string) => { managementViewState.historyStatus = value; setStatusState(value); };
  const [yearId, setYearId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<FocusSession | null | undefined>();
  const [deleting, setDeleting] = useState<FocusSession>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [moving, setMoving] = useState(false);
  const activeYears = years.filter((year) => !year.archived);
  const [moveYearId, setMoveYearId] = useState("");
  const [moveSubjectId, setMoveSubjectId] = useState("");
  const pageSize = 20;
  const filtered = useMemo(() => sessions.filter((session) => (status === "all" || isSessionEffectivelyArchived(session, subjects, years) === (status === "archived")) && (!yearId || session.academicYearId === yearId) && (!subjectId || session.subjectId === subjectId)), [sessions, status, yearId, subjectId, subjects, years]);
  return (
    <main className="page">
      <PageHeader
        title={t("History")}
        subtitle={t("Review and correct completed focus sessions.")}
        action={<div className="header-actions"><button className="secondary-action" onClick={() => { setSelecting((value) => !value); setSelected(new Set()); }}>{t(selecting ? "Cancel" : "Select")}</button><button className="primary-action" disabled={!subjects.length} onClick={() => setEditing(null)}><Plus /> {t("Add Session")}</button></div>}
      />
      <div className="filter-bar history-filters">
        <label>
          {t("Academic Year")}
          <select
            value={yearId}
            onChange={(e) => {
              setYearId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("All Academic Years")}</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Subject")}
          <select
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("All Subjects")}</option>
            {subjects
              .filter((s) => !yearId || s.academicYearId === yearId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("Status")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="active">{t("Active")}</option>
            <option value="archived">{t("Archived")}</option>
            <option value="all">{t("All")}</option>
          </select>
        </label>
      </div>
      {selecting && <div className="selection-toolbar"><strong>{t("{{count}} selected", { count: selected.size })}</strong><button onClick={() => setSelected(new Set(filtered.map((session) => session.id)))}>{t("Select all")}</button><button disabled={!selected.size} onClick={() => { const first = activeYears[0]; setMoveYearId(first?.id ?? ""); setMoveSubjectId(""); setMoving(true); }}>{t("Move")}</button><button className="danger-outline" disabled={!selected.size} onClick={() => setConfirmBulk(true)}><Trash2/> {t("Delete")}</button><button onClick={() => { setSelecting(false); setSelected(new Set()); }}>{t("Cancel")}</button></div>}
      <div className="history-table">
        <div className="history-head">
          <span>{t("Date")}</span>
          <span>{t("Time")}</span>
          <span>{t("Duration")}</span>
          <span>{t("Subject")}</span>
          <span>{t("Academic Year")}</span>
          <span>{t("Status")}</span>
          <span />
        </div>
        {filtered.slice(page * pageSize, (page + 1) * pageSize).map((s) => (
          <div className="history-row" key={s.id}>
            <span>
              {selecting && <input className="history-checkbox" type="checkbox" aria-label={t("Select Session {{id}}", { id: s.id })} checked={selected.has(s.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })}/>} {new Date(s.startTime).toLocaleDateString(localeCode(), {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span>
              {new Date(s.startTime).toLocaleTimeString(localeCode(), {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              -{" "}
              {new Date(s.endTime).toLocaleTimeString(localeCode(), {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <strong>{formatDuration(s.focusedDurationSeconds)}</strong>
            <span>{s.subjectName}</span>
            <span>{s.academicYearName}</span>
            <span className={`badge ${isSessionEffectivelyArchived(s, subjects, years) ? "badge--archived" : ""}`}>{t(isSessionEffectivelyArchived(s, subjects, years) ? "Archived" : "Active")}</span>
            <div className="row-actions">
              <button title={t("Edit")} onClick={() => setEditing(s)}>
                <Pencil />
              </button>
              <button className="danger-icon" title={t("Delete permanently")} onClick={() => setDeleting(s)}>
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h2>{t(status === "archived" ? "No archived sessions" : "Completed focus sessions will appear here")}</h2>
        </div>
      )}
      <div className="pagination">
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          {t("Previous")}
        </button>
        <span>
          {t("Page {{page}} of {{pages}}", { page: page + 1, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) })}
        </span>
        <button disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(page + 1)}>
          {t("Next")}
        </button>
      </div>
      {editing !== undefined && (
        <Modal title={t(editing ? "Edit Session" : "Add Session")} onClose={() => setEditing(undefined)}>
          <SessionEditor session={editing} years={years} subjects={subjects} currentYearId={currentId} onClose={() => setEditing(undefined)} />
        </Modal>
      )}
      {deleting && <DeleteConfirmation title={t("Delete Session?")} onCancel={() => setDeleting(undefined)} onDelete={async () => { await deleteSession(deleting.id); setDeleting(undefined); }}>{t("This permanently removes this Session.")}</DeleteConfirmation>}
      {confirmBulk && <DeleteConfirmation title={t("Delete {{count}} Sessions?", { count: selected.size })} deleteLabel={t("Delete {{count}} Sessions", { count: selected.size })} onCancel={() => setConfirmBulk(false)} onDelete={async () => { await deleteSessions([...selected]); setSelected(new Set()); setSelecting(false); setConfirmBulk(false); }}>{t("These Sessions will be permanently removed.")}</DeleteConfirmation>}
      {moving && <Modal title={t("Move {{count}} Sessions", { count: selected.size })} onClose={() => setMoving(false)}><div className="form">
        <label>{t("Academic Year")}<select value={moveYearId} onChange={(event) => { setMoveYearId(event.target.value); setMoveSubjectId(""); }}><option value="">{t("Choose Academic Year")}</option>{activeYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
        <label>{t("Subject")}<select value={moveSubjectId} disabled={!moveYearId} onChange={(event) => setMoveSubjectId(event.target.value)}><option value="">{t("Choose Subject")}</option>{subjects.filter((subject) => !subject.archived && subject.academicYearId === moveYearId).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <p>{t("Only the Subject and Academic Year assignment will change.")}</p>
        <div className="modal-actions"><button onClick={() => setMoving(false)}>{t("Cancel")}</button><button className="primary-action" disabled={!moveSubjectId} onClick={async () => { await moveSessions([...selected], moveSubjectId); setMoving(false); setSelected(new Set()); setSelecting(false); }}>{t("Move Sessions")}</button></div>
      </div></Modal>}
    </main>
  );
}
