import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import { academicYearTotals, activeDayCount, averageActiveDaySeconds, calendarDailySeries, calendarMonthlySeries, cleanHeatmapStep, cumulativeTotals, dailyTotals, filterSessions, heatmapLevel, heatmapScale, localDayKey, longestStreak, medianSessionSeconds, monthlyTotals, rollingAverage, sessionLengthBuckets, startOfLocalWeek, subjectTotals, weeklyTotals } from "./analytics";

const at=(y:number,m:number,d:number,h=12)=>new Date(y,m-1,d,h).getTime();
const session=(id:string,startTime:number,seconds:number,overrides:Partial<FocusSession>={}):FocusSession=>({id,subjectId:"math",subjectName:"Mathematics",academicYearId:"ib",academicYearName:"IB",startTime,endTime:startTime+seconds*1000,focusedDurationSeconds:seconds,archived:false,...overrides});

describe("analytics aggregation",()=>{
  const rows=[session("a",at(2026,9,20),3600),session("b",at(2026,9,20,15),1800),session("c",at(2026,9,21),7200),session("archived",at(2026,9,21),99_000,{archived:true})];
  it("groups local daily and monthly focused totals",()=>{expect(dailyTotals(filterSessions(rows)).map((p)=>p.seconds)).toEqual([5400,106200]);expect(monthlyTotals(filterSessions(rows))[0].seconds).toBe(111600);});
  it("ignores the legacy Session archive flag and filters by Academic Year and Subject",()=>{expect(filterSessions(rows)).toHaveLength(4);expect(filterSessions(rows,{academicYearId:"other"})).toHaveLength(0);expect(filterSessions(rows,{subjectId:"math"})).toHaveLength(4);});
  it("calculates active days, average active-day duration, and longest streak",()=>{const active=filterSessions(rows);expect(activeDayCount(active)).toBe(2);expect(averageActiveDaySeconds(active)).toBe(55800);expect(longestStreak(active)).toBe(2);});
  it("uses Monday as the start of each week",()=>{const sunday=at(2026,9,20),monday=at(2026,9,21);expect(localDayKey(startOfLocalWeek(sunday))).toBe("2026-09-14");expect(localDayKey(startOfLocalWeek(monday))).toBe("2026-09-21");expect(weeklyTotals(filterSessions(rows))).toHaveLength(2);});
  it("preserves distinct same-name Subjects",()=>{const subjects=[{id:"math",academicYearId:"ib",name:"Mathematics",color:"#1",archived:false},{id:"math-uni",academicYearId:"uni",name:"Mathematics",color:"#2",archived:false}];const data=subjectTotals([...rows,session("u",at(2026,9,20),1000,{subjectId:"math-uni",academicYearId:"uni",academicYearName:"University"})],subjects);expect(data).toHaveLength(2);});
  it("adds overlapping Academic Years into the same monthly total",()=>{const overlap=[session("ib",at(2028,5,3),3600),session("self",at(2028,5,4),1800,{subjectId:"piano",academicYearId:"self",academicYearName:"Independent Study"})];expect(monthlyTotals(overlap)[0].seconds).toBe(5400);});
  it("keeps zero-study months visible in calendar timelines",()=>{const sparse=[session("jan",at(2026,1,2),3600),session("mar",at(2026,3,2),1800)];expect(calendarMonthlySeries(sparse).map((point)=>point.seconds)).toEqual([3600,0,1800]);});
});

