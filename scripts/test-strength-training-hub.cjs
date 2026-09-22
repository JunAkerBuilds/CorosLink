const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {app}=require('electron');
async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'coroslink-strength-hub-'));app.setPath('userData',root);await app.whenReady();
 const database=require('../dist-electron/database.js');const db=database.initializeDatabase(root);
 const hub=require('../dist-electron/trainingHubService.js');const {patchStrengthProgram}=require('../dist-electron/strengthWorkoutPatch.js');const {program}=await import('./fixtures/strength-workout.mjs');
 for(const [key,value] of Object.entries({accessToken:'fixture-token',userId:'fixture-user',regionId:'1',baseUrl:'https://fixture.invalid'}))database.setSetting(`trainingHub.${key}`,value);
 let library=program('1');let scheduled={...program('2'),idInPlan:'42'};const entity={happenDay:'20990101',idInPlan:'42',planId:'425868133463670784',planProgramId:'2',status:2};let plans=[];let failure;const writes=[];
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{
  const pathname=new URL(String(url)).pathname;
  assert.equal(new URL(String(url)).hostname,'fixture.invalid','no real network destination');
  assert.equal(options.headers.accesstoken,'fixture-token');
  let data;
  if(pathname==='/training/program/detail')data=library;
  else if(pathname==='/training/schedule/query')data={entities:[entity],programs:[scheduled]};
  else if(pathname==='/training/plan/query')data=plans;
  else if(pathname==='/training/program/calculate')data={planSets:6,planDuration:180};
  else if(pathname.endsWith('/update')){
   writes.push({pathname,body:JSON.parse(options.body)});assert.ok(options.signal,'mutation has a bounded timeout');
   if(failure==='token')return new Response(JSON.stringify({result:'0101',message:'expired'}));
   if(pathname==='/training/program/update')library=JSON.parse(options.body);else scheduled=JSON.parse(options.body).programs[0];
   if(failure==='timeout')throw new Error('connection lost after acceptance');
   return new Response(JSON.stringify({result:'0000'}));
  } else throw new Error(`Unexpected request: ${pathname}`);
  return new Response(JSON.stringify({result:'0000',data}));
 };
 try{
  const ref={kind:'library',programId:'1'};const source=await hub.resolveStrengthWorkoutEditSource(ref);const next=patchStrengthProgram(source.program,[{stepId:'step-10',sets:4}]).program;
  const calculated=await hub.calculateExistingWorkoutProgram(next);await hub.writeReviewedStrengthProgram(source,calculated,'1:fixture-user');assert.equal(writes.length,1);assert.equal(library.exercises[0].sets,4);assert.equal(library.unknown.keep,true);
  const stale=await hub.resolveStrengthWorkoutEditSource(ref);library.exercises[1].sets=9;await assert.rejects(()=>hub.writeReviewedStrengthProgram(stale,next,'1:fixture-user'),e=>e.code==='WORKOUT_EDIT_NOT_SENT');assert.equal(writes.length,1);
  const fresh=await hub.resolveStrengthWorkoutEditSource(ref);await assert.rejects(()=>hub.writeReviewedStrengthProgram(fresh,next,'different'),e=>e.code==='WORKOUT_EDIT_NOT_SENT');assert.equal(writes.length,1);
  const scheduleRef={kind:'scheduled',happenDay:entity.happenDay,planId:entity.planId,idInPlan:entity.idInPlan,planProgramId:entity.planProgramId};const scheduleSource=await hub.resolveStrengthWorkoutEditSource(scheduleRef);assert.equal(scheduleSource.strengthEditOwnership,'independent');
  const changed=patchStrengthProgram(scheduleSource.program,[{stepId:'step-10',restSeconds:90}]).program;await hub.writeReviewedStrengthProgram(scheduleSource,changed,'1:fixture-user');assert.equal(writes.length,2);assert.equal(writes[1].pathname,'/training/schedule/update');assert.deepEqual(writes[1].body.entities,[entity]);assert.equal(writes[1].body.versionObjects[0].status,2);assert.equal(library.exercises[0].restValue,60,'calendar copies do not mutate library');
  plans=[{id:'native-plan',inSchedule:1}];const ambiguous=await hub.resolveStrengthWorkoutEditSource(scheduleRef);assert.equal(ambiguous.strengthEditOwnership,'unknown');await assert.rejects(()=>hub.writeReviewedStrengthProgram(ambiguous,changed,'1:fixture-user'),e=>e.code==='WORKOUT_EDIT_NOT_SENT');assert.equal(writes.length,2);
  failure='token';const tokenSource=await hub.resolveStrengthWorkoutEditSource(ref);await assert.rejects(()=>hub.writeReviewedStrengthProgram(tokenSource,next,'1:fixture-user'),/expired/);assert.equal(writes.length,3,'expired-token mutation is not automatically resent');
  failure='timeout';const timeoutSource=await hub.resolveStrengthWorkoutEditSource(ref);await assert.rejects(()=>hub.writeReviewedStrengthProgram(timeoutSource,next,'1:fixture-user'),/connection lost/);assert.equal(writes.length,4,'accepted timeout is not resent');
  console.log('Strength Training Hub boundary passed: real adapters, account binding, stale preflight, calendar identity, native ownership, one-shot mutation and timeout.');
 } finally {global.fetch=originalFetch;db.close();await fs.rm(root,{recursive:true,force:true});}
}
main().then(()=>app.exit(0),e=>{console.error(e);app.exit(1);});
