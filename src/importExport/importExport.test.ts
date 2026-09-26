import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { FocusDatabase } from "../db";
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEYS, type FocusSettings } from "../settings";
import type { FocusSession } from "../types";
import { analyzeBackup, createBackup, restoreBackup, validateBackup } from "./backup";
import { escapeCsv, exportSessionsCsv, importCsvPreview, parseCsv, previewCsv } from "./csv";

const opened:Dexie[]=[];
const database=()=>{const value=new FocusDatabase(`focus-v03-${crypto.randomUUID()}`);opened.push(value);return value;};
afterEach(async()=>{await Promise.all(opened.splice(0).map((value)=>value.delete()));});

async function seeded(){const value=database();await value.academicYears.add({id:"year",name:"IB",archived:false});await value.subjects.add({id:"subject",academicYearId:"year",name:"Japanese, Intermediate",color:"#ff922b",archived:false});await value.sessions.add({id:"session",academicYearId:"year",academicYearName:"IB",subjectId:"subject",subjectName:"Japanese, Intermediate",startTime:new Date(2026,8,21,23,45).getTime(),endTime:new Date(2026,8,22,0,30).getTime(),focusedDurationSeconds:2700,note:'Review "Section A", then Section B',archived:true});await value.settings.bulkPut([{key:"currentAcademicYearId",value:"year"},{key:"theme",value:"dark"}]);return value;}

describe("Focus JSON backups",()=>{
  it("serializes and restores all persistent data losslessly",async()=>{const source=await seeded();const backup=validateBackup(JSON.parse(JSON.stringify(await createBackup(source))));const target=database();await restoreBackup(backup,"replace","use-imported",target);expect(await target.academicYears.toArray()).toEqual(await source.academicYears.toArray());expect(await target.subjects.toArray()).toEqual(await source.subjects.toArray());expect(await target.sessions.toArray()).toEqual(await source.sessions.toArray());expect(await loadSettings(target)).toEqual(await loadSettings(source));expect((await target.settings.get("currentAcademicYearId"))?.value).toBe("year");});
  it("includes every canonical setting and restores representative values",async()=>{
    const source=await seeded();
    const expected:FocusSettings={...DEFAULT_SETTINGS,displayName:"Alex & Sam",sidebarSubtitle:"Keep going!",language:"ja",theme:"light",startMaximized:false,launchAtStartup:true,fixedTimerDurationSeconds:5430,dailyGoalEnabled:true,dailyGoalSeconds:7200,completionSoundChoice:"bright",completionSoundVolume:37,popoutSize:"large",popoutTransparency:73,popoutDocked:true,popoutDockCorner:"bottom-left",popoutAutoHideEdge:"left",popoutDockAutoHide:true,popoutAutoHideDelaySeconds:1.25,popoutAutoHideTabSize:"large",popoutAutoHideShowAccent:false,popoutAlwaysOnTop:false,accentColour:"miku",uiScale:"large",allowDirectActiveDeletion:true};
    await source.settings.bulkPut((Object.keys(SETTINGS_KEYS) as (keyof FocusSettings)[]).map((key)=>({key:SETTINGS_KEYS[key],value:String(expected[key])})));
    const backup=await createBackup(source);
    const backupKeys=new Set(backup.data.settings.map((setting)=>setting.key));
    expect(Object.values(SETTINGS_KEYS).every((key)=>backupKeys.has(key))).toBe(true);
    const target=database();
    await restoreBackup(backup,"replace","use-imported",target);
    expect(await loadSettings(target)).toEqual(expected);
    expect((await target.settings.get("currentAcademicYearId"))?.value).toBe("year");
  });
  it("rejects unsupported versions and corrupt references",async()=>{const backup=await createBackup(await seeded());expect(()=>validateBackup({...backup,formatVersion:99})).toThrow(/Unsupported/);expect(()=>validateBackup({...backup,data:{...backup.data,subjects:[{...backup.data.subjects[0],academicYearId:"missing"}]}})).toThrow(/missing Academic Year/);});
  it("detects merge duplicates and conflicts without silently overwriting",async()=>{const source=await seeded();const backup=await createBackup(source);const target=database();await restoreBackup(backup,"merge","keep-existing",target);const expectedDuplicates=backup.data.academicYears.length+backup.data.subjects.length+backup.data.sessions.length+backup.data.settings.length;expect((await analyzeBackup(backup,target)).duplicates).toBe(expectedDuplicates);await target.subjects.update("subject",{name:"Local name"});const analysis=await analyzeBackup(backup,target);expect(analysis.conflicts).toBe(1);await restoreBackup(backup,"merge","keep-existing",target);expect((await target.subjects.get("subject"))?.name).toBe("Local name");});
});

