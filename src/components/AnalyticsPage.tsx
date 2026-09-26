import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { useTranslation } from "react-i18next";
import { db } from "../db";
import { formatDuration, formatDurationAxis } from "../data";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { createDevelopmentAnalyticsDataset } from "../analytics/developmentDataset";
import { academicYearTotals, filterSessions, localDayKey, medianSessionSeconds, sessionLengthBuckets, subjectTotals, weekdayTotals } from "../analytics/analytics";
import { addDays, analyticsPeriod, analyticsRanges, averageStudyPattern, calendarBuckets, calendarDays, defaultAggregation, goalAggregationModes, goalDefaultAggregation, percentageChange, personalBests, previousPeriod, rollingTimeline, summaryMetrics, type Aggregation, type AnalyticsRange, type Period } from "../analytics/periods";
import { goalProgress } from "../goals";
import { useSettings } from "../hooks/useSettings";
import { localeCode } from "../i18n";
import { ActivityHeatmap } from "./ActivityHeatmap";

const COLORS = ["#4da3ff", "#a879ff", "#4dd39a", "#ffad3b", "#ff7eb6", "#8da2b5"];
const tabs = ["Overview", "Study Patterns", "Subjects", "Academic Years", "Time Trends"] as const;
const dateLabel = (stamp: number) => new Date(stamp).toLocaleDateString(localeCode(), { day: "numeric", month: "short", year: "numeric" });
const periodLabel = (period: Period) => new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short", year: "numeric" }).formatRange(new Date(period.start), new Date(addDays(period.end, -1)));
const number = (value: number) => value.toLocaleString(localeCode(), { maximumFractionDigits: 1 });
const percent = (value: number) => (value / 100).toLocaleString(localeCode(), { style: "percent", maximumFractionDigits: 1 });
const exactDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const parts = [[Math.floor(total / 3600), "hour"], [Math.floor(total % 3600 / 60), "minute"], [total % 60, "second"]] as const;
  return parts.filter(([value, unit]) => value > 0 || (unit === "second" && total === 0)).map(([value, unit]) => new Intl.NumberFormat(localeCode(), { style: "unit", unit, unitDisplay: "short" }).format(value)).join(" ");
};
const inputDay = (value: string) => new Date(`${value}T00:00:00`).getTime();
type DataProps = { sessions: FocusSession[]; subjects: Subject[]; years: AcademicYear[] };
type TimelineProps = { sessions: FocusSession[]; history: FocusSession[]; period: Period; range: AnalyticsRange };

