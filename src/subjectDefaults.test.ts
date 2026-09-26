import { expect, it } from "vitest";
import { defaultSessionSubject } from "./subjectDefaults";
import { nextSubjectColor, SUBJECT_COLORS } from "./subjectColors";
const subjects = ["one", "two", "three"].map((id, index) => ({ id, name: id, academicYearId: "year", archived: false, color: SUBJECT_COLORS[index] }));
it("applies fixed precedence and limits new-session choices to active current-year Subjects", () => {
  expect(defaultSessionSubject(subjects, "year", { subjectPickerMode: "fixed", defaultSubjectId: "two", lastSubjectId: "one" })).toBe("two");
  expect(defaultSessionSubject(subjects, "year", { subjectPickerMode: "remember", defaultSubjectId: "two", lastSubjectId: "one" })).toBe("one");
  expect(defaultSessionSubject(subjects, "other", { subjectPickerMode: "remember", defaultSubjectId: "two", lastSubjectId: "one" })).toBe("");
});
it("chooses the least-used palette color within the destination year, ignoring archives", () => {
  expect(nextSubjectColor([], "year")).toBe(SUBJECT_COLORS[0]);
  expect(nextSubjectColor(subjects, "year")).toBe(SUBJECT_COLORS[3]);
  expect(nextSubjectColor([{ ...subjects[0], archived: true }, subjects[1], { ...subjects[2], academicYearId: "other" }], "year")).toBe(SUBJECT_COLORS[0]);
  expect(nextSubjectColor(SUBJECT_COLORS.map((color, i) => ({ ...subjects[0], id: String(i), color })), "year")).toBe(SUBJECT_COLORS[0]);
});
