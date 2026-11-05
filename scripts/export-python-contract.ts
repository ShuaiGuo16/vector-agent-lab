import { TASK_CONSTANTS } from '../shared/task-constants';
// Shared task/interface facts only. Never export a baseline plan or example answers.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { ACTIONS, MODEL_ACTIONS } from '../shared/protocol';
import { TARGETS, BUILDINGS, ROAD_X, ROAD_Z, closureFor, collisionGeometry } from '../shared/world';
import { executionFacts } from '../server/prompts';
import { TASK_FACTS } from '../server/task-facts';
import { ACTION_MECHANICS } from '../shared/action-mechanics';
const EXECUTION_HISTORY_CONFIG = { sampleIntervalSeconds: 1, recentWindowSeconds: 30 };
import { GOAL_PLANNER_INSTRUCTIONS, GOAL_DECISION_INSTRUCTIONS } from '../server/goal-prompts';
export const contract = {
    taskConstants: TASK_CONSTANTS,
    goalPlannerInstructions: GOAL_PLANNER_INSTRUCTIONS, goalDecisionInstructions: GOAL_DECISION_INSTRUCTIONS, modelActions: MODEL_ACTIONS,
    version: 'I73-model-authored-departure', actions: ACTIONS, taskFacts: TASK_FACTS, actionMechanics: ACTION_MECHANICS,
    executionFacts: executionFacts(), executionHistoryConfig: EXECUTION_HISTORY_CONFIG,
    world: {
        targets: TARGETS, maxBuildingHeight: Math.ceil(Math.max(...BUILDINGS.map(b => b.h))),
        streetX: ROAD_X, streetZ: ROAD_Z, closures: { odd: closureFor(7), even: closureFor(8) }, collisionMaps: { odd: collisionGeometry(7), even: collisionGeometry(8) }
    }
};
const file = new URL('../python_agent/vector_agent/contract.json', import.meta.url);
const data = JSON.stringify(contract, null, 2) + '\n';
if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== data)
        throw Error('Python contract is stale. Run npm run python:contract.');
    console.log('Python task/prompt/schema contract matches this TypeScript source version.');
}
else {
    mkdirSync(new URL('../python_agent/vector_agent/', import.meta.url), { recursive: true });
    writeFileSync(file, data);
    console.log('Exported versioned task/prompt/schema contract (no route or example observations).');
}
