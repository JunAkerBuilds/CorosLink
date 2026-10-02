import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkoutEditService, requireStrengthEligibility, workoutEditSchemas } from '../dist-electron/workoutEditService.js';
import { patchStrengthProgram, weightKg, sourceRevision } from '../dist-electron/strengthWorkoutPatch.js';

import { program } from './fixtures/strength-workout.mjs';

function harness(count = 1, custom = {}) {
  const sources = new Map(Array.from({length: count}, (_, i) => { const p = program(String(i + 1)); return [p.id, { ref: {kind:'library', programId:p.id}, program:p }]; }));
  let saved, account = '1:test', writes = 0, reads = 0;
  const adapter = {
    account: () => account, today: () => '20260921',
    read: async ref => { reads++; return structuredClone(sources.get(ref.programId)); },
    find: async () => ({ refs: [...sources.values()].map(s=>s.ref), exclusions: [] }),
    preview: async (_s, p) => ({ ...p, totalSets: 6 }),
    write: async (s, p) => { writes++; sources.set(s.ref.programId, { ...s, program: structuredClone(p) }); },
    load: () => saved, persist: value => { saved = value; }, wait: async () => {}, ...custom
  };
  const service = new WorkoutEditService(adapter);
  const read = async (id='1', origin='coach') => service.tool('read_workout_for_edit', {ref:{kind:'library',programId:id}}, origin);
  const stage = async (id='1', origin='coach') => {const d=await read(id, origin); return service.tool('prepare_workout_edit',{documentId:d.documentId,revision:d.revision,patches:[{stepId:'step-10',load:{mode:'weight',value:36,unit:'lb'}}]},origin);};
  const confirm = p => service.confirm(p.proposalId,p.reviewHash,p.items.map(i=>i.id));
  return {service, adapter, sources, read, stage, confirm, get writes(){return writes;}, get reads(){return reads;}, get saved(){return saved;}, set saved(v){saved=v;}, set account(v){account=v;} };
}
const loadPatch = [{stepId:'step-10',load:{mode:'weight',value:36,unit:'lb'}}];

