import { Vector3 } from 'three';
import { EMPTY_INPUT, type Flight, type Input } from '../src/flight';
import type { Action } from './protocol';
export type VehicleState = Pick<Flight, 'grounded' | 'position' | 'velocity' | 'yaw' | 'forwardSpeed'>;
export type TrackingTarget = {
    position: {
        x: number;
        z: number;
    };
    trackingAltitude: number;
    descentHeight: number;
    speed: number;
    driveSpeedCap: number;
    holdDescentOutside4m: boolean;
};
const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
export function headingError(f: Pick<Flight, 'position' | 'yaw'>, target: {
    x: number;
    z: number;
}) {
    const desired = Math.atan2(-(target.x - f.position.x), -(target.z - f.position.z));
    return Math.atan2(Math.sin(desired - f.yaw), Math.cos(desired - f.yaw));
}
// Literal bounded tracking only; never selects a maneuver or avoids an obstacle.
export function trackManeuver(action: Action, f: VehicleState, target: TrackingTarget): Input {
    const input = { ...EMPTY_INPUT }, t = target.position, dx = t.x - f.position.x, dz = t.z - f.position.z, dist = Math.hypot(dx, dz), angle = headingError(f, target.position);
    if (action === 'hold' || action === 'brake') {
        return {
            ...input, brake: true, handbrake: true, verticalSpeed: 0
        };
    }
    if (action === 'drive') {
        if (!f.grounded)
            return {
                ...input, brake: true, verticalSpeed: 0
            };
        const cap = target.driveSpeedCap;
        const speed = Math.abs(angle) > .5 ? Math.min(3.5, cap) : Math.min(cap, Math.max(2.5, dist * .45));
        return {
            ...input, drive: f.forwardSpeed < speed - .3 ? 1 : f.forwardSpeed > speed + .3 ? -1 : 0, steer: clamp(angle * 2.8)
        };
    }
    input.yaw = clamp(angle * 1.7);
    if (action === 'climb') {
        input.lift = 1;
        input.verticalSpeed = clamp((target.trackingAltitude - f.position.y) * 1.2, -1, 6);
        input.brake = true;
        return input;
    }
    const horizontalSpeed = Math.hypot(f.velocity.x, f.velocity.z);
    const speedLimit = action === 'cruise' ? target.speed : action === 'approach' ? 4 : 1.4;
    const desiredSpeed = Math.min(speedLimit, dist * .7);
    const desired = new Vector3(dx, 0, dz).normalize().multiplyScalar(desiredSpeed);
    const acceleration = desired.sub(new Vector3(f.velocity.x, 0, f.velocity.z)).multiplyScalar(1.4);
    const forward = new Vector3(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
    input.pitch = -clamp(acceleration.dot(forward) / 2.4);
    input.brake = (Math.abs(angle) > .65 && dist > 2) || (dist < .65 && horizontalSpeed > .1);
    if (input.brake)
        input.pitch = 0;
    const descentHeight = target.descentHeight;
    input.verticalSpeed = action === 'descend' ? clamp((descentHeight - f.position.y) * .85, -3, 1) : clamp((target.trackingAltitude - f.position.y) * .8, -2, 2);
    if (action === 'descend') {
        input.lift = -1;
        if (target.holdDescentOutside4m && dist > 4)
            input.verticalSpeed = 0;
        if (f.grounded) {
            input.lift = 0;
            input.brake = true;
            input.handbrake = true;
        }
    }
    return input;
}
