import type { Subject } from "./types";
import type { FocusSettings } from "./settings";

export function defaultSessionSubject(subjects: Subject[], currentYearId: string, settings: Pick<FocusSettings, "subjectPickerMode" | "defaultSubjectId" | "lastSubjectId">) {
  const eligible = subjects.filter(subject => !subject.archived && subject.academicYearId === currentYearId);
  const preferred = settings.subjectPickerMode === "fixed" ? settings.defaultSubjectId : settings.lastSubjectId;
  return eligible.find(subject => subject.id === preferred)?.id ?? (settings.subjectPickerMode === "remember" ? eligible[0]?.id ?? "" : "");
}
