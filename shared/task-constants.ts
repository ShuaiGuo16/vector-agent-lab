// Mechanics and task predicates only. No maneuver-selection rules.
export const TASK_CONSTANTS = {
    standingHeight: .6, flightSettleOffset: .04, stationSpeed: .75,
    stationHeightTolerance: 1, stationRadiusInset: 2, dwellSeconds: 2.5, landingImpact: 4.5,
    transitRadius: 2, chargeRate: 14, chargeComplete: 98, capacity: 100
};
export const BODY_COLLIDERS = [
    { half: [.94, .25, 2.16] as const, offset: [0, -.02, 0] as const },
    { half: [.62, .17, .85] as const, offset: [0, .39, 0] as const }
];
const bound = (sign: number) => [0, 1, 2].map(axis => Math.round((sign < 0 ? Math.min : Math.max)(...BODY_COLLIDERS.map(s => s.offset[axis] + sign * s.half[axis])) * 100) / 100);
export const BODY_COLLISION_ENVELOPE = {
    min: bound(-1), max: bound(1),
    coordinateFrame: 'Vehicle-local xyz; rotate by vehicle orientation and translate by vehicle position'
};
