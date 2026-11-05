import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../shared/simulation';
import { actuatorCommands } from '../server/prompts';
import { objectiveKey, type Goal, type Plan } from '../shared/protocol';
const fly = (id: string, position: [
    number,
    number,
    number
]): Goal => ({
    id, kind: 'fly', target: null, position, speed: 8, guidance: [], reviewAfter: false
});
const relay: Goal = {
    id: 'roof', kind: 'relay', target: 'relay-1', position: null, speed: 6, guidance: [], reviewAfter: false
};
const depot: Goal = {
    ...relay, id: 'home', kind: 'depot', target: 'depot'
};
test('the initial frozen observation already reports the selected review schedule', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup('planned');
    const o = s.observe('setup');
    assert.equal(o.reviewSchedule, 'planned');
    assert.equal(o.setupPending, true);
    s.dispose();
});
test('departure uses the model goal and revised guidance before the physical checkpoint is reached', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup('planned');
    const departure: Goal = {
        id: 'planned-departure', kind: 'drive', target: null, position: [35, .6, 119],
        speed: 5, guidance: ['Initial model guidance'], reviewAfter: false
    };
    s.applyAgentPlan({ goals: [departure, relay, depot] }, 1);
    assert.equal(s.mission.departure, false);
    assert.equal(s.navigator.explicitGoal?.id, departure.id);
    assert.deepEqual(s.observe('departure').goal?.guidance, departure.guidance);

    const revised = { ...departure, speed: 4, guidance: ['Revised model guidance'] };
    s.applyAgentPlan({ goals: [revised, relay, depot] }, 2);
    assert.equal(s.mission.departure, false);
    assert.deepEqual(s.observe('departure').goal?.guidance, revised.guidance);
    assert.equal(s.navigator.explicitGoal?.speed, 4);
    const position = s.flight.position.clone();
    for (let i = 0; i < 120; i++) s.step('openrouter', 'hold', undefined, s.objectiveKey);
    assert.ok(s.flight.position.distanceTo(position) < .01);
    assert.equal(s.mission.departure, false);
    assert.equal(s.navigator.goals.completed.has(departure.id), false);

    // A test-selected command exercises physics; the live model still selects all maneuvers.
    for (let i = 0; i < 3000 && !s.navigator.goals.completed.has(departure.id); i++)
        s.step('openrouter', 'drive', undefined, s.objectiveKey);
    assert.equal(s.mission.departure, true);
    assert.ok(s.navigator.goals.completed.has(departure.id));
    assert.equal(s.navigator.goals.ledger.some(g => g.id === 'engine:departure'), false);
    assert.equal(s.navigator.explicitGoal?.id, relay.id);
    s.dispose();
});

test('omitting departure does not cause the engine to author a replacement goal', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup('planned');
    const omittedDeparture = fly('model-first-goal', [35, 20, 150]);
    s.applyAgentPlan({ goals: [omittedDeparture, relay, depot] }, 1);
    assert.equal(s.navigator.explicitGoal?.id, omittedDeparture.id);
    assert.equal(s.mission.departure, false);
    assert.deepEqual(s.navigator.plan.goals.map(g => g.id), [omittedDeparture.id, relay.id, depot.id]);
    s.dispose();
});
test('stable goal IDs preserve completed work through arbitrary route edits, without coordinate matching', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup();
    s.mission.departure = true;
    s.applyAgentPlan({ goals: [fly('passed', [35, .6, 150]), fly('next', [35, 20, 119]), relay, depot] }, 1);
    assert.ok(s.navigator.goals.completed.has('passed'));
    s.applyAgentPlan({ goals: [fly('passed', [35, .6, 150]), fly('inserted', [35, 25, 119]), relay, depot] }, 2);
    assert.equal(s.navigator.explicitGoal?.id, 'inserted');
    assert.equal(objectiveKey(s.observe('test')), s.objectiveKey);
    // A different ID at a previously visited coordinate is real unfinished work.
    s.applyAgentPlan({ goals: [fly('new-visit', [35, .6, 150]), depot] }, 3);
    // It completes only because the actual car is currently there.
    assert.ok(s.navigator.goals.completed.has('new-visit'));
    s.dispose();
});
test('review waiting is a distinct unfinished goal and release keeps actual completion records', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup();
    s.mission.departure = true;
    const p: Plan = { goals: [relay, depot] };
    s.applyAgentPlan(p, 1);
    s.mission.completed.push('relay-1');
    s.navigator.update(s.flight, s.mission, s.seed);
    assert.equal(s.navigator.explicitGoal?.kind, 'wait_review');
    assert.ok(s.navigator.goals.completed.has('roof'));
    assert.ok(!s.navigator.goals.completed.has('roof:review'));
    const before = s.mission.elapsed;
    s.step('openrouter', 'climb', undefined, s.objectiveKey);
    assert.equal(s.lastAction, 'climb');
    assert.ok(s.mission.elapsed > before);
    s.applyAgentPlan(p, 2);
    assert.equal(s.navigator.explicitGoal?.id, 'home');
    assert.ok(s.navigator.goals.completed.has('roof:review'));
    assert.ok(s.navigator.goals.ledger.some(x => x.id === 'roof'));
    s.dispose();
});
test('planned reviews honor flags; all maneuvers share identical live actuator measurements', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup('planned');
    s.mission.departure = true;
    const p: Plan = { goals: [relay, depot] };
    s.applyAgentPlan(p, 1);
    s.mission.completed.push('relay-1');
    s.navigator.update(s.flight, s.mission, s.seed);
    assert.equal(s.navigator.explicitGoal?.id, 'home');
    const o = s.observe('commands'), commands = actuatorCommands(o, p);
    for (const a of ['drive', 'climb', 'cruise', 'approach', 'descend', 'hold'] as const) {
        const c = s.navigator.execute(a, s.flight);
        assert.equal(commands[a].verticalSpeedTarget, c.verticalSpeed ?? null);
        assert.equal(commands[a].wheelThrottle, c.drive ?? 0);
    }
    s.dispose();
});
test('drive can propel a contacted roof and respects the explicit goal speed', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.mission.departure = true;
    s.applyAgentPlan({ goals: [{
                ...fly('roof-drive', [5, 18.6, 12]), kind: 'drive', speed: 1
            }, depot] }, 1);
    const f = {
        grounded: true, position: s.flight.position.clone().set(0, 18.6, 12), velocity: s.flight.velocity.clone().set(0, 0, 0), yaw: -Math.PI / 2, forwardSpeed: 0
    };
    assert.equal(s.navigator.execute('drive', f).drive, 1);
    assert.equal(s.navigator.execute('drive', { ...f, forwardSpeed: 2 }).drive, -1);
    s.dispose();
});
