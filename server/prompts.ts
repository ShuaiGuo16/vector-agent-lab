import type { Observation, Plan } from '../shared/protocol';
import { ACTIONS } from '../shared/protocol';
import { Navigator } from '../shared/controller';
import { Vector3, Quaternion } from 'three';
import { BODY_COLLISION_ENVELOPE } from '../shared/task-constants';
const ENERGY_CONTEXT = {
    units: 'percentage points of the thrust reserve; capacity is 100', scope: 'A flight-resource budget, separate from wheel propulsion. Ordinary wheel driving and remaining parked with flight disengaged consume none of this reserve. Flight, including hovering or holding in the air, consumes reserve. Only the charging station replenishes it.', approximateHoverEnergyPerSecond: .55, consumption: 'Estimate for level hover with full available thrust. Actual consumption depends on throttle, climb, braking, attitude and time spent aligning or waiting in flight.', lowEnergyThrust: {
        startsBelow: 8, commandedThrottleMultiplier: 'min(1, energy / 8)', effect: 'Below 8 energy the same throttle command produces less thrust, reducing ability to maintain altitude or arrest descent. Nominal climb/descent performance is not assured.'
    }
};
export function executionFacts() { return { physics: {
        energy: ENERGY_CONTEXT, standingHeightAboveSurface: .6, tracking: 'Controls are bounded setpoints followed with inertia; they do not snap the vehicle to a target. Most scalar measurements are rounded to 0.01, while reported completion-condition flags use the underlying game measurements.', bodyCollisionEnvelopeLocal: BODY_COLLISION_ENVELOPE
    } }; }
export function actuatorCommands(o: Observation, plan: Plan) {
    const n = new Navigator();
    n.plan = plan;
    n.index = o.legIndex;
    n.goals.index = o.legIndex;
    n.explicitGoal = o.goal;
    const velocity = new Vector3(...o.velocity), forward = o.bodyOrientationQuaternion ? new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...o.bodyOrientationQuaternion)) : new Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw));
    const f = {
        position: new Vector3(...o.position), velocity, yaw: o.yaw, grounded: o.grounded, forwardSpeed: velocity.dot(forward)
    };
    // Only the existing actuator mapping is evaluated. No update(), baselineAction(),
    // future physics, progress score, eligibility mask or recommended action.
    return Object.fromEntries(ACTIONS.map(action => { const c = n.execute(action, f); return [action, {
            verticalSpeedTarget: c.verticalSpeed ?? null, wheelThrottle: c.drive ?? 0, horizontalBrake: c.brake, pitchTilt: c.pitch, liftMode: c.lift
        }]; }));
}
