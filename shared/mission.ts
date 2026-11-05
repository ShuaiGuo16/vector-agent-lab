import { TASK_CONSTANTS as C } from './task-constants';
import type { Flight } from '../src/flight';
import { RELAYS, CHARGER, DEPOT } from './world';
import { MISSION_LIMITS as L } from './mission-limits';
export class Mission {
    status: 'ready' | 'running' | 'success' | 'failed' = 'ready';
    elapsed = 0;
    completed: string[] = [];
    dwell: Record<string, number> = {};
    reason = '';
    collisions = 0;
    interventions = 0;
    staleSeconds = 0;
    departure = false;
    lastImpact = 0;
    charges = 0;
    charging = false;
    start() { this.status = 'running'; }
    onPad(f: Flight, p: {
        x: number;
        y: number;
        z: number;
        radius: number;
    }) { return f.grounded && Math.hypot(f.position.x - p.x, f.position.z - p.z) < p.radius - C.stationRadiusInset && Math.abs(f.position.y - p.y - C.standingHeight) < C.stationHeightTolerance && f.velocity.length() < C.stationSpeed; }
    step(f: Flight, dt: number) {
        if (this.status !== 'running')
            return;
        this.elapsed += dt;
        if (f.grounded && Math.abs(f.position.x - 35) < 8 && f.position.z <= 121 && f.position.z >= 112)
            this.departure = true;
        if (f.landingImpact > 0)
            this.lastImpact = f.landingImpact;
        this.charging = this.onPad(f, CHARGER);
        if (this.charging) {
            const before = f.energy;
            f.energy = Math.min(C.capacity, f.energy + C.chargeRate * dt);
            if (before < C.chargeComplete && f.energy >= C.chargeComplete)
                this.charges++;
        }
        for (const p of RELAYS) {
            if (this.completed.includes(p.id))
                continue;
            const valid = this.departure && this.onPad(f, p) && this.lastImpact < C.landingImpact;
            this.dwell[p.id] = valid ? (this.dwell[p.id] || 0) + dt : 0;
            if (this.dwell[p.id] >= C.dwellSeconds)
                this.completed.push(p.id);
        }
        if (this.completed.length === 3 && this.onPad(f, DEPOT)) {
            this.dwell.depot = (this.dwell.depot || 0) + dt;
            if (this.dwell.depot >= C.dwellSeconds) {
                this.status = 'success';
                this.reason = 'All relays restored. Vehicle returned to Harbor.';
            }
        }
        else
            this.dwell.depot = 0;
        if (f.position.y < L.minY || Math.abs(f.position.x) > L.maxAbsX || f.position.z < L.minZ || f.position.z > L.maxZ)
            this.fail('Vehicle left the operational district');
        if (f.up.y < L.minUpY)
            this.fail('Vehicle overturned');
    }
    fail(reason: string) { if (this.status === 'running') {
        this.status = 'failed';
        this.reason = reason;
    } }
}
