import { TASK_CONSTANTS as C } from './task-constants';
import type { ActiveGoal, Plan } from './protocol';
import type { Flight } from '../src/flight';
import type { Mission } from './mission';
import { TARGETS } from './world';
// Completion bookkeeping only. No maneuver selection, path generation or prediction.
export class GoalExecution {
    index = 0;
    completed = new Set<string>();
    released = new Set<string>();
    ledger: {
        id: string;
        kind: string;
        startedAt: number;
        completedAt: number;
        startEnergy: number;
        endEnergy: number;
        startPosition: number[];
        endPosition: number[];
    }[] = [];
    waiting: ActiveGoal | undefined;
    start: {
        id: string;
        time: number;
        energy: number;
        position: number[];
    } | undefined;
    constructor(public schedule: 'every_relay' | 'planned' = 'every_relay') { }
    install(plan: Plan) {
        if (this.waiting) {
            this.released.add(this.waiting.id);
            this.waiting = undefined;
        }
        this.index = 0;
        while (plan.goals?.[this.index] && this.completed.has(plan.goals[this.index].id))
            this.index++;
    }
    current(plan: Plan): ActiveGoal | undefined {
        return this.waiting ?? plan.goals?.[this.index];
    }
    reviewRequired(g: ActiveGoal) { return (this.schedule === 'every_relay' && g.kind === 'relay') || (g.reviewAfter && ['relay', 'charge'].includes(g.kind)); }
    position(g: ActiveGoal): [
        number,
        number,
        number
    ] {
        if (g.position)
            return g.position;
        const t = TARGETS.find(t => t.id === g.target)!;
        return [t.x, t.y + C.standingHeight, t.z];
    }
    update(plan: Plan, f: Flight, m: Mission) {
        for (;;) {
            const g = this.current(plan);
            if (!g)
                return;
            if (!this.start || this.start.id !== g.id)
                this.start = {
                    id: g.id, time: m.elapsed, energy: f.energy, position: f.position.toArray()
                };
            if (g.kind === 'wait_review')
                return;
            const p = this.position(g), station = TARGETS.find(t => t.id === g.target);
            const finished = g.kind === 'drive' || g.kind === 'fly' ?
                f.position.distanceTo({
                    x: p[0], y: p[1], z: p[2]
                }) < C.transitRadius && (g.kind !== 'drive' || f.grounded) :
                g.kind === 'relay' ? m.completed.includes(g.target!) : g.kind === 'charge' ? !!station && m.onPad(f, station) && f.energy >= C.chargeComplete : m.status === 'success';
            if (!finished)
                return;
            this.record(g, f, m);
            if (this.reviewRequired(g) && !this.released.has(`${g.id}:review`)) {
                this.waiting = {
                    ...g, id: `${g.id}:review`, kind: 'wait_review', position: p, guidance: [], reviewAfter: false
                };
                return;
            }
            this.index++;
            while (plan.goals?.[this.index] && this.completed.has(plan.goals[this.index].id))
                this.index++;
        }
    }
    record(g: ActiveGoal, f: Flight, m: Mission) {
        if (this.completed.has(g.id))
            return;
        const s = this.start?.id === g.id ? this.start : {
            time: m.elapsed, energy: f.energy, position: f.position.toArray()
        };
        this.completed.add(g.id);
        this.ledger.push({
            id: g.id, kind: g.kind, startedAt: s.time, completedAt: m.elapsed, startEnergy: s.energy, endEnergy: f.energy, startPosition: s.position, endPosition: f.position.toArray()
        });
        this.start = undefined;
    }
    release(f: Flight, m: Mission) { if (this.waiting) {
        this.record(this.waiting, f, m);
        this.released.add(this.waiting.id);
        this.waiting = undefined;
    } }
}
