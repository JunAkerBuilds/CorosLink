import assert from "node:assert/strict";
import { test } from "node:test";
import { CalendarWorkoutEventStore, saveCalendarWorkoutEvent } from "../dist-electron/calendarWorkoutEventStore.js";

const ref = {userId:"u",planId:"p",idInPlan:"w",happenDay:"20260925"};
const workout = {...ref,planProgramId:"program",name:"Run"};
const timing = {mode:"timed",startTime:"07:30",endTime:"08:15",timeZone:"America/Toronto"};
function fixture() {
  const data = new Map();
  const storage = {read:key=>data.get(key),write:(key,value)=>data.set(key,value)};
  const store = new CalendarWorkoutEventStore(storage);
  const calls = [];
  const dependencies = {store,userId:()=>"u",listWorkouts:async()=>[workout],providers:["Google","Apple"].map(name=>({
    name,status:()=>({connected:true,calendar:{id:"c"},accountMatches:true,autoSync:false}),
    sync:async(userId,day)=>calls.push({name,userId,day,event:store.get(ref)}),
  }))};
  return {store,storage,calls,dependencies};
}

test("saving a single occurrence persists across restarts and immediately syncs both connected calendars", async () => {
  const f=fixture();
  const result=await saveCalendarWorkoutEvent({ref,timing},f.dependencies);
  assert.deepEqual(result.synced,["Google","Apple"]);
  assert.deepEqual(result.errors,[]);
  assert.equal(f.calls.length,2,"explicit saves sync even with background sync disabled");
  assert.deepEqual(new CalendarWorkoutEventStore(f.storage).get(ref),result.event);
  assert.deepEqual(f.store.apply("u",[workout,{...workout,idInPlan:"other"}]).map(w=>w.calendarEvent),[result.event,undefined]);
  assert.equal(f.store.get({...ref,userId:"other"}),undefined);
  assert.equal(f.store.apply("u",[{...workout,happenDay:"20260926"}])[0].calendarEvent.revision,result.event.revision);
  const again=await saveCalendarWorkoutEvent({ref,timing},f.dependencies);
  assert.notEqual(again.event.revision,result.event.revision,"saving again explicitly overrides subsequent external moves");
});

test("failed provider sync keeps the local edit and still updates the other provider", async () => {
  const f=fixture();
  f.dependencies.providers[0].sync=async()=>{throw Error("Offline");};
  const result=await saveCalendarWorkoutEvent({ref,timing},f.dependencies);
  assert.deepEqual(result.synced,["Apple"]);
  assert.deepEqual(result.errors,["Google: Offline"]);
  assert.deepEqual(f.store.get(ref).timing,timing);
  f.dependencies.providers[0].status=()=>({connected:false});
  const retry=await saveCalendarWorkoutEvent({ref,timing:{...timing,mode:"all-day"}},f.dependencies);
  assert.deepEqual(retry.synced,["Apple"]);
  assert.deepEqual(retry.errors,[]);
});

test("invalid, stale and cross-account edits never persist or sync", async () => {
  const f=fixture();
  await assert.rejects(saveCalendarWorkoutEvent({ref,timing:{...timing,endTime:"25:00"}},f.dependencies),/end time/);
  await assert.rejects(saveCalendarWorkoutEvent({ref:{...ref,userId:"other"},timing},f.dependencies),/account changed/);
  f.dependencies.listWorkouts=async()=>[];
  await assert.rejects(saveCalendarWorkoutEvent({ref,timing},f.dependencies),/moved or been removed/);
  f.dependencies.listWorkouts=async()=>{f.dependencies.userId=()=>"other";return [workout];};
  await assert.rejects(saveCalendarWorkoutEvent({ref,timing},f.dependencies),/account changed/);
  assert.equal(f.store.get(ref),undefined);
  assert.equal(f.calls.length,0);
});
