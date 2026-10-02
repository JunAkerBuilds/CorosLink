import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WatchfaceAutomationServer } from '../dist-electron/watchfaceAutomationServer.js';
import { WorkoutEditService, getWorkoutEditTools, workoutEditSchemas } from '../dist-electron/workoutEditService.js';
import { program } from './fixtures/strength-workout.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'coroslink-workout-mcp-'));
let saved; let writes=0; let source={ref:{kind:'library',programId:'1'},program:program('1')};
const service=new WorkoutEditService({account:()=> 'test',today:()=> '20260921',read:async()=>structuredClone(source),find:async()=>({refs:[source.ref],exclusions:[]}),preview:async(_s,p)=>p,write:async()=>{writes++;},load:()=>saved,persist:v=>{saved=v;}});
const server=new WatchfaceAutomationServer({userDataPath:path.join(root,'workouts'),name:'coroslink-strength-workouts',instructions:'Review edits in CorosLink.',tools:getWorkoutEditTools().map(t=>({name:t.name,title:t.name,description:t.description,method:t.name,schema:workoutEditSchemas[t.name].shape})),dispatch:(name,args)=>service.tool(name,args,'external')});
const watchface=new WatchfaceAutomationServer({userDataPath:path.join(root,'watchfaces'),dispatch:async()=>({})});
let client,transport;
try {
  const status=await server.start({port:0}); const wf=await watchface.start({port:0});assert.notEqual(status.token,wf.token);
  const bad=await fetch(status.url,{method:'POST',headers:{Authorization:`Bearer ${wf.token}`,'content-type':'application/json'},body:'{}'});assert.equal(bad.status,401,'watch-face token must not authorize workouts');
  const foreign=await fetch(status.url,{method:'POST',headers:{Authorization:`Bearer ${status.token}`,origin:'https://example.com','content-type':'application/json'},body:'{}'});assert.equal(foreign.status,403);
  transport=new StreamableHTTPClientTransport(new URL(status.url),{requestInit:{headers:{Authorization:`Bearer ${status.token}`}}});
  client=new Client({name:'strength-integration-test',version:'1.0.0'},{capabilities:{}});await client.connect(transport);
  const list=await client.listTools();assert.equal(list.tools.length,6);assert.ok(!list.tools.some(t=>/save|confirm|publish/.test(t.name)));
  assert.equal(client.getServerCapabilities().resources,undefined,'workout endpoint must not advertise watch-face resources');
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent??JSON.parse(r.content[0].text);};
  const discovery=await call('find_editable_workouts',{source:'library'});assert.equal(discovery.workouts.length,1);
  const d=await call('read_workout_for_edit',{ref:source.ref});
  const p=await call('prepare_workout_edit',{documentId:d.documentId,revision:d.revision,patches:[{stepId:'step-10',sets:4}]});assert.equal(p.state,'awaiting_confirmation');assert.equal(writes,0);
  const invalid=await client.callTool({name:'prepare_workout_edit',arguments:{documentId:d.documentId,revision:d.revision,patches:[{stepId:'step-10',sets:4}],confirmed:true}});assert.equal(invalid.isError,true);
  await assert.rejects(()=>server.callTool('confirm_workout_edit',{proposalId:p.proposalId}));assert.equal(writes,0);
  assert.equal((await call('cancel_workout_edit',{proposalId:p.proposalId})).state,'cancelled');
  await client.close();client=undefined;const token=status.token;await server.stop({revokeToken:true});const restarted=await server.start({port:0});assert.notEqual(restarted.token,token);
  console.log('Workout MCP integration passed: protocol discovery, strict schemas, staging, status/cancel, separate tokens, revocation, and no write tool.');
} finally {await client?.close();await server.stop({revokeToken:true});await watchface.stop({revokeToken:true});await fs.rm(root,{recursive:true,force:true});}
