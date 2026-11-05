// Fixed conventional demonstration. Never used to select AI-run maneuvers.
import type { Flight } from '../src/flight';
import type { Mission } from './mission';
import type { Action } from './protocol';
import { Navigator } from './controller';
import { trackManeuver, type VehicleState } from './maneuvers';
export class BaselineNavigator extends Navigator {
    override readonly isExplicit = false;
    constructor() {
        super();
        this.plan = { goals: ['relay-1', 'relay-2', 'charger', 'relay-3', 'depot'].map((id, i) => ({
                id: `baseline:${i}`, kind: id === 'charger' ? 'charge' : id === 'depot' ? 'depot' : 'relay',
                target: id as 'relay-1' | 'relay-2' | 'relay-3' | 'charger' | 'depot', position: null,
                speed: 11, guidance: [], reviewAfter: false
            })) };
    }
    override update(f: Flight, m: Mission, _seed: number) {
        const t = this.target;
        const finished = t.id.startsWith('relay') ? m.completed.includes(t.id) : t.id === 'charger' ? m.onPad(f, t) && f.energy >= 98 : false;
        if (finished && this.index < this.plan.goals.length - 1) {
            this.index++;
            this.stage = 'climb';
        }
        if (!m.departure) {
            this.stage = 'departure';
            return;
        }
        if (this.stage === 'departure')
            this.stage = 'climb';
        const distance = Math.hypot(f.position.x - this.target.x, f.position.z - this.target.z), speed = Math.hypot(f.velocity.x, f.velocity.z);
        if (this.stage === 'climb' && f.position.y >= 66.5)
            this.stage = 'cruise';
        if (this.stage === 'cruise' && distance < 22)
            this.stage = 'approach';
        if (this.stage === 'approach' && distance < 1.2 && speed < .8)
            this.stage = 'descend';
        if (this.stage === 'descend' && m.onPad(f, this.target))
            this.stage = 'dwell';
        if (this.stage === 'dwell' && !f.grounded)
            this.stage = 'descend';
    }
    override get trackingAltitude() { return 68; }
    override waypoint() { return this.stage === 'departure' ? {
        x: 35, y: 0, z: 119
    } : this.target; }
    override baselineAction(): Action { return this.stage === 'departure' ? 'drive' : this.stage === 'climb' ? 'climb' : this.stage === 'cruise' ? 'cruise' : this.stage === 'approach' ? 'approach' : this.stage === 'descend' ? 'descend' : 'hold'; }
    override execute(action: Action, f: VehicleState) {
        return trackManeuver(action, f, {
            position: this.waypoint(), trackingAltitude: 68,
            descentHeight: (this.stage === 'departure' ? 0 : this.target.y) + .6, speed: 11, driveSpeedCap: 8, holdDescentOutside4m: true
        });
    }
}
