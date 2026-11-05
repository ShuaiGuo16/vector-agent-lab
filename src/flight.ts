import { BODY_COLLIDERS } from '../shared/task-constants';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3 } from 'three';
export const STEP = 1 / 120, MASS = 1300, GRAVITY = 9.81, WHEEL_RADIUS = .458, SUSPENSION_REST = .22;
export const WHEEL_POINTS = [new Vector3(-1.015, .04, -1.46), new Vector3(-1.07, .04, 1.45), new Vector3(1.015, .04, -1.46), new Vector3(1.07, .04, 1.45)];
export const THRUST_POINTS = [new Vector3(-1.02, -.28, -1.55), new Vector3(1.02, -.28, -1.55), new Vector3(-1.02, -.28, 1.55), new Vector3(1.02, -.28, 1.55)];
export type Input = {
    pitch: number;
    roll: number;
    yaw: number;
    lift: number;
    brake: boolean;
    autoBrake?: boolean;
    drive?: number;
    steer?: number;
    handbrake?: boolean;
    verticalSpeed?: number;
};
export const EMPTY_INPUT: Input = {
    pitch: 0, roll: 0, yaw: 0, lift: 0, brake: false
};
export type Pad = {
    x: number;
    z: number;
    y: number;
    radius: number;
    name: string;
    short: string;
    yaw?: number;
};
export const HOME: Pad = {
    x: 35, z: 150, y: 0, radius: 8, name: 'Harbor starting grid', short: 'START', yaw: 0
};
export const OLD_TERRACE: Pad = {
    x: 0, z: 84, y: 12, radius: 8, name: 'Launch terrace', short: 'TERRACE'
};
export const PADS: Pad[] = [
    {
        x: 0, z: 12, y: 18, radius: 7.5, name: 'The Glasshouse', short: 'GLASSHOUSE'
    },
    {
        x: -70, z: -58, y: 29, radius: 7.5, name: 'Solis Observatory', short: 'OBSERVATORY'
    },
    {
        x: 70, z: -128, y: 39, radius: 8, name: 'The Highline', short: 'HIGHLINE'
    },
    {
        x: 70, z: 84, y: 22, radius: 8, name: 'Harbor Club', short: 'HARBOR CLUB'
    },
];
export function nearestRoad(p: {
    x: number;
    z: number;
}): Pad {
    const x = Math.max(-175, Math.min(175, p.x)), z = Math.max(-250, Math.min(150, p.z));
    const roadX = [-175, -105, -35, 35, 105, 175].reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
    const roadZ = [-233, -163, -93, -23, 48, 119].reduce((a, b) => Math.abs(b - z) < Math.abs(a - z) ? b : a);
    const vertical = Math.abs(roadX - x) <= Math.abs(roadZ - z);
    return {
        x: vertical ? roadX : x, z: vertical ? z : roadZ, y: 0, yaw: vertical ? 0 : Math.PI / 2, radius: 5, name: 'Nearby road', short: 'ROAD'
    };
}
export class Flight {
    buildColliders = true;
    groundRechargeRate = 20;
    energyDrainScale = 1;
    world: RAPIER.World;
    body: RAPIER.RigidBody;
    vehicle: RAPIER.DynamicRayCastVehicleController;
    assisted = true;
    unlimitedLift = false;
    yaw = 0;
    throttle = 0;
    manualThrottle = .5;
    thrusts = [0, 0, 0, 0];
    airborne = false;
    grounded = false;
    contacts = 0;
    steerAngle = 0;
    forwardSpeed = 0;
    energy = 100;
    slip = 0;
    landingImpact = 0;
    motor = 0;
    wheelLengths = [.16, .16, .16, .16];
    wheelSpins = [0, 0, 0, 0];
    wheelSteering = [0, 0, 0, 0];
    quaternion = new Quaternion();
    position = new Vector3();
    velocity = new Vector3();
    up = new Vector3(0, 1, 0);
    constructor() {
        this.world = new RAPIER.World({
            x: 0, y: -GRAVITY, z: 0
        });
        this.world.timestep = STEP;
        this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(HOME.x, .59, HOME.z).setLinearDamping(.025).setAngularDamping(.35).setCcdEnabled(true).setCanSleep(false));
        BODY_COLLIDERS.forEach((shape, index) => this.world.createCollider(RAPIER.ColliderDesc.cuboid(shape.half[0], shape.half[1], shape.half[2]).setTranslation(shape.offset[0], shape.offset[1], shape.offset[2])
            .setMass(index === 0 ? MASS : 0).setFriction(.25).setRestitution(index === 0 ? .02 : 0), this.body));
        this.vehicle = this.world.createVehicleController(this.body);
        this.vehicle.indexUpAxis = 1;
        this.vehicle.setIndexForwardAxis = 2;
        for (const p of WHEEL_POINTS) {
            const i = this.vehicle.numWheels();
            this.vehicle.addWheel(p, {
                x: 0, y: -1, z: 0
            }, {
                x: 1, y: 0, z: 0
            }, SUSPENSION_REST, WHEEL_RADIUS);
            this.vehicle.setWheelSuspensionStiffness(i, 40);
            this.vehicle.setWheelSuspensionCompression(i, 4.4);
            this.vehicle.setWheelSuspensionRelaxation(i, 5.2);
            this.vehicle.setWheelMaxSuspensionTravel(i, .16);
            this.vehicle.setWheelMaxSuspensionForce(i, 16000);
            this.vehicle.setWheelFrictionSlip(i, 1.8);
            this.vehicle.setWheelSideFrictionStiffness(i, 1);
        }
        this.sync();
    }
    box(x: number, y: number, z: number, w: number, h: number, d: number) { if (this.buildColliders)
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setFriction(.8)); }
    sync() {
        this.position.copy(this.body.translation());
        this.velocity.copy(this.body.linvel());
        this.quaternion.copy(this.body.rotation());
        this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
        this.forwardSpeed = this.velocity.dot(new Vector3(0, 0, -1).applyQuaternion(this.quaternion));
    }
    reset(pad: Pad = HOME) {
        this.body.setTranslation({
            x: pad.x, y: pad.y + .61, z: pad.z
        }, true);
        this.yaw = pad.yaw ?? 0;
        this.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw), true);
        this.body.setLinvel({
            x: 0, y: 0, z: 0
        }, true);
        this.body.setAngvel({
            x: 0, y: 0, z: 0
        }, true);
        this.body.resetForces(true);
        this.body.resetTorques(true);
        this.airborne = false;
        this.grounded = false;
        this.contacts = 0;
        this.steerAngle = 0;
        this.throttle = 0;
        this.manualThrottle = .5;
        this.energy = 100;
        this.slip = 0;
        this.motor = 0;
        this.landingImpact = 0;
        this.thrusts.fill(0);
        this.sync();
    }
    toggleAssist() { this.assisted = !this.assisted; this.alignYaw(); this.manualThrottle = Math.max(.1, this.throttle); }
    private alignYaw() { const facing = new Vector3(0, 0, -1).applyQuaternion(this.quaternion); this.yaw = Math.atan2(-facing.x, -facing.z); }
    step(input: Input) {
        if (this.unlimitedLift)
            this.energy = 100;
        this.sync();
        this.body.resetForces(false);
        this.body.resetTorques(false);
        this.landingImpact = 0;
        const wasGrounded = this.grounded, preVertical = this.velocity.y, speed = Math.abs(this.forwardSpeed);
        // Steering works through the front tires. There is no artificial yaw motor on the road.
        const maxSteer = .58 / (1 + speed * speed / 140);
        this.steerAngle += ((input.steer ?? 0) * maxSteer - this.steerAngle) * (1 - Math.exp(-STEP * 9));
        const drive = input.drive ?? 0, braking = drive < 0 && this.forwardSpeed > .7 || drive > 0 && this.forwardSpeed < -.7;
        const engine = braking ? 0 : drive > 0 ? MASS * 6.2 * Math.max(0, 1 - speed / 42) : drive < 0 ? -MASS * 3.3 * Math.max(0, 1 - speed / 9) : 0;
        this.motor = Math.abs(engine) / (MASS * 6.2);
        for (let i = 0; i < 4; i++) {
            const rear = i % 2 === 1, hand = !!input.handbrake && rear;
            this.vehicle.setWheelSteering(i, rear ? 0 : this.steerAngle);
            this.vehicle.setWheelEngineForce(i, engine / 4);
            this.vehicle.setWheelBrake(i, braking ? MASS * 11 * STEP / 4 : hand ? MASS * 16 * STEP / 2 : !drive ? MASS * .45 * STEP / 4 : 0);
            this.vehicle.setWheelFrictionSlip(i, hand ? .65 : 1.8);
            this.vehicle.setWheelSideFrictionStiffness(i, hand ? .3 : 1);
        }
        this.vehicle.updateVehicle(STEP, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
        this.contacts = 0;
        for (let i = 0; i < 4; i++) {
            if (this.vehicle.wheelIsInContact(i))
                this.contacts++;
            this.wheelLengths[i] = this.vehicle.wheelSuspensionLength(i) ?? SUSPENSION_REST;
            this.wheelSpins[i] = this.vehicle.wheelRotation(i) ?? 0;
            this.wheelSteering[i] = this.vehicle.wheelSteering(i) ?? 0;
        }
        this.grounded = this.contacts >= 2 && this.up.y > .65;
        if (this.grounded) {
            this.alignYaw();
            this.energy = Math.min(100, this.energy + this.groundRechargeRate * STEP);
            if (!wasGrounded)
                this.landingImpact = Math.max(0, -preVertical);
            // Wheels take over as soon as a descending car touches down; lift can override.
            if (input.lift <= 0) {
                this.airborne = false;
                this.thrusts.fill(0);
            }
        }
        else if (wasGrounded) {
            this.airborne = true;
            this.alignYaw();
        }
        if (input.lift > 0 && this.energy > 1) {
            if (!this.airborne)
                this.alignYaw();
            this.airborne = true;
        }
        const angular = new Vector3().copy(this.body.angvel()), torque = new Vector3();
        let throttle = 0;
        if (this.airborne) {
            if (this.assisted) {
                if (!this.grounded)
                    this.yaw += input.yaw * 1.15 * STEP;
                const target = new Quaternion().setFromEuler(new Euler(input.brake ? 0 : input.pitch * .25, this.yaw, input.brake ? 0 : input.roll * .25, 'YXZ'));
                const error = target.multiply(this.quaternion.clone().invert());
                if (error.w < 0)
                    error.set(-error.x, -error.y, -error.z, -error.w);
                const acc = new Vector3(error.x, error.y, error.z).multiplyScalar(26).addScaledVector(angular, -6.6);
                torque.copy(acc).applyQuaternion(this.quaternion.clone().invert()).multiply(new Vector3(2200, 2500, 520)).applyQuaternion(this.quaternion);
                const desired = input.verticalSpeed === undefined ? (input.lift > 0 ? 8 : input.lift < 0 ? -4.5 : 0) : Math.max(-4.5, Math.min(8, input.verticalSpeed));
                const acceleration = Math.max(-5, Math.min(7.5, (desired - this.velocity.y) * 2.2));
                throttle = (GRAVITY + acceleration) / (2 * GRAVITY * Math.max(.55, this.up.y));
                if (this.energy > .01) {
                    if (input.brake) {
                        const force = new Vector3(-this.velocity.x, 0, -this.velocity.z).multiplyScalar(MASS * 1.3).clampLength(0, MASS * 8);
                        this.body.addForce(force, true);
                    }
                    // Gimballed side thrust gives aerial steering a car-like response, while
                    // retaining forward momentum. This is bounded assistance, not velocity snapping.
                    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
                    const lateral = Math.max(-4.5, Math.min(4.5, -this.velocity.dot(right) * 1.35));
                    this.body.addForce(right.multiplyScalar(MASS * lateral), true);
                }
            }
            else {
                this.alignYaw();
                this.manualThrottle = Math.max(0, Math.min(1, this.manualThrottle + input.lift * .32 * STEP));
                throttle = this.manualThrottle;
                torque.set(input.pitch * 6500, input.yaw * 3000, input.roll * 1700).applyQuaternion(this.quaternion);
            }
            throttle *= Math.min(1, this.energy / 8);
            if (!this.unlimitedLift)
                this.energy = Math.max(0, this.energy - Math.max(.2, throttle) * 5 * STEP * this.energyDrainScale);
        }
        this.throttle = Math.max(0, Math.min(1, throttle));
        const localTorque = torque.clone().applyQuaternion(this.quaternion.clone().invert());
        for (let i = 0; i < 4; i++) {
            const p = THRUST_POINTS[i], base = this.throttle * MASS * GRAVITY / 2;
            const mix = -localTorque.x * p.z / (4 * 1.55 ** 2) + localTorque.z * p.x / (4 * 1.02 ** 2);
            const f = this.airborne && this.energy > .01 ? Math.max(0, Math.min(MASS * GRAVITY / 2, base + mix)) : 0;
            this.thrusts[i] = f / (MASS * GRAVITY / 2);
            this.body.addForceAtPoint(this.up.clone().multiplyScalar(f), p.clone().applyQuaternion(this.quaternion).add(this.position), true);
        }
        if (this.airborne && this.energy > .01)
            this.body.addTorque(new Vector3(0, localTorque.y, 0).applyQuaternion(this.quaternion), true);
        this.slip = this.grounded ? Math.abs(this.velocity.dot(new Vector3(1, 0, 0).applyQuaternion(this.quaternion))) : 0;
        this.body.addForce(this.velocity.clone().multiplyScalar(-MASS * .0018 * this.velocity.length()), true);
        this.world.step();
        this.sync();
    }
}