test('patch changes only requested raw fields and preserves unknown data and other exercises', () => {
  const source=program(); const {program: next, changes}=patchStrengthProgram(source,loadPatch);
  assert.equal(next.exercises[0].intensityValue,weightKg(36,'lb'));
  const restored=structuredClone(next); restored.exercises[0].intensityValue=source.exercises[0].intensityValue; restored.exercises[0].intensityValueExtend=source.exercises[0].intensityValueExtend;
  assert.deepEqual(restored,source); assert.equal(changes.length,1); assert.match(changes[0].after,/36 lb/);
});
test('sets, reps/time/open, timed rest and bodyweight retain unrelated fields',()=>{
  const p=patchStrengthProgram(program(),[{stepId:'step-10',sets:4,target:{type:'time',seconds:45},restSeconds:90,load:{mode:'bodyweight'}}]).program;
  assert.equal(p.exercises[0].sets,4);assert.equal(p.exercises[0].targetType,2);assert.equal(p.exercises[0].targetValue,45);assert.equal(p.exercises[0].intensityCustom,1);assert.equal(p.exercises[0].restValue,90);assert.equal(p.exercises[0].custom,'retain');
  assert.equal(patchStrengthProgram(program(),[{stepId:'step-10',target:{type:'open'}}]).program.exercises[0].targetType,1);
});
test('precision-aware no-op; 12 kg is not an approximate match for 26 lb',()=>{
  assert.equal(patchStrengthProgram(program(),[{stepId:'step-10',load:{mode:'weight',value:26,unit:'lb'}}]).changes.length,0);
  assert.notEqual(weightKg(26,'lb'),12);
});
test('invalid patches, ambiguous IDs, unknown fields and unsupported rest rejected',()=>{
  for (const patch of [{stepId:'step-10',sets:0},{stepId:'step-10',sets:2.5},{stepId:'step-10',load:{mode:'weight',value:Infinity,unit:'kg'}},{stepId:'step-10',name:'overwrite'},{stepId:'missing',sets:3}]) assert.throws(()=>patchStrengthProgram(program(),[patch]));
  assert.throws(()=>patchStrengthProgram(program(),[...loadPatch,...loadPatch]));
  const p=program();p.exercises.push({...p.exercises[0]});assert.throws(()=>patchStrengthProgram(p,loadPatch));
  const rest=program();rest.exercises[0].restType=3;assert.throws(()=>patchStrengthProgram(rest,[{stepId:'step-10',restSeconds:30}]));
});
test('full revision detects prescription changes even when version metadata is unchanged',()=>{
  const source={ref:{kind:'library',programId:'1'},program:program('1')};const before=sourceRevision(source);source.program.exercises[0].sets++;assert.notEqual(sourceRevision(source),before);
});
test('prepare is read-only, exact hash required, save once and reload persisted results',async()=>{
  const h=harness();const p=await h.stage();assert.equal(h.writes,0);await assert.rejects(()=>h.service.confirm(p.proposalId,'wrong',p.items.map(i=>i.id)));assert.equal(h.writes,0);
  assert.equal((await h.confirm(p)).items[0].state,'verified');assert.equal(h.writes,1);
  await h.confirm(p);assert.equal(h.writes,1);
  const restored=new WorkoutEditService(h.adapter);assert.equal((await restored.status(p.proposalId)).items[0].state,'verified');assert.equal(h.writes,1);
});
test('bulk requires exact exercise and old load; deduplicates targets by rejecting repeated documents',async()=>{
  const h=harness(2);const docs=await Promise.all([h.read('1'),h.read('2')]);
  const args={documents:docs.map(d=>({documentId:d.documentId,revision:d.revision})),exerciseIds:['kb-swing'],oldLoad:{value:26,unit:'lb'},newLoad:{value:36,unit:'lb'}};
  const p=await h.service.tool('prepare_exercise_load_update',args);assert.equal(p.items.length,2);assert.equal(p.items[0].changes.length,1);
  await h.service.confirm(p.proposalId,p.reviewHash,[p.items[0].id]);assert.equal(h.writes,1);assert.equal(h.sources.get('2').program.exercises[0].intensityValue,weightKg(26,'lb'));
  const h2=harness();const d=await h2.read();await assert.rejects(()=>h2.service.tool('prepare_exercise_load_update',{...args,documents:[d,d].map(x=>({documentId:x.documentId,revision:x.revision}))}),/more than once/);
});
test('preflight stale batch writes nothing',async()=>{
  const h=harness(2);const docs=await Promise.all([h.read('1'),h.read('2')]);const p=await h.service.tool('prepare_exercise_load_update',{documents:docs.map(d=>({documentId:d.documentId,revision:d.revision})),exerciseIds:['kb-swing'],oldLoad:{value:26,unit:'lb'},newLoad:{value:36,unit:'lb'}});
  h.sources.get('2').program.exercises[0].sets=5;await assert.rejects(()=>h.confirm(p),/changed/);assert.equal(h.writes,0);
});
test('timeout after accepted write reconciles without resend',async()=>{
  const h=harness();let calls=0;h.adapter.write=async(s,p)=>{calls++;h.sources.set(s.ref.programId,{...s,program:p});throw new Error('timeout');};
  const p=await h.stage();assert.equal((await h.confirm(p)).items[0].state,'unknown_outcome');assert.equal((await h.service.status(p.proposalId)).items[0].state,'verified');await h.confirm(p);assert.equal(calls,1);
});
test('mid-batch failure stops further writes and reports partial success',async()=>{
  const h=harness(3);let calls=0;const write=h.adapter.write;h.adapter.write=async(s,p)=>{calls++;if(calls===2)throw new Error('network');await write(s,p);};
  const docs=await Promise.all(['1','2','3'].map(x=>h.read(x)));const p=await h.service.tool('prepare_exercise_load_update',{documents:docs.map(d=>({documentId:d.documentId,revision:d.revision})),exerciseIds:['kb-swing'],oldLoad:{value:26,unit:'lb'},newLoad:{value:36,unit:'lb'}});
  const result=await h.confirm(p);assert.deepEqual(result.items.map(i=>i.state),['verified','unknown_outcome','prepared']);assert.equal(calls,2);assert.match(result.message,/1 of 3/);
});
test('account change and client-origin mismatch prevent approval or reading',async()=>{
  const h=harness();const p=await h.stage();await assert.rejects(()=>h.service.tool('get_workout_edit_status',{proposalId:p.proposalId},'external'),/another client/);h.account='other';await assert.rejects(()=>h.confirm(p),/account changed/);assert.equal(h.writes,0);
});
test('cancel and revoke external capability prevent pending writes',async()=>{
  const h=harness();const p=await h.stage('1','external');h.service.cancelExternal();assert.equal((await h.confirm(p)).state,'cancelled');assert.equal(h.writes,0);
});
test('concurrent confirms cannot duplicate writes',async()=>{
  const h=harness();let release;const gate=new Promise(r=>release=r);const original=h.adapter.write;h.adapter.write=async(s,p)=>{await gate;await original(s,p);};
  const p=await h.stage();const saving=h.confirm(p);await assert.rejects(()=>h.confirm(p),/Another/);release();await saving;assert.equal(h.writes,1);
});
test('interrupted writing reconciles after restart; expired drafts never write',async()=>{
  const h=harness();const p=await h.stage();const saved=JSON.parse(h.saved);saved.proposals[0].preview.state='saving';saved.proposals[0].preview.items[0].state='writing';h.saved=JSON.stringify(saved);
  const restored=new WorkoutEditService(h.adapter);assert.equal((await restored.status(p.proposalId)).items[0].state,'unknown_outcome');assert.equal(h.writes,0);
  const state=JSON.parse(h.saved);state.proposals[0].preview.state='awaiting_confirmation';state.proposals[0].preview.expiresAt=0;h.saved=JSON.stringify(state);
  const expired=new WorkoutEditService(h.adapter);assert.equal((await expired.confirm(p.proposalId,p.reviewHash,[p.items[0].id])).state,'expired');assert.equal(h.writes,0);
});
test('calendar excludes today/history, native plans, completed and unknown ownership',()=>{
  const ref={kind:'scheduled',happenDay:'20260922',planId:'0',idInPlan:'1',planProgramId:'2'};
  const source={ref,program:program(),entity:{...ref,status:2},strengthEditOwnership:"independent"};
  requireStrengthEligibility(source,'20260921');
  for(const changed of [{...source,ref:{...ref,happenDay:'20260921'}},{...source,ref:{...ref,planId:'9'}},{...source,entity:{...source.entity,finishTime:1}},{...source,entity:{idInPlan:'1'}},{...source,ref:{...ref,happenDay:'20260230'}}]) assert.throws(()=>requireStrengthEligibility(changed,'20260921'));
});
test('scope validates actual dates, range and strict schema',async()=>{
  const h=harness();for(const args of [{source:'calendar'},{source:'calendar',startDay:'20260230',endDay:'20260301'},{source:'calendar',startDay:'20260101',endDay:'20261201'}]) await assert.rejects(()=>h.service.tool('find_editable_workouts',args));
  assert.equal(Object.hasOwn(workoutEditSchemas,'confirm_workout_edit'),false);
  assert.throws(()=>workoutEditSchemas.prepare_workout_edit.parse({documentId:'x',revision:'r',patches:loadPatch,confirmed:true}));
});
test('no-op and failed calculation never create a writable proposal',async()=>{
  const h=harness();const d=await h.read();const result=await h.service.tool('prepare_workout_edit',{documentId:d.documentId,revision:d.revision,patches:[{stepId:'step-10',sets:3}]});assert.equal(result.state,'no_changes');assert.equal(h.service.list().length,0);
  h.adapter.preview=async(s,p)=>({...p,exercises:[]});await assert.rejects(()=>h.stage(),/calculation changed/);assert.equal(h.writes,0);
});