describe("Focus CSV",()=>{
  it("escapes commas, quotes, and newlines",()=>{expect(escapeCsv('Review "A",\nthen B')).toBe('"Review ""A"",\nthen B"');expect(parseCsv(`Name,Note\r\nSubject,${escapeCsv('Review "A",\nthen B')}`)).toMatchObject({records:[{Name:"Subject",Note:'Review "A",\nthen B'}]});});
  it("round-trips Focus CSV IDs, archived state, and midnight crossing",async()=>{const source=await seeded();const session=(await source.sessions.toArray())[0];const csv=exportSessionsCsv([session]);const target=database();const preview=await previewCsv(csv,undefined,undefined,target);expect(preview.recognizedFocusCsv).toBe(true);expect(preview.rows[0].session).toMatchObject({id:"session",archived:true,focusedDurationSeconds:2700});expect(new Date(preview.rows[0].session!.endTime).getDate()).not.toBe(new Date(preview.rows[0].session!.startTime).getDate());const result=await importCsvPreview(preview,target);expect(result).toMatchObject({academicYearsCreated:1,subjectsCreated:1,sessionsImported:1});});
  it("maps generic duration CSV and reports invalid rows",async()=>{const target=database();await target.academicYears.add({id:"year",name:"University Year 1",archived:false});const csv="Year,Course,Date,Time,Minutes\nUniversity Year 1,ELECTENG 101,2026-09-21,09:00,60\nUniversity Year 1,ELECTENG 101,bad,09:00,-5";const preview=await previewCsv(csv,{academicYear:"Year",subject:"Course",startDate:"Date",startTime:"Time",focusedMinutes:"Minutes"},undefined,target);expect(preview.subjectsToCreate).toEqual([{academicYearName:"University Year 1",subjectName:"ELECTENG 101"}]);expect(preview.rows.filter((row)=>row.errors.length)).toHaveLength(1);const result=await importCsvPreview(preview,target);expect(result).toMatchObject({sessionsImported:1,invalidRowsSkipped:1});});
  it("skips fingerprint duplicates when generic CSV has no ID",async()=>{const target=await seeded();const session=(await target.sessions.toArray())[0] as FocusSession;const start=new Date(session.startTime),end=new Date(session.endTime);const pad=(n:number)=>String(n).padStart(2,"0");const date=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time=(d:Date)=>`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;const csv=`Year,Subject,Start Date,Start Time,End Date,End Time\nIB,"Japanese, Intermediate",${date(start)},${time(start)},${date(end)},${time(end)}`;const preview=await previewCsv(csv,{academicYear:"Year",subject:"Subject",startDate:"Start Date",startTime:"Start Time",endDate:"End Date",endTime:"End Time"},undefined,target);expect(preview.rows[0].duplicate).toBe(true);});
});

it("uses the release version without changing schema or rejecting older backup producers", async () => {
  const source=await seeded();
  await source.settings.put({key:"dateFormat",value:"standard"});
  await source.settings.put({key:"language",value:"ja"});
  const backup=await createBackup(source);
  expect(backup.appVersion).toBe("2.2.0");
  expect(backup.formatVersion).toBe(1);
  for (const mode of ["replace","merge"] as const) {
    const target=database();
    await restoreBackup(validateBackup({...backup,appVersion:"1.2.0"}),mode,"use-imported",target);
    expect((await loadSettings(target)).dateFormat).toBe("standard");
    await target.settings.put({key:"language",value:"en"});
    expect((await loadSettings(target)).dateFormat).toBe("standard");
    await target.settings.put({key:"dateFormat",value:"compact"});
    expect((await loadSettings(target)).dateFormat).toBe("compact");
  }
});

it.each(["replace", "merge"] as const)("normalizes imported F-key shortcuts during %s without changing conflict policy", async mode => {
  const source=await seeded(), target=database();
  const backup=await createBackup(source);
  backup.appVersion="2.0.0";
  backup.data.settings=backup.data.settings.filter(row=>row.key!=="popoutRevealShortcut");
  backup.data.settings.push({key:"popoutRevealShortcut",value:"Ctrl+F8"});
  await restoreBackup(validateBackup(backup),mode,"use-imported",target);
  expect((await target.settings.get("popoutRevealShortcut"))?.value).toBe("Ctrl+Alt+KeyF");
  await target.settings.put({key:"popoutRevealShortcut",value:"Ctrl+KeyF"});
  await restoreBackup(backup,"merge","keep-existing",target);
  expect((await target.settings.get("popoutRevealShortcut"))?.value).toBe("Ctrl+KeyF");
});
