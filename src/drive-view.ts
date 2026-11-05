import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { City } from './city';
import { Flight, HOME } from './flight';
import { TARGETS, closureFor } from '../shared/world';

/** The same car, district, markers and camera for play and offline replay. */
export class DriveView {
  readonly city: City;
  wide = false;
  private look = new THREE.Vector3();
  private markers = new Map<string, THREE.Mesh>();
  private closure = new THREE.Group();

  constructor(canvas: HTMLCanvasElement, flight: Flight, seed: number) {
    const buildColliders = flight.buildColliders;
    flight.buildColliders = false;
    try { this.city = new City(canvas, flight); }
    finally { flight.buildColliders = buildColliders; }
    for (const target of TARGETS) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(target.radius - .3, target.radius, 64),
        new THREE.MeshBasicMaterial({ color: target.id === 'charger' ? 0x9ee6cd : 0xf6bb7b, transparent: true, opacity: .75, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(target.x, target.y + .25, target.z);
      this.city.scene.add(ring);
      this.markers.set(target.id, ring);
      const signCanvas = document.createElement('canvas');
      signCanvas.width = 256; signCanvas.height = 80;
      const context = signCanvas.getContext('2d')!;
      context.fillStyle = '#132e37'; context.fillRect(0, 0, 256, 80);
      context.fillStyle = '#b9f3d7'; context.font = 'bold 30px Arial'; context.textAlign = 'center';
      context.fillText(target.id === 'charger' ? 'CHARGE' : target.id === 'depot' ? 'DEPOT' : `RELAY ${target.id.at(-1)}`, 128, 50);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signCanvas), side: THREE.DoubleSide }));
      sign.position.set(target.x, target.y + 3, target.z - target.radius - 2);
      this.city.scene.add(sign);
    }
    this.setSeed(seed);
    const departure = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.2), new THREE.MeshBasicMaterial({ color: 0x9ee6cd, transparent: true, opacity: .75 }));
    departure.rotation.x = -Math.PI / 2; departure.position.set(35, .18, 119); this.city.scene.add(departure);
  }

  setSeed(seed: number) {
    this.city.scene.remove(this.closure);
    this.closure.traverse(object => {
      if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
    });
    this.closure = new THREE.Group();
    const closure = closureFor(seed);
    for (let i = 0; i < 6; i++) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(closure.w / 6, 2, closure.d), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x263c45 : 0xf2b574 }));
      barrier.position.set(closure.x - closure.w / 2 + (i + .5) * closure.w / 6, 1, closure.z);
      this.closure.add(barrier);
    }
    this.city.scene.add(this.closure);
  }

  snap(flight: Flight) {
    this.city.camera.position.copy(flight.position).add(new THREE.Vector3(0, 5, 12).applyAxisAngle(THREE.Object3D.DEFAULT_UP, flight.yaw));
    this.look.copy(flight.position).add(new THREE.Vector3(0, .6, -4).applyAxisAngle(THREE.Object3D.DEFAULT_UP, flight.yaw));
    this.city.camera.lookAt(this.look);
  }

  render(flight: Flight, dt: number, completed: readonly string[], preview = false) {
    this.city.update(flight, dt);
    for (const [id, ring] of this.markers) {
      if (id.startsWith('relay')) (ring.material as THREE.MeshBasicMaterial).color.set(completed.includes(id) ? 0x95f2c2 : 0xf2b471);
    }
    if (preview) {
      this.city.camera.position.set(HOME.x + 7, 3.8, HOME.z + 10);
      this.city.camera.lookAt(HOME.x - 2, .7, HOME.z - 3);
    } else {
      const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, flight.yaw);
      const goal = flight.position.clone().add(new THREE.Vector3(0, this.wide ? 11 : flight.grounded ? 3.5 : 5.8, this.wide ? 24 : 11.5).applyQuaternion(rotation));
      const start = flight.position.clone().add(new THREE.Vector3(0, .9, 0));
      const ray = goal.clone().sub(start); const distance = ray.length(); ray.normalize();
      const hit = flight.world.castRay(new RAPIER.Ray(start, ray), distance, true, undefined, undefined, undefined, flight.body);
      if (hit) goal.copy(start).addScaledVector(ray, Math.max(.7, hit.timeOfImpact - .4));
      this.city.camera.position.lerp(goal, 1 - Math.exp(-dt * 6));
      this.look.lerp(flight.position.clone().add(new THREE.Vector3(0, .7, -4).applyQuaternion(rotation)), 1 - Math.exp(-dt * 7));
      this.city.camera.lookAt(this.look);
    }
    this.city.render();
  }
}
