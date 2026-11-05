import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../shared/simulation';
import { STEP, nearestRoad } from './flight';
import { readControls } from './controls';
import { FlightAudio } from './audio';
import { DriveView } from './drive-view';
import { Dashboard } from './dashboard';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const keys = new Set<string>();
const sound = new FlightAudio();
const dashboard = new Dashboard($('instruments'));
let sim: Simulation, view: DriveView;
let paused = false, begun = false, terminalShown = false, lastCompleted = 0, noticeUntil = 0;
let accumulator = 0;

function notify(message: string) {
  $('notice').textContent = message; $('notice').classList.add('visible'); noticeUntil = performance.now() + 4500;
}
function start() {
  sim.dispose(); sim = new Simulation(7); sim.mission.start();
  begun = true; paused = false; terminalShown = false; lastCompleted = 0; accumulator = 0; keys.clear();
  document.body.classList.add('playing'); $('menu').classList.add('hidden'); $('objective').classList.remove('hidden');
  $('pause').textContent = 'PAUSE'; $<HTMLButtonElement>('pause').disabled = false;
  view.snap(sim.flight); sound.init(); updateHud();
}
function setPaused(value: boolean) {
  if (sim.mission.status !== 'running') return;
  paused = value; keys.clear(); accumulator = 0;
  $('pause').textContent = value ? 'RESUME' : 'PAUSE';
  $('menu').classList.toggle('hidden', !value);
  if (value) {
    $('menu-eyebrow').textContent = 'TAKE A BREATH'; $('menu-title').textContent = 'Paused.';
    $('menu-copy').textContent = 'Your car will be right here.'; $('play').textContent = 'CONTINUE';
    $('restart').classList.remove('hidden');
  }
}
function recover() {
  if (sim.mission.status !== 'running' || paused) return;
  const reserve = sim.flight.energy;
  sim.flight.reset(nearestRoad(sim.flight.position)); sim.flight.energy = reserve; sim.mission.lastImpact = 0;
  keys.clear(); accumulator = 0; view.snap(sim.flight); notify('Back on the road.');
}
function updateHud() {
  const f = sim.flight, mission = sim.mission;
  dashboard.update({ speed: Math.hypot(f.velocity.x, f.velocity.z) * 3.6, reserve: f.energy, altitude: f.position.y,
    thrust: f.throttle, state: paused ? 'PAUSED' : mission.charging ? 'CHARGING' : f.grounded ? 'TIRES DOWN' : 'AIRBORNE' });
  $('progress').textContent = `${mission.completed.length} / 3`;
  $('objective-hint').textContent = !mission.departure ? 'Drive through the green departure line' : mission.completed.length < 3 ? 'Land gently on the marked rooftops' : 'Return to the starting parking area';
  if (mission.completed.length > lastCompleted) {
    lastCompleted = mission.completed.length; sound.chime(); notify(`${lastCompleted} of 3 rooftops restored.`);
  }
  if (performance.now() > noticeUntil) $('notice').classList.remove('visible');
  if (!terminalShown && (mission.status === 'success' || mission.status === 'failed')) {
    terminalShown = true; keys.clear(); $('menu').classList.remove('hidden');
    $('menu-eyebrow').textContent = mission.status === 'success' ? 'RESTORE THE CITY' : 'TRY ANOTHER LINE';
    $('menu-title').textContent = mission.status === 'success' ? 'City restored.' : 'Back to the streets.';
    $('menu-copy').textContent = mission.status === 'success' ? `Three rooftops online. ${Math.round(f.energy)}% thrust reserve remaining.` : mission.reason;
    $('play').textContent = 'DRIVE AGAIN'; $('restart').classList.add('hidden'); $<HTMLButtonElement>('pause').disabled = true;
  }
}
async function boot() {
  await RAPIER.init(); sim = new Simulation(7); view = new DriveView($<HTMLCanvasElement>('world'), sim.flight, sim.seed);
  $('play').textContent = 'START DRIVING'; $<HTMLButtonElement>('play').disabled = false;
  $('play').onclick = () => paused ? setPaused(false) : start(); $('restart').onclick = start;
  $('pause').onclick = () => setPaused(!paused);
  $('camera').onclick = () => { view.wide = !view.wide; $('camera').textContent = view.wide ? 'CHASE VIEW' : 'WIDE VIEW'; $('camera').setAttribute('aria-pressed', String(view.wide)); };
  $('sound').onclick = () => { const enabled = sound.toggle(); $('sound').textContent = enabled ? 'SOUND ON' : 'SOUND OFF'; $('sound').setAttribute('aria-pressed', String(enabled)); };
  const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
  window.addEventListener('keydown', event => {
    if (movement.has(event.code) || event.code === 'Escape') event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Escape') { setPaused(!paused); return; }
    if (event.code === 'KeyC') { $('camera').click(); return; }
    if (event.code === 'KeyR') { recover(); return; }
    if (sim.mission.status === 'running' && !paused && movement.has(event.code)) keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); setPaused(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', () => view.city.resize());
  let previous = performance.now(), hudTime = 0;
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - previous) / 1000, .1); previous = now;
    if (document.hidden) return;
    const running = sim.mission.status === 'running' && !paused;
    if (running) {
      accumulator += dt;
      while (accumulator >= STEP && sim.mission.status === 'running') {
        accumulator -= STEP;
        sim.step('manual', undefined, readControls(keys, true, sim.flight.forwardSpeed, sim.flight.grounded));
      }
    } else accumulator = 0;
    view.render(sim.flight, running ? dt : 0, sim.mission.completed, !begun);
    if (running) view.city.trackPerformance(dt);
    sound.update(sim.flight.throttle, sim.flight.velocity.length(), !running, sim.flight.grounded, sim.flight.motor, sim.flight.slip);
    hudTime += dt; if (hudTime >= .1) { updateHud(); hudTime = 0; }
  }
  updateHud(); requestAnimationFrame(frame);
}
boot().catch(error => { console.error(error); $('play').textContent = 'UNABLE TO START'; $('menu-copy').textContent = error instanceof Error ? error.message : String(error); });