test('nonzero calendar plan ID can be independent; ambiguous native inventory is excluded',async()=>{
  const {classifyStrengthCalendarOwnership}=await import('../dist-electron/strengthWorkoutPatch.js');
  assert.equal(classifyStrengthCalendarOwnership('425868133463670784',[]),'independent');
  assert.equal(classifyStrengthCalendarOwnership('calendar',[{id:'native',inSchedule:0}]),'independent');
  assert.equal(classifyStrengthCalendarOwnership('native',[{id:'native',inSchedule:1}]),'native');
  assert.equal(classifyStrengthCalendarOwnership('calendar',[{id:'native',inSchedule:1}]),'unknown');
  assert.equal(classifyStrengthCalendarOwnership('calendar',{}),'unknown');
});
test('repeat groups keep their repetition count and sibling prescriptions',()=>{
  const p=program();p.exercises[0].groupId='group';p.exercises.unshift({id:'group',isGroup:true,sets:4,targetType:2,targetValue:0,sortNo:0,name:'Circuit'});
  const next=patchStrengthProgram(p,[{stepId:'step-10',sets:2,target:{type:'time',seconds:30}}]).program;
  assert.equal(next.exercises[0].sets,4);assert.equal(next.exercises[0].targetValue,30);assert.equal(next.exercises[1].sets,2);assert.deepEqual(next.exercises.slice(2),p.exercises.slice(2));
});
test('zero load remains distinct from bodyweight',()=>{
  const p=patchStrengthProgram(program(),[{stepId:'step-10',load:{mode:'weight',value:0,unit:'kg'}}]).program;
  assert.equal(p.exercises[0].intensityCustom,0);assert.equal(p.exercises[0].intensityValue,0);
  const body=patchStrengthProgram(p,[{stepId:'step-10',load:{mode:'bodyweight'}}]);assert.equal(body.program.exercises[0].intensityCustom,1);assert.equal(body.changes.length,1);
});
test('cancel during a write lets that request settle and skips later items',async()=>{
  const h=harness(2);let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);const write=h.adapter.write;
  h.adapter.write=async(s,p)=>{started();await gate;await write(s,p);};
  const docs=await Promise.all(['1','2'].map(x=>h.read(x)));const p=await h.service.tool('prepare_exercise_load_update',{documents:docs.map(d=>({documentId:d.documentId,revision:d.revision})),exerciseIds:['kb-swing'],oldLoad:{value:26,unit:'lb'},newLoad:{value:36,unit:'lb'}});
  const saving=h.confirm(p);await begin;await h.service.tool('cancel_workout_edit',{proposalId:p.proposalId});release();const result=await saving;assert.equal(h.writes,1);assert.deepEqual(result.items.map(i=>i.state),['verified','cancelled']);
});
test('unresolved save blocks another proposal; status checks never resend',async()=>{
  const h=harness();let calls=0;h.adapter.write=async()=>{calls++;throw new Error('timeout');};const p=await h.stage();await h.confirm(p);await assert.rejects(()=>h.stage(),/unresolved/);await h.service.status(p.proposalId);assert.equal(calls,1);
});
test('temporary read-back errors retry reads only',async()=>{
  const h=harness();const read=h.adapter.read;let failed=false;h.adapter.read=async ref=>{if(h.writes>0&&!failed){failed=true;throw new Error('temporary read error');}return read(ref);};
  const p=await h.stage();assert.equal((await h.confirm(p)).items[0].state,'verified');assert.equal(h.writes,1);assert.equal(failed,true);
});
test('account switch during prepare discards the proposal',async()=>{
  const h=harness();h.adapter.preview=async(_s,p)=>{h.account='changed';return p;};await assert.rejects(()=>h.stage(),/account changed/);assert.equal(h.writes,0);assert.equal(h.service.list().length,0);
});

