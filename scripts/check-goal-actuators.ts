// Offline: verify every API command measurement against the actual shared tracker.
// No API calls, physics stepping, baseline selector or strategy evaluation.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {actuatorCommands} from '../server/prompts';
import {MODEL_ACTIONS,PlanSchema,ObservationSchema,type Plan,type Observation} from '../shared/protocol';
const id=process.argv[2];if(!id)throw Error('Provide a recorded run ID');
const events=readFileSync(`runs/${id}.jsonl`,'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x));
let plan:Plan|undefined,snapshot:Observation|undefined,checked=0;
for(const event of events){
  const d=event.data;
  if(event.type==='planner_result')plan=PlanSchema.parse(d.plan);
  if(event.type==='decision_request')snapshot=ObservationSchema.parse(d.observation);
  if(event.type==='api_request_payload'&&d.path==='/alpha/decisions'&&d.body){
    assert.ok(plan&&snapshot);
    const commands=actuatorCommands(snapshot,plan);
    assert.deepEqual(d.body.state.liveState.actuatorCommandsAtThisState,Object.fromEntries(MODEL_ACTIONS.map(a=>[a,commands[a]])));
    assert.equal(d.body.state.liveState.currentGoal.id,snapshot.goal?.id);
    checked++;
  }
}
console.log(JSON.stringify({runId:id,decisionCommandSnapshotsChecked:checked,allMatchSharedTracker:true}));
