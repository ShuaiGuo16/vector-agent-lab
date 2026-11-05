import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../shared/simulation';
import { STEP } from '../src/flight';
import { RELAYS, CHARGER } from '../shared/world';
before(async () => { await RAPIER.init(); });
for (const seed of [7, 8])
    test(`baseline restores all relays, recharges, and returns with no resets (seed ${seed})`, () => {
        const sim = new Simulation(seed);
        sim.mission.start();
        for (let i = 0; i < 361 / STEP && sim.mission.status === 'running'; i++)
            sim.step('baseline');
        assert.equal(sim.mission.status, 'success', sim.mission.reason);
        assert.equal(sim.mission.completed.length, 3);
        assert.equal(sim.mission.charges, 1);
        assert.equal(sim.mission.collisions, 0);
        assert.equal(sim.mission.interventions, 0);
        assert.ok(sim.time < 300);
        assert.ok(sim.flight.energy > 20);
        sim.dispose();
    });
test('relay activation requires departure, roof height, low speed, gentle landing and continuous dwell', () => {
    const sim = new Simulation(), f = sim.flight, m = sim.mission, p = RELAYS[0];
    m.start();
    f.grounded = true;
    f.position.set(p.x, p.y + .6, p.z);
    f.velocity.set(0, 0, 0);
    for (let i = 0; i < 400; i++)
        m.step(f, STEP);
    assert.equal(m.completed.length, 0);
    m.departure = true;
    m.lastImpact = 6;
    for (let i = 0; i < 400; i++)
        m.step(f, STEP);
    assert.equal(m.completed.length, 0);
    m.lastImpact = 0;
    f.position.y = .6;
    for (let i = 0; i < 400; i++)
        m.step(f, STEP);
    assert.equal(m.completed.length, 0);
    f.position.y = p.y + .6;
    for (let i = 0; i < 120; i++)
        m.step(f, STEP);
    f.velocity.set(3, 0, 0);
    m.step(f, STEP);
    assert.equal(m.dwell[p.id], 0);
    f.velocity.set(0, 0, 0);
    for (let i = 0; i < 301; i++)
        m.step(f, STEP);
    assert.deepEqual(m.completed, [p.id]);
    sim.dispose();
});
test('only the charging station restores energy', () => {
    const sim = new Simulation(), f = sim.flight;
    sim.mission.start();
    f.energy = 40;
    for (let i = 0; i < 120; i++)
        sim.step('manual', undefined, {
            pitch: 0, roll: 0, yaw: 0, lift: 0, brake: true, handbrake: true
        });
    assert.equal(f.energy, 40);
    f.grounded = true;
    f.position.set(CHARGER.x, .6, CHARGER.z);
    f.velocity.set(0, 0, 0);
    sim.mission.step(f, 1);
    assert.equal(f.energy, 54);
    sim.dispose();
});
test('time alone cannot fail a mission, and completion remains possible after 360 seconds', () => {
    const sim = new Simulation(), m = sim.mission;
    m.start();
    m.elapsed = 600;
    m.step(sim.flight, STEP);
    assert.equal(m.status, 'running');
    assert.ok(m.elapsed > 600);
    const reading = sim.observe('elapsed');
    assert.equal('remaining' in reading, false);
    assert.ok(reading.simTime > 600);
    m.departure = true;
    m.completed = RELAYS.map(r => r.id);
    sim.flight.grounded = true;
    sim.flight.velocity.set(0, 0, 0);
    for (let i = 0; i < 301; i++)
        m.step(sim.flight, STEP);
    assert.equal(m.status, 'success');
    assert.ok(m.elapsed > 602);
    sim.dispose();
});