export function AnalyticsPage() {
  const { t } = useTranslation();
  const storedYears = useLiveQuery(() => db.academicYears.toArray(), []);
  const storedSubjects = useLiveQuery(() => db.subjects.toArray(), []);
  const storedSessions = useLiveQuery(() => db.sessions.orderBy("startTime").toArray(), []);
  const demoEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("analyticsDemo") === "1";
  const demo = useMemo(() => demoEnabled ? createDevelopmentAnalyticsDataset(20_000) : undefined, [demoEnabled]);
  const years = demo?.academicYears ?? storedYears, subjects = demo?.subjects ?? storedSubjects, sessions = demo?.sessions ?? storedSessions;
  const [tab, setTab] = useState<typeof tabs[number]>("Overview");
  const [yearId, setYearId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [range, setRange] = useState<AnalyticsRange>("All");
  const [customOpen, setCustomOpen] = useState(false);
  const [customRange, setCustomRange] = useState<Period>();
  const [customDraft, setCustomDraft] = useState(() => ({ start: localDayKey(Date.now()), end: localDayKey(Date.now()) }));
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id); }, []);
  const customValid = Number.isFinite(inputDay(customDraft.start)) && Number.isFinite(inputDay(customDraft.end)) && customDraft.end >= customDraft.start;
  const effectiveSessions = useMemo(() => {
    const activeYears = new Set(years?.filter(y => !y.archived).map(y => y.id));
    const activeSubjects = new Set(subjects?.filter(s => !s.archived).map(s => s.id));
    // Legacy Session archive flags are intentionally ignored; entity status is authoritative.
    return filterSessions((sessions ?? []).filter(s => activeYears.has(s.academicYearId) && activeSubjects.has(s.subjectId)));
  }, [sessions, subjects, years]);
  useEffect(() => {
    if (subjectId && subjects && !subjects.some(s => !s.archived && s.id === subjectId && (!yearId || s.academicYearId === yearId))) setSubjectId("");
  }, [subjectId, subjects, yearId]);
  // Comparison tabs override the effective scope without destroying saved filter selections.
  const yearDisabled = tab === "Academic Years", subjectDisabled = yearDisabled || tab === "Subjects";
  const history = useMemo(() => filterSessions(effectiveSessions, { academicYearId: yearDisabled ? undefined : yearId || undefined, subjectId: subjectDisabled ? undefined : subjectId || undefined }), [effectiveSessions, yearDisabled, subjectDisabled, yearId, subjectId]);
  const period = analyticsPeriod(range, history, now, customRange);
  const filtered = useMemo(() => filterSessions(history, period), [history, period.start, period.end]);
  if (!years || !subjects || !sessions) return <main className="page analytics-page"><div className="analytics-loading">{t("Loading analytics...")}</div></main>;
  const timeline = { sessions: filtered, history, period, range };
  return <main className="page analytics-page">
    {demoEnabled && <div className="analytics-demo-banner">Development dataset · {number(sessions.length)} generated Sessions · in memory only</div>}
    <header className="analytics-header"><div><h1>{t("Analytics")}</h1><p>{t("Explore your study habits across subjects, Academic Years, and self-study.")}</p></div>
      <div className="analytics-filters">
        <select aria-label={t("Academic Year")} disabled={yearDisabled} value={yearDisabled ? "" : yearId} onChange={e => setYearId(e.target.value)}><option value="">{t("All Years")}</option>{years.filter(y => !y.archived).map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select>
        <select aria-label={t("Subject")} disabled={subjectDisabled} value={subjectDisabled ? "" : subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">{t("All Subjects")}</option>{subjects.filter(s => !s.archived && (!yearId || s.academicYearId === yearId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="custom-range-wrap"><div className="range-control" aria-label={t("Date range")}>
          {analyticsRanges.map(r => <button key={r} aria-pressed={(customOpen ? "Custom" : range) === r} className={(customOpen ? "Custom" : range) === r ? "active" : ""} onClick={() => {
            if (r === "Custom") { if (customRange) setCustomDraft({ start: localDayKey(customRange.start), end: localDayKey(addDays(customRange.end, -1)) }); setCustomOpen(true); }
            else { setCustomOpen(false); setRange(r); }
          }}>{t(r)}</button>)}
        </div>
        {range === "Custom" && <span className="custom-range-label">{periodLabel(period)}</span>}
        {customOpen && <div className="custom-range-popover" role="dialog" aria-label={t("Custom")} onKeyDown={e => { if (e.key === "Escape") setCustomOpen(false); }}>
          <label>{t("Start date")}<input type="date" value={customDraft.start} max={customDraft.end || undefined} onChange={e => setCustomDraft({ ...customDraft, start: e.target.value })}/></label>
          <label>{t("End date")}<input type="date" value={customDraft.end} min={customDraft.start || undefined} onChange={e => setCustomDraft({ ...customDraft, end: e.target.value })}/></label>
          {!customValid && <span className="field-error">{t("End date cannot be before Start date.")}</span>}
          <div className="custom-range-actions"><button className="secondary-action" onClick={() => setCustomOpen(false)}>{t("Cancel")}</button><button className="primary-action" disabled={!customValid} onClick={() => { setCustomRange({ start: inputDay(customDraft.start), end: addDays(inputDay(customDraft.end), 1) }); setRange("Custom"); setCustomOpen(false); }}>{t("Apply")}</button></div>
        </div>}
        </div>
      </div>
    </header>
    <nav className="analytics-tabs" aria-label={t("Analytics views")}>{tabs.map(item => <button key={item} aria-pressed={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{t(item)}</button>)}</nav>
    {tab === "Overview" ? <Overview {...timeline} allSessions={effectiveSessions}/> : tab === "Study Patterns" ? <StudyPatterns {...timeline}/> : tab === "Subjects" ? <SubjectsAnalytics sessions={filtered} subjects={subjects} years={years}/> : tab === "Academic Years" ? <YearsAnalytics sessions={filtered} years={years} subjects={subjects}/> : <TimeTrends key={`${range}-${period.start}-${period.end}`} {...timeline}/>}
  </main>;
}

function GoalSummary({ label, current, target, kind }: { label: string; current: number; target: number; kind: string }) {
  const { t } = useTranslation();
  return <section className={`goal-${kind}`}><div><strong>{label}</strong><span>{target > 0 && current >= target ? t("Goal reached") : t("{{duration}} left", { duration: formatDuration(Math.max(0, target - current)) })}</span></div><progress max={Math.max(1, target)} value={Math.min(current, target)}/><small>{formatDuration(current)} / {formatDuration(target)}</small></section>;
}

function Overview({ sessions, history, period, range, allSessions }: TimelineProps & { allSessions: FocusSession[] }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const goals = goalProgress(allSessions), current = summaryMetrics(sessions), previous = previousPeriod(period);
  const previousValues = summaryMetrics(filterSessions(history, previous));
  const records = personalBests(sessions, period);
  const consecutive = range === "7D" || (range === "Custom" && calendarDays(period) < 14);
  const fourth = consecutive ? records.consecutive : records.bestWeek;
  const labels = ["Total focus time", "Total Sessions", "Average Session", "Average active day", "Active study days"];
  const recordRows = [
    { label: "Best day", value: records.bestDay ? formatDuration(records.bestDay.seconds) : "—", date: records.bestDay && dateLabel(records.bestDay.start) },
    { label: "Longest Session", value: records.longestSession ? formatDuration(records.longestSession.focusedDurationSeconds) : "—", date: records.longestSession && dateLabel(records.longestSession.startTime) },
    { label: "Longest streak", value: records.longest ? t("{{count}} days", { count: records.longest.days }) : "—", date: records.longest && periodLabel(records.longest) },
    { label: consecutive ? "Best consecutive days" : "Best week", value: fourth ? formatDuration(fourth.seconds) : "—", date: fourth && periodLabel(fourth) },
  ];
  return <div className="analytics-content overview-content">
    <div className="metric-strip metric-strip--five">{labels.map((label, index) => <Metric key={label} label={t(label)} value={index === 1 || index === 4 ? number(current[index]) : formatDuration(current[index])} comparison={range === "All" ? undefined : { value: percentageChange(current[index], previousValues[index]) }}/>) }<ComparisonFooter period={period} range={range}/></div>
    {(settings.dailyGoalEnabled || settings.weeklyGoalEnabled) && <div className="analytics-goals">{settings.dailyGoalEnabled && <GoalSummary kind="daily" label={t("Daily goal")} current={goals.dailySeconds} target={settings.dailyGoalSeconds}/>} {settings.weeklyGoalEnabled && <GoalSummary kind="weekly" label={t("Weekly goal")} current={goals.weeklySeconds} target={settings.weeklyGoalSeconds}/>}</div>}
    <Panel title={t("Personal bests")}><div className="analytics-best-list">{recordRows.map(row => <span key={row.label}>{t(row.label)}<strong>{row.value}</strong><small>{row.date || "—"}</small></span>)}</div></Panel>
    <Panel title={t("Focus time over time")}><RollingChart history={history} period={period} bars/></Panel>
    <Panel title={t("Daily activity")}><ActivityHeatmap sessions={allSessions}/></Panel>
  </div>;
}

function SubjectsAnalytics({ sessions, subjects, years }: DataProps) {
  const { t } = useTranslation();
  const rows = subjectTotals(sessions, subjects), total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const names = new Map(rows.map(row => [row.subjectId, `${row.name} · ${years.find(y => y.id === row.academicYearId)?.name ?? ""}`]));
  const monthMap = new Map<string, Map<string, number>>();
  for (const s of sessions) { const month = localDayKey(s.startTime).slice(0, 7), values = monthMap.get(month) ?? new Map<string, number>(); values.set(s.subjectId, (values.get(s.subjectId) ?? 0) + s.focusedDurationSeconds); monthMap.set(month, values); }
  const share = [...monthMap].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => {
    const sum = [...values.values()].reduce((a, b) => a + b, 0);
    return { label: new Date(`${month}-01T12:00:00`).toLocaleDateString(localeCode(), { month: "short", year: "numeric" }), shares: Object.fromEntries(rows.map(row => [row.subjectId, (values.get(row.subjectId) ?? 0) / sum * 100])) };
  });
  return <div className="analytics-content subjects-layout">
    <Panel title={t("Subjects")}><div className="analytics-table"><div className="analytics-table-head">{["Subject", "Academic Year", "Focus time", "Sessions", "Average Session", "Active days"].map(label => <span key={label}>{t(label)}</span>)}</div>{rows.map(row => <div className="analytics-table-row" key={row.subjectId}><span title={row.name}><i style={{ background: row.color }}/>{row.name}</span><span>{years.find(y => y.id === row.academicYearId)?.name}</span><strong>{formatDuration(row.seconds)}</strong><span>{number(row.sessions)}</span><span>{formatDuration(row.averageSessionSeconds)}</span><span>{number(row.activeDayCount)}</span></div>)}</div>{!rows.length && <Empty/>}</Panel>
    <Panel title={t("Focus time by Subject")}><div className="donut-wrap"><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={rows.map(row => ({ name: names.get(row.subjectId), value: row.seconds, fill: row.color }))} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" stroke="none"/><Tooltip content={props => <ChartTooltip {...props} kind="pie" total={total}/>}/></PieChart></ResponsiveContainer><div className="chart-legend">{rows.map(row => <span key={row.subjectId}><i style={{ background: row.color }}/><em title={names.get(row.subjectId)}>{row.name}</em><strong>{percent(row.seconds / total * 100)}</strong></span>)}</div></div></Panel>
    <Panel className="full-row" title={t("Subject share over time")}><ScrollChart width={share.length * 58}><AreaChart data={share}><CartesianGrid stroke="var(--chart-grid)" vertical={false}/><XAxis dataKey="label"/><YAxis domain={[0, 100]} tickFormatter={percent}/>{rows.map(row => <Area key={row.subjectId} dataKey={point => point.shares[row.subjectId]} name={names.get(row.subjectId)} stackId="subjects" stroke={row.color} fill={row.color} fillOpacity={0.75}/>)}<Tooltip content={props => <ChartTooltip {...props} kind="percent"/>}/></AreaChart></ScrollChart></Panel>
  </div>;
}

function YearsAnalytics({ sessions, years, subjects }: DataProps) {
  const { t } = useTranslation();
  const rows = academicYearTotals(sessions, years, subjects);
  const averageMaximum = Math.max(1, ...rows.map(row => row.averageActiveDaySeconds));
  return <div className="analytics-content years-layout">
    <Panel title={t("Focus time by Academic Year")}><div className="analytics-list-scroll">{rows.map((row, index) => <div className="breakdown-row year-comparison-row" key={row.academicYearId} title={`${row.name}: ${formatDuration(row.seconds)}, ${t("{{count}} Sessions", { count: row.sessions })}`} tabIndex={0}><span>{row.name}</span><strong>{formatDuration(row.seconds)}</strong><small>{t("{{count}} Sessions", { count: row.sessions })}</small><i style={{ width: `${row.seconds / Math.max(1, rows[0].seconds) * 100}%`, background: COLORS[index % COLORS.length] }}/></div>)}</div>{!rows.length && <Empty/>}</Panel>
    <Panel title={t("Average focus per active day")}><div className="analytics-list-scroll">{rows.map((row, index) => <div className="breakdown-row" key={row.academicYearId} title={`${row.name}: ${formatDuration(row.averageActiveDaySeconds)}`} tabIndex={0}><span>{row.name}</span><strong>{formatDuration(row.averageActiveDaySeconds)}</strong><i style={{ width: `${row.averageActiveDaySeconds / averageMaximum * 100}%`, background: COLORS[index % COLORS.length] }}/></div>)}</div>{!rows.length && <Empty/>}</Panel>
    <Panel title={t("Academic Year summary")}><div className="analytics-table year-summary-table" role="table">
      <div className="analytics-table-head" role="row">{["Academic Year", "Sessions", "Subjects", "Active days", "Average Session"].map(label => <span role="columnheader" key={label}>{t(label)}</span>)}</div>
      {rows.map(row => <div className="analytics-table-row" role="row" key={row.academicYearId}><span role="cell">{row.name}</span><span role="cell">{number(row.sessions)}</span><span role="cell">{number(row.subjects)}</span><span role="cell">{number(row.activeDays)}</span><span role="cell">{formatDuration(row.averageSessionSeconds)}</span></div>)}
    </div>{!rows.length && <Empty/>}</Panel>
  </div>;
}

function TimeTrends({ sessions, history, period, range }: TimelineProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const aggregation = defaultAggregation(range, period);
  // This keyed, conditionally mounted page resets chart state without resetting global filters.
  const [goalAggregation, setGoalAggregation] = useState<Aggregation>(() => goalDefaultAggregation(range, calendarDays(period)));
  const allowedModes = goalAggregationModes(range, calendarDays(period));
  const validGoal = settings.dailyGoalEnabled && Number.isFinite(settings.dailyGoalSeconds) && settings.dailyGoalSeconds > 0;
  const goals = calendarBuckets(sessions, period, goalAggregation, validGoal ? settings.dailyGoalSeconds : 0).map(point => ({ ...point, label: periodLabel(point) }));
  let cumulativeSeconds = 0;
  const points = calendarBuckets(sessions, period, aggregation).map(point => ({ ...point, label: periodLabel(point), cumulativeSeconds: cumulativeSeconds += point.seconds }));
  return <div className="analytics-content trend-grid">
    <Panel title={t("Goal achievement over time")} subtitle={t("Historical focus time compared with your current Daily Goal.")}>
      <div className="trend-controls"><select aria-label={t("Aggregation")} value={goalAggregation} disabled={allowedModes.length === 1} onChange={e => setGoalAggregation(e.target.value as Aggregation)}>{allowedModes.map(mode => <option key={mode} value={mode}>{t(mode === "daily" ? "Daily" : mode === "weekly" ? "Weekly" : "Monthly")}</option>)}</select></div>
      {validGoal ? <ScrollChart width={goals.length * 28}><BarChart data={goals}><CartesianGrid stroke="var(--chart-grid)" vertical={false}/><XAxis dataKey="label"/><YAxis tickFormatter={percent}/><ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4"/><Bar dataKey="goalPercent" name={t("Goal achievement")} fill="#4da778"/><Tooltip content={props => <GoalTooltip {...props} daily={goalAggregation === "daily"} target={settings.dailyGoalSeconds}/>}/></BarChart></ScrollChart> : <p className="muted">{t("Set a Daily Goal to view goal achievement.")}</p>}
    </Panel>
    <Panel title={t("Cumulative Focus Time")}><ScrollChart width={points.length * 28}><LineChart data={points}><ChartAxes/><Line dataKey="cumulativeSeconds" name={t("Cumulative Focus Time")} stroke="var(--accent)" dot={false}/><Tooltip content={props => <ChartTooltip {...props}/>}/></LineChart></ScrollChart></Panel>
    <Panel title={t("Sessions over time")}><ScrollChart width={points.length * 28}><BarChart data={points}><CartesianGrid stroke="var(--chart-grid)" vertical={false}/><XAxis dataKey="label"/><YAxis allowDecimals={false}/><Bar dataKey="sessionCount" name={t("Sessions")} fill="#4da3ff"/><Tooltip content={props => <ChartTooltip {...props} kind="count"/>}/></BarChart></ScrollChart></Panel>
    <Panel title={t("Average session length")}><ScrollChart width={points.length * 28}><LineChart data={points.map(point => ({ ...point, averageSeconds: point.sessionCount ? point.averageSeconds : null }))}><ChartAxes/><Line dataKey="averageSeconds" name={t("Average Session")} stroke="#a879ff" dot={points.length < 40}/><Tooltip content={props => <ChartTooltip {...props}/>}/></LineChart></ScrollChart></Panel>
    <Panel title={t("Rolling calendar-day averages")}><RollingChart history={history} period={period}/></Panel>
  </div>;
}

function RollingChart({ history, period, bars = false }: { history: FocusSession[]; period: Period; bars?: boolean }) {
  const { t } = useTranslation();
  const data = useMemo(() => rollingTimeline(history, period), [history, period.start, period.end]).map(point => ({ ...point, label: dateLabel(point.start) }));
  return <ScrollChart width={data.length <= 365 ? 0 : data.length * 2}><ComposedChart data={data} barCategoryGap={0} barGap={0}><ChartAxes/>{bars && <Bar dataKey="seconds" name={t("Daily total")} fill="var(--accent)" opacity={0.7}/>}{[7, 30, 90, 365].map((days, index) => <Line key={days} dataKey={`avg${days}`} name={t(["7-day average", "30-day average", "3-month average", "1-year average"][index])} stroke={COLORS[index]} dot={false} strokeWidth={2}/>)}<Legend/><Tooltip content={props => <ChartTooltip {...props}/>}/></ComposedChart></ScrollChart>;
}

function StudyPatterns({ sessions, history, period, range }: TimelineProps) {
  const { t } = useTranslation();
  const values = summaryMetrics(sessions), matrix = averageStudyPattern(sessions, period), max = Math.max(1, ...matrix.flat());
  const previousSessions = filterSessions(history, previousPeriod(period));
  const currentMetrics = [sessions.length, values[2], medianSessionSeconds(sessions)];
  const previousMetrics = [previousSessions.length, summaryMetrics(previousSessions)[2], medianSessionSeconds(previousSessions)];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const times = Array.from({ length: 8 }, (_, index) => `${new Date(2000, 0, 1, index * 3).toLocaleTimeString(localeCode(), { hour: "2-digit", minute: "2-digit", hour12: false })}–${index === 7 ? "24:00" : new Date(2000, 0, 1, (index + 1) * 3).toLocaleTimeString(localeCode(), { hour: "2-digit", minute: "2-digit", hour12: false })}`);
  const [hover, setHover] = useState<{ day: number; bucket: number }>();
  return <div className="analytics-content study-patterns-content"><div className="metric-strip metric-strip--three">{["Total Sessions", "Average Session", "Median Session"].map((label, index) => <Metric key={label} label={t(label)} value={index === 0 ? number(currentMetrics[index]) : formatDuration(currentMetrics[index])} comparison={range === "All" ? undefined : { value: percentageChange(currentMetrics[index], previousMetrics[index]) }}/>) }<ComparisonFooter period={period} range={range}/></div>
    <div className="patterns-grid">
      <Panel title={t("Focus time by weekday")}><ResponsiveContainer width="100%" height={260}><BarChart data={weekdayTotals(sessions).map(row => ({ ...row, label: t(row.label) }))}><ChartAxes/><Bar dataKey="seconds" name={t("Focus time")} fill="#4da3ff"/><Tooltip content={props => <ChartTooltip {...props}/>}/></BarChart></ResponsiveContainer></Panel>
      <Panel title={t("Session length distribution")}><ResponsiveContainer width="100%" height={260}><BarChart data={sessionLengthBuckets(sessions).map(row => ({ ...row, label: t(row.label) }))}><CartesianGrid stroke="var(--chart-grid)" vertical={false}/><XAxis dataKey="label" fontSize={11}/><YAxis allowDecimals={false}/><Bar dataKey="count" name={t("Sessions")} fill="#a879ff"/><Tooltip content={props => <ChartTooltip {...props} kind="count"/>}/></BarChart></ResponsiveContainer></Panel>
      <Panel className="full-row" title={t("Study time by weekday and time")}><div className="time-heatmap"><div className="time-heatmap-head"><span/>{times.map(time => <span key={time}>{time}</span>)}</div>{matrix.map((row, day) => <div className="time-heatmap-row" key={day}><b>{t(days[day])}</b>{row.map((seconds, bucket) => <button key={bucket} aria-label={`${t(days[day])} ${times[bucket]}: ${formatDuration(seconds)}`} title={`${t(days[day])} ${times[bucket]}: ${formatDuration(seconds)}`} onMouseEnter={() => setHover({ day, bucket })} onMouseLeave={() => setHover(undefined)} onFocus={() => setHover({ day, bucket })} onBlur={() => setHover(undefined)} style={{ background: `color-mix(in srgb, #4da3ff ${seconds ? Math.max(15, seconds / max * 100) : 0}%, var(--surface-raised))` }}/>)}</div>)}</div><div className="pattern-tooltip" role="status">{hover ? `${t(days[hover.day])} · ${times[hover.bucket]} · ${formatDuration(matrix[hover.day][hover.bucket])}` : "\u00a0"}</div><div className="heatmap-legend"><span>{formatDuration(0)}</span>{[0.25, 0.5, 0.75, 1].map(level => <span key={level}><i style={{ background: `color-mix(in srgb, #4da3ff ${level * 100}%, var(--surface-raised))` }}/>{formatDuration(max * level)}</span>)}</div></Panel>
    </div>
  </div>;
}

function Metric({ label, value, comparison }: { label: string; value: string; comparison?: { value?: number } }) {
  const { t } = useTranslation();
  const change = comparison?.value;
  const wording = change === undefined ? t("No previous period") : change === 0 ? t("Unchanged from previous period") : t(change > 0 ? "{{percent}} higher than previous period" : "{{percent}} lower than previous period", { percent: percent(Math.abs(change)) });
  return <article className="analytics-metric"><span>{label}<div className="metric-value"><strong title={value}>{value}</strong><small className={`metric-change ${change && change > 0 ? "higher" : change && change < 0 ? "lower" : ""}`} title={comparison ? wording : undefined} aria-label={comparison ? wording : undefined}>{comparison ? change === undefined ? "—" : `${change > 0 ? "+" : ""}${percent(change)}` : "\u2014"}</small></div></span></article>;
}
function ComparisonFooter({ period, range }: { period: Period; range: AnalyticsRange }) {
  const { t } = useTranslation();
  return <footer className="comparison-footer"><span><b>{t("Current:")}</b> {periodLabel(period)}</span>{range !== "All" && <><span aria-hidden="true">·</span><span><b>{t("Previous:")}</b> {periodLabel(previousPeriod(period))}</span></>}</footer>;
}
function Empty() { const { t } = useTranslation(); return <p className="muted">{t("No Sessions in this range")}</p>; }
function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`analytics-panel ${className}`}><header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>{children}</section>;
}
function ChartAxes() { return <><CartesianGrid stroke="var(--chart-grid)" vertical={false}/><XAxis dataKey="label" fontSize={11}/><YAxis tickFormatter={formatDurationAxis} fontSize={11}/></>; }
function ScrollChart({ width, children }: { width: number; children: React.ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth; }, [width]);
  return <div className="chart-scroll" ref={ref} tabIndex={0} onWheel={event => { if (event.shiftKey && event.deltaY && !event.deltaX) { event.currentTarget.scrollLeft += event.deltaY; } }}><div style={{ minWidth: Math.max(400, width), width: "100%", height: 290 }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></div>;
}
type ChartTooltipProps = Partial<Pick<TooltipContentProps<number, string>, "active" | "payload" | "label">>;
function ChartTooltip({ active, payload, label, kind = "duration", total = 0 }: ChartTooltipProps & { kind?: "duration" | "count" | "percent" | "pie"; total?: number }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label ?? payload[0].name}</strong>{payload.map((item, index) => <span key={`${item.dataKey}-${index}`}><i style={{ background: item.color ?? item.payload?.fill }}/><em>{item.name}</em><b>{kind === "count" ? number(Number(item.value)) : kind === "percent" ? percent(Number(item.value)) : exactDuration(Number(item.value))}{kind === "pie" && total > 0 ? ` · ${percent(Number(item.value) / total * 100)}` : ""}</b></span>)}</div>;
}
function GoalTooltip({ active, payload, daily, target }: ChartTooltipProps & { daily: boolean; target: number }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return <div className="chart-tooltip"><strong>{point.label}</strong><p>{percent(point.goalPercent)}</p>{daily ? <><p>{t("Focus time")}: {exactDuration(point.seconds)}</p><p>{t("Current Daily Goal")}: {exactDuration(target)}</p></> : <><p>{t("Goal met: {{met}} of {{days}} days", { met: number(point.goalMetDays), days: number(point.days) })}</p><p>{t("Average daily focus time")}: {formatDuration(point.seconds / point.days)}</p></>}</div>;
}