describe("trends and distributions",()=>{
  it("creates a cumulative total that never decreases",()=>{const values=cumulativeTotals([{key:"a",label:"a",start:1,seconds:20,sessionCount:1},{key:"b",label:"b",start:2,seconds:10,sessionCount:1}]);expect(values.map((v)=>v.cumulativeSeconds)).toEqual([20,30]);});
  it("includes zero-study calendar days in rolling averages",()=>{const points=calendarDailySeries([session("a",at(2026,1,1),700)],at(2026,1,1),at(2026,1,8));expect(points).toHaveLength(7);expect(rollingAverage(points,7).at(-1)?.averageSeconds).toBe(100);expect(rollingAverage(points,30).at(-1)?.averageSeconds).toBeCloseTo(23.333);});
  it("calculates median focused Session length",()=>{expect(medianSessionSeconds([session("a",1,10),session("b",2,20),session("c",3,30),session("d",4,40)])).toBe(25);});
  it("uses the specified Session-length buckets",()=>{const buckets=sessionLengthBuckets([0,1799,1800,3599,3600,5399,5400,7199,7200,10799,10800,99999].map((seconds,i)=>session(String(i),i,seconds)));expect(buckets.map((b)=>b.count)).toEqual([2,2,2,2,2,2]);expect(sessionLengthBuckets([]).map(b=>b.count)).toEqual([0,0,0,0,0,0]);});
});

describe("adaptive heatmap scale",()=>{
  it("snaps P90 4 hr 37 min to a 75-minute interval",()=>{expect(cleanHeatmapStep((4*60+37)*60)).toBe(75*60);});
  it("snaps a 22-minute raw step to the nearest 5 minutes",()=>{expect(cleanHeatmapStep(22*60*4)).toBe(20*60);});
  it("excludes zero-study days from P90",()=>{const rows=[session("a",at(2026,1,1),3600),session("b",at(2026,1,3),7200)];const scale=heatmapScale(rows);expect(scale.p90).toBeGreaterThan(3600);expect(scale.p90).toBeLessThanOrEqual(7200);});
  it("caps days above level four at maximum intensity",()=>{expect(heatmapLevel(99_999,900)).toBe(4);expect(heatmapLevel(0,900)).toBe(0);});
  it("includes legacy archived Sessions after effective status filtering",()=>{const rows=[session("a",at(2026,1,1),3600),session("b",at(2026,1,2),99_000,{archived:true})];const active=filterSessions(rows);expect(dailyTotals(active)).toHaveLength(2);expect(heatmapScale(active).p90).toBeGreaterThan(3600);});
});


describe("Academic Year comparison", () => {
  const years = ["ib","empty"].map(id => ({id,name:id,startDate:"2026-01-01",endDate:"2026-12-31",archived:false}));
  const rows = [session("a",at(2026,1,1),3600),session("b",at(2026,1,1,14),1800),session("c",at(2026,1,2),1800)];
  it("uses the same Sessions for totals, counts and active-day average", () => {
    expect(academicYearTotals(rows,years,[])).toMatchObject([{academicYearId:"ib",seconds:7200,sessions:3,averageSessionSeconds:2400,activeDays:2,averageActiveDaySeconds:3600}]);
  });
  it("applies range filtering to both metrics and omits empty years", () => {
    const filtered = filterSessions(rows,{start:at(2026,1,2,0),end:at(2026,1,3,0)});
    expect(academicYearTotals(filtered,years,[])).toMatchObject([{academicYearId:"ib",seconds:1800,sessions:1,averageSessionSeconds:1800,activeDays:1,averageActiveDaySeconds:1800}]);
    expect(academicYearTotals([],years,[])).toEqual([]);
  });
});

it("keeps year entity counts independent of session date range", () => {
  const years = [{ id: "ib", name: "IB", archived: false }];
  const subjects = ["math", "no-sessions"].map(id => ({ id, name: id, academicYearId: "ib", archived: false, color: "blue" }));
  const rows = [session("old", at(2025,1,1),3600),session("new",at(2026,1,1),1800)];
  expect(academicYearTotals(filterSessions(rows,{start:at(2026,1,1,0)}),years,subjects)).toMatchObject([{subjects:2,sessions:1,averageSessionSeconds:1800}]);
  expect(academicYearTotals(rows,years,subjects)).toMatchObject([{subjects:2,sessions:2,averageSessionSeconds:2700}]);
});
