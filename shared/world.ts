import { HOME, PADS, OLD_TERRACE, type Flight } from '../src/flight';
export { HOME };
export const RELAYS = PADS.slice(0, 3).map((p, i) => ({
    ...p, id: `relay-${i + 1}`, name: ['Glasshouse relay', 'Observatory relay', 'Highline relay'][i]
}));
export const CHARGER = {
    id: 'charger', x: -175, y: 0, z: 48, radius: 7, name: 'Waterfront charging station'
};
export const DEPOT = {
    ...HOME, id: 'depot', name: 'Harbor depot'
};
export const TARGETS = [...RELAYS, CHARGER, DEPOT];
let seed = 731;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
export const BUILDINGS = [-140, -70, 0, 70, 140].flatMap(x => [-198, -128, -58, 12, 84].map(z => { const pad = [OLD_TERRACE, ...PADS].find(p => p.x === x && p.z === z); return {
    x, z, h: pad?.y ?? 12 + rand() * 39, w: pad ? 38 : 20 + rand() * 15, d: pad ? 38 : 24 + rand() * 13
}; }));
export const PARKED = Array.from({ length: 30 }, (_, i) => ({ x: [-175, -105, -35, 35, 105, 175][i % 6] + (i % 2 ? 8.2 : -8.2), z: -240 + rand() * 380 })).filter(p => ![-233, -163, -93, -23, 48, 119].some(z => Math.abs(z - p.z) < 15));
export function closureFor(seed: number) { return seed % 2 ? {
    x: 35, z: 70, w: 19, d: 3
} : {
    x: -35, z: -5, w: 19, d: 3
}; }
type Point3 = [
    number,
    number,
    number
];
export function districtCollisionBoxes(seed: number) {
    const boxes: {
        kind: string;
        center: Point3;
        size: Point3;
    }[] = [{
            kind: 'ground', center: [0, -1, -56], size: [380, 2, 450]
        }];
    for (const b of BUILDINGS)
        boxes.push({
            kind: 'foundation', center: [b.x, .2, b.z], size: [47, .4, 47]
        }, {
            kind: 'building', center: [b.x, b.h / 2, b.z], size: [b.w, b.h, b.d]
        });
    for (const p of PARKED)
        boxes.push({
            kind: 'parked vehicle', center: [p.x, .7, p.z], size: [1.8, 1.2, 4]
        });
    const c = closureFor(seed);
    boxes.push({
        kind: 'closure', center: [c.x, 1, c.z], size: [c.w, 2, c.d]
    });
    return boxes;
}
export function collisionGeometry(seed: number) {
    return districtCollisionBoxes(seed).map(b => ({
        kind: b.kind, min: b.center.map((v, i) => v - b.size[i] / 2), max: b.center.map((v, i) => v + b.size[i] / 2)
    }));
}
export function addDistrictCollision(f: Flight, seed: number) { for (const b of districtCollisionBoxes(seed))
    f.box(...b.center, ...b.size); }
export const ROAD_X = [-175, -105, -35, 35, 105, 175], ROAD_Z = [-233, -163, -93, -23, 48, 119, 150];