test('reconciliation updates the summary, not just the item state',async()=>{
  const h=harness();h.adapter.write=async(s,p)=>{h.sources.set(s.ref.programId,{...s,program:p});throw new Error('timeout');};const p=await h.stage();await h.confirm(p);assert.match((await h.service.status(p.proposalId)).message,/1 of 1 selected workouts verified/);
});
test('known pre-dispatch rejection is a conflict, not an unknown write',async()=>{
  const h=harness();h.adapter.write=async()=>{throw Object.assign(new Error('changed before dispatch'),{code:'WORKOUT_EDIT_NOT_SENT'});};const p=await h.stage();assert.equal((await h.confirm(p)).items[0].state,'conflicted');assert.equal(h.writes,0);
});
test('unsafe numeric exercise identifiers are rejected instead of rounded',()=>{
  const p=program();p.exercises[0].originId=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>patchStrengthProgram(p,loadPatch),/identity/);
});

test('unchanged target in a load edit preserves raw target and repeat metadata',()=>{
  const p=program();p.exercises[0].groupId='group';p.exercises[0].targetDisplayUnit=7;
  p.exercises.unshift({id:'group',isGroup:true,sets:4,targetType:3,targetValue:10,sortNo:0,name:'Circuit',custom:'preserve'});
  const result=patchStrengthProgram(p,[{...loadPatch[0],target:{type:'reps',count:10}}]);
  assert.deepEqual(result.program.exercises[0],p.exercises[0]);
  assert.equal(result.program.exercises[1].targetDisplayUnit,7);
  assert.deepEqual(result.changes.map(c=>c.field),['Load']);
});
test('unchanged numeric string sets and rest are not normalized alongside a load edit',()=>{
  const p=program();p.exercises[0].sets='3';p.exercises[0].restValue='60';
  const result=patchStrengthProgram(p,[{...loadPatch[0],sets:3,restSeconds:60}]);
  assert.equal(result.program.exercises[0].sets,'3');assert.equal(result.program.exercises[0].restValue,'60');
  assert.deepEqual(result.changes.map(c=>c.field),['Load']);
});
test('null or malformed native-plan flags do not establish calendar independence',async()=>{
  const {classifyStrengthCalendarOwnership}=await import('../dist-electron/strengthWorkoutPatch.js');
  for(const value of [null,'',false,undefined]) assert.equal(classifyStrengthCalendarOwnership('calendar',[{id:'native',inSchedule:value}]),'unknown');
  assert.equal(classifyStrengthCalendarOwnership('calendar',[{inSchedule:0}]),'unknown');
  assert.equal(classifyStrengthCalendarOwnership('calendar',[{id:Number.MAX_SAFE_INTEGER+1,inSchedule:0}]),'unknown');
});
test('zero activity identifiers do not mark future occurrences complete',()=>{
  const ref={kind:'scheduled',happenDay:'20260922',planId:'calendar',idInPlan:'1',planProgramId:'2'};
  const source={ref,program:program(),entity:{...ref,status:2,activityId:'0',labelId:'0'},strengthEditOwnership:'independent'};
  requireStrengthEligibility(source,'20260921');
  for(const finished of [true,1,'1']) assert.throws(()=>requireStrengthEligibility({...source,entity:{...source.entity,finished}},'20260921'),/completed/);
});
test('calculation cannot change identity or unreviewed program metadata',async()=>{
  for(const mutate of [p=>({...p,id:'another-workout'}),p=>({...p,unknown:{keep:false}})]){
    const h=harness();h.adapter.preview=async(_source,p)=>mutate(p);
    await assert.rejects(()=>h.stage(),/calculation changed/);assert.equal(h.writes,0);
  }
});
test('unresolved writes survive retention cleanup and continue blocking retries',async()=>{
  const h=harness();h.adapter.write=async()=>{throw new Error('timeout');};const p=await h.stage();await h.confirm(p);
  const data=JSON.parse(h.saved);data.proposals[0].preview.createdAt=Date.now()-8*86400000;h.saved=JSON.stringify(data);
  const restored=new WorkoutEditService(h.adapter);assert.equal((await restored.status(p.proposalId)).items[0].state,'unknown_outcome');
  const d=await restored.tool('read_workout_for_edit',{ref:{kind:'library',programId:'1'}});
  await assert.rejects(()=>restored.tool('prepare_workout_edit',{documentId:d.documentId,revision:d.revision,patches:loadPatch}),/unresolved/);
});
