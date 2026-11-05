import { Flight, STEP, type Input } from '../src/flight';
import { addDistrictCollision } from './world';
import { Mission } from './mission';
import { Navigator } from './controller';
import { BaselineNavigator } from './baseline';
import type { Observation, Action, Mode, Plan } from './protocol';
import { Vector3 } from 'three';
import { MISSION_LIMITS as L } from './mission-limits';
export class Simulation {
    relayHandoffWaitSeconds = 0;
    flight = new Flight();
    mission = new Mission();
    navigator: Navigator = new BaselineNavigator();
    seq = 0;
    time = 0;
    setupPending = false;
    setupElapsedSeconds = 0;
    lastAction: Action = 'hold';
    fallback = false;
    constructor(public seed = 7) { this.flight.energyDrainScale = .22; this.flight.groundRechargeRate = 0; addDistrictCollision(this.flight, seed); for (let i = 0; i < 90; i++)
        this.flight.step({
            pitch: 0, roll: 0, yaw: 0, lift: 0, brake: true, handbrake: true
        }); this.flight.energy = 100; }
    startAgentSetup(schedule: 'every_relay' | 'planned' = 'every_relay') { this.navigator.goals.schedule = schedule; this.mission.start(); this.setupPending = true; }
    get relayHandoffWaiting() { return this.navigator.isExplicit && !!this.navigator.goals.waiting; }
    applyAgentPlan(plan: Plan, version: number) {
        if (!this.navigator.isExplicit) {
            const schedule = this.navigator.goals.schedule;
            this.navigator = new Navigator();
            this.navigator.goals.schedule = schedule;
        }
        const n = this.navigator;
        n.goals.release(this.flight, this.mission);
        n.plan = plan;
        n.goals.install(plan);
        n.version = version;
        this.setupPending = false;
        n.update(this.flight, this.mission, this.seed);
        return true;
    }
    get objectiveKey() { const n = this.navigator; return n.isExplicit ? `${n.version}:goal:${n.explicitGoal?.id ?? 'complete'}` : `${n.version}:setup`; }
    step(mode: Mode, action?: Action, manual?: Input, actionObjective?: string) {
        if (this.mission.status !== 'running')
            return;
        if (mode !== 'openrouter') {
            if (this.navigator.isExplicit && this.navigator.goals.waiting) {
                this.navigator.goals.release(this.flight, this.mission);
                this.navigator.goals.install(this.navigator.plan);
            }
        }
        if (this.setupPending) {
            this.time += STEP;
            this.setupElapsedSeconds += STEP;
            return;
        }
        this.navigator.update(this.flight, this.mission, this.seed);
        if (this.relayHandoffWaiting)
            this.relayHandoffWaitSeconds += STEP;
        if (mode === 'openrouter' && actionObjective !== undefined && actionObjective !== this.objectiveKey) {
            action = 'hold';
            this.fallback = true;
        }
        this.lastAction = mode === 'baseline' ? this.navigator.baselineAction(this.flight) : action || 'hold';
        const before = this.flight.velocity.clone();
        this.flight.step(manual || this.navigator.execute(this.lastAction, this.flight));
        const delta = before.distanceTo(this.flight.velocity);
        if (delta > L.collisionCountDelta && this.mission.elapsed > L.collisionGraceSeconds) {
            this.mission.collisions++;
            if (delta > L.severeCollisionDelta)
                this.mission.fail('Severe collision');
        }
        if (this.fallback)
            this.mission.staleSeconds += STEP;
        this.mission.step(this.flight, STEP);
        if (this.navigator.isExplicit && (this.mission.status as string) === 'success')
            this.navigator.update(this.flight, this.mission, this.seed);
        this.time += STEP;
    }
    observe(runId: string, paused = false): Observation {
        const facing = new Vector3(0, 0, -1).applyQuaternion(this.flight.quaternion);
        const angular = this.flight.body.angvel();
        const pose = {
            bodyOrientationQuaternion: this.flight.quaternion.toArray() as [
                number,
                number,
                number,
                number
            ],
            bodyAngularVelocityWorld: [angular.x, angular.y, angular.z] as [
                number,
                number,
                number
            ],
            bodyUpWorld: this.flight.up.toArray() as [
                number,
                number,
                number
            ],
            bodyHeadingYawRadians: Math.hypot(facing.x, facing.z) < 1e-6 ? null : Math.atan2(-facing.x, -facing.z)
        };
        const f = this.flight, n = this.navigator, t = n.waypoint();
        const surface = n.isExplicit && n.explicitGoal ? n.goals.position(n.explicitGoal)[1] - .6 : n.stage === 'departure' ? 0 : n.target.y;
        return {
            ...pose, reviewSchedule: n.goals.schedule, ...(n.isExplicit ? {
                goal: n.explicitGoal, completedGoalIds: [...n.goals.completed], goalLedger: n.goals.ledger
            } : {}), ...(n.isExplicit ? {
                relayHandoffMode: 'station' as const, relayHandoffWaiting: this.relayHandoffWaiting, relayHandoffWaitSeconds: this.relayHandoffWaitSeconds
            } : {}), flightThrottle: f.throttle, nozzleThrustLevels: [...f.thrusts] as [
                number,
                number,
                number,
                number
            ], targetDwellSeconds: this.mission.dwell[n.target.id] || 0, lastLandingImpact: this.mission.lastImpact, chargingEligible: this.mission.charging, chargingStopsCompleted: this.mission.charges, waypoint: {
                kind: n.stage === 'departure' ? 'departure' : n.stage === 'road' ? 'road' : n.stage === 'model' ? 'model' : 'destination', position: [t.x, surface, t.z], distance: Math.round(Math.hypot(f.position.x - t.x, f.position.z - t.z) * 100) / 100, heightAboveSurface: Math.round((f.position.y - surface - .6) * 100) / 100
            }, lastAppliedManeuver: this.lastAction, runId, seq: ++this.seq, simTime: this.mission.elapsed, wallElapsedSeconds: this.time, setupElapsedSeconds: this.setupElapsedSeconds, setupPending: this.setupPending, waypointIndex: 0, observedAt: Date.now(), position: f.position.toArray() as [
                number,
                number,
                number
            ], velocity: f.velocity.toArray() as [
                number,
                number,
                number
            ], yaw: f.yaw, grounded: f.grounded, energy: f.energy, speed: Math.hypot(f.velocity.x, f.velocity.z), headingError: n.headingError(f), distance: Math.hypot(f.position.x - t.x, f.position.z - t.z), heightAboveTarget: f.position.y - n.target.y - .6, cruiseAltitude: n.trackingAltitude, target: n.target.id as Observation['target'], targetPosition: [n.target.x, n.target.y, n.target.z], departureComplete: this.mission.departure, roadTravelPending: n.stage === 'road', stage: n.stage, completed: [...this.mission.completed] as Observation['completed'], status: this.mission.status, seed: this.seed, interventions: this.mission.interventions, collisions: this.mission.collisions, staleSeconds: this.mission.staleSeconds, planVersion: n.version, legIndex: n.index, paused
        };
    }
    dispose() { this.flight.world.free(); }
}
