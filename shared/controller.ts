import { TASK_CONSTANTS as C } from './task-constants';
import type { Flight } from '../src/flight';
import type { Mission } from './mission';
import { TARGETS } from './world';
import type { ActiveGoal, Plan, Action } from './protocol';
import { GoalExecution } from './goals';
import { trackManeuver, headingError, type VehicleState } from './maneuvers';
export class Navigator {
    readonly isExplicit: boolean = true;
    goals = new GoalExecution();
    explicitGoal: ActiveGoal | undefined;
    plan: Plan = { goals: [] };
    version = 0;
    index = 0;
    stage = 'departure';
    get target() {
        const id = this.explicitGoal?.target ?? this.plan.goals.slice(this.index).find(g => g.target)?.target ?? 'depot';
        return TARGETS.find(t => t.id === id)!;
    }
    update(f: Flight, m: Mission, _seed: number) {
        this.goals.update(this.plan, f, m);
        this.explicitGoal = this.goals.current(this.plan);
        this.index = this.goals.index;
        this.stage = this.explicitGoal?.kind ?? 'complete';
    }
    get trackingAltitude() {
        const g = this.explicitGoal;
        return g ? this.goals.position(g)[1] + (['relay', 'charge', 'depot'].includes(g.kind) ? C.flightSettleOffset : 0) : this.target.y + C.standingHeight + C.flightSettleOffset;
    }
    waypoint() {
        if (this.explicitGoal) {
            const p = this.goals.position(this.explicitGoal);
            return {
                x: p[0], y: p[1], z: p[2]
            };
        }
        return this.target;
    }
    baselineAction(f: Flight): Action {
        const g = this.explicitGoal;
        if (!g)
            return 'hold';
        const p = this.goals.position(g), distance = Math.hypot(p[0] - f.position.x, p[2] - f.position.z);
        if (g.kind === 'departure' || g.kind === 'drive')
            return 'drive';
        if (g.kind === 'wait_review')
            return 'hold';
        if (f.grounded && p[1] > f.position.y + 1.5)
            return 'climb';
        if (g.kind === 'fly')
            return f.position.y < p[1] - 1.5 ? 'climb' : distance > 22 ? 'cruise' : 'approach';
        if (distance > 22)
            return 'cruise';
        if (distance > 1.2 || Math.hypot(f.velocity.x, f.velocity.z) > .8)
            return 'approach';
        return f.grounded ? 'hold' : 'descend';
    }
    headingError(f: Pick<Flight, 'position' | 'yaw'>) { return headingError(f, this.waypoint()); }
    execute(action: Action, f: VehicleState) {
        const g = this.explicitGoal;
        return trackManeuver(action, f, {
            position: this.waypoint(), trackingAltitude: this.trackingAltitude,
            descentHeight: g ? this.goals.position(g)[1] : this.target.y + C.standingHeight, speed: g?.speed ?? 3,
            driveSpeedCap: Math.min(8, g?.speed ?? 3), holdDescentOutside4m: false
        });
    }
}
