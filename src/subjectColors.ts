import type { Subject } from "./types";

export const SUBJECT_COLORS = ["#4da3ff", "#ff4d57", "#ffad3b", "#4dd39a", "#a879ff", "#ff7eb6"];

export function nextSubjectColor(subjects: Subject[], academicYearId: string): string {
  const counts = SUBJECT_COLORS.map(color => subjects.filter(subject => !subject.archived && subject.academicYearId === academicYearId && subject.color.toLowerCase() === color).length);
  return SUBJECT_COLORS[counts.indexOf(Math.min(...counts))];
}
