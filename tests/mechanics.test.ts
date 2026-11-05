import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../shared/simulation';
import { actuatorCommands } from '../server/prompts';
import { MODEL_ACTIONS, ObservationSchema, PlanSchema, type Plan } from '../shared/protocol';
import { canAcceptAction, isActionCurrent, type RemoteAction } from '../shared/remote-actions';
import { STEP } from '../src/flight';
test('recorded pre-cleanup command snapshots retain every literal actuator value', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/candidate-commands.json', import.meta.url), 'utf8'));
    for (const c of fixture.cases) {
        const actual = actuatorCommands(ObservationSchema.parse(c.observation), PlanSchema.parse(c.plan));
        assert.deepEqual(Object.fromEntries(MODEL_ACTIONS.map(a => [a, actual[a]])), c.expected);
    }
});
test('accepted commands persist between polls, but arrival and goal transitions are checked', () => {
    const state = {
        runId: 'run', planVersion: 1, legIndex: 0, objectiveKey: '1:goal:roof'
    };
    const action: RemoteAction = {
        ...state, type: 'action', seq: 4, continuity: 'goal', action: 'hold', validUntil: 1200,
        probabilities: { hold: 1 }, confidence: 1, latencyMs: 200, calls: 5, model: 'mock'
    };
    assert.ok(canAcceptAction(action, state, 3, 2250, 1000));
    assert.equal(canAcceptAction(action, state, 4, 2250, 1000), false);
    assert.equal(canAcceptAction(action, state, 3, 2250, 1300), false);
    assert.equal(canAcceptAction({ ...action, validUntil: 5000 }, state, 3, 2250, 1000), false);
    assert.ok(isActionCurrent(action, state));
    assert.equal(isActionCurrent(action, { ...state, objectiveKey: '1:goal:other' }), false);
    assert.equal(isActionCurrent(action, { ...state, planVersion: 2 }), false);
    assert.equal(isActionCurrent(action, { ...state, runId: 'other' }), false);
});
test('physics-step progression rejects a command for the just-completed goal', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup('planned');
    s.mission.departure = true;
    const p: Plan = { goals: [{
                id: 'near', kind: 'fly', target: null, position: [35, 20, 140], speed: 8, guidance: [], reviewAfter: false
            },
            {
                id: 'next', kind: 'fly', target: null, position: [35, 30, 120], speed: 8, guidance: [], reviewAfter: false
            }] };
    s.applyAgentPlan(p, 1);
    const old = s.objectiveKey;
    s.flight.position.set(35, 20, 140);
    s.step('openrouter', 'climb', undefined, old);
    assert.equal(s.lastAction, 'hold');
    assert.ok(s.fallback);
    assert.notEqual(s.objectiveKey, old);
    s.dispose();
});
test('setup freezes physics and reserve; airborne HOLD consumes thrust reserve', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup();
    const start = s.flight.position.clone();
    for (let i = 0; i < 120; i++)
        s.step('openrouter', 'hold');
    assert.equal(s.mission.elapsed, 0);
    assert.equal(s.flight.energy, 100);
    assert.ok(start.equals(s.flight.position));
    s.setupPending = false;
    s.flight.reset({
        x: 35, z: 119, y: 20, radius: 5, name: 'fixture', short: 'fixture'
    });
    s.flight.airborne = true;
    s.flight.energy = 70;
    for (let i = 0; i < 120; i++)
        s.step('manual', undefined, {
            pitch: 0, roll: 0, yaw: 0, lift: 0, brake: true, verticalSpeed: 0
        });
    assert.ok(s.flight.energy < 70);
    assert.ok(s.mission.elapsed >= 1 - STEP);
    s.dispose();
});
test('station DESCEND establishes wheel contact above weak-thrust reserve', async () => {
    await RAPIER.init();
    const s = new Simulation();
    s.startAgentSetup('planned');
    s.mission.departure = true;
    s.applyAgentPlan({ goals: [{
                id: 'home', kind: 'depot', target: 'depot', position: null, speed: 4, guidance: [], reviewAfter: false
            }] }, 1);
    s.flight.reset();
    s.flight.body.setTranslation({
        x: 35, y: 1.0, z: 150
    }, true);
    s.flight.sync();
    s.flight.airborne = true;
    s.flight.energy = 50;
    for (let i = 0; i < 1200 && !s.flight.grounded; i++)
        s.step('openrouter', 'descend', undefined, s.objectiveKey);
    assert.ok(s.flight.grounded);
    assert.ok(s.flight.energy > 8);
    s.dispose();
});
