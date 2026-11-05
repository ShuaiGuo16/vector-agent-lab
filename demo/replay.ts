// Offline visual playback. No Simulation.step(), controller, agent socket or provider call.
import './replay.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Flight } from '../src/flight';
import { DriveView } from '../src/drive-view';
import { Dashboard } from '../src/dashboard';
import { addDistrictCollision } from '../shared/world';
import { frameAt, readTrace, type Trace } from './timeline';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dashboard = new Dashboard($('instruments'));
const position = new THREE.Vector3(), velocity = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), facing = new THREE.Vector3();
let trace: Trace | undefined, flight: Flight, view: DriveView;
let currentTime = 0, playing = false, previous = performance.now(), recording: MediaRecorder | undefined, downloadUrl = '';
let cachedPlan: Trace['plans'][number] | undefined;
const status = (message: string) => { $('status').textContent = message; };
const input = (id: string) => $<HTMLInputElement>(id);
function clip() {
  const from = Number(input('from').value), to = Number(input('to').value);
  if (!trace || !Number.isFinite(from) || !Number.isFinite(to) || from < trace.frames[0].t || to > trace.frames.at(-1)!.t || to <= from) throw new Error('Choose a valid start and end within the recorded run.');
  return { from, to };
}
function controls(enabled: boolean) {
  for (const id of ['file', 'from', 'to', 'fps', 'scrub', 'show-responses']) ($<HTMLInputElement>(id)).disabled = !enabled;
  for (const id of ['play', 'record']) $<HTMLButtonElement>(id).disabled = !enabled || !trace;
}
function stop() {
  playing = false; $('play').textContent = 'PLAY CLIP';
  if (recording?.state === 'recording') recording.stop();
}
function play() {
  const range = clip(); currentTime = range.from; playing = true; previous = performance.now();
  $('play').textContent = 'PAUSE'; draw(0); view.snap(flight); draw(0);
}
function install(value: unknown) {
  stop(); trace = readTrace(value); cachedPlan = undefined;
  // A replay changes pose from measurements, never runs Flight.step().
  flight.world.free(); flight = new Flight(); addDistrictCollision(flight, trace.seed ?? 7);
  view.setSeed(trace.seed ?? 7);
  currentTime = trace.frames[0].t;
  input('from').value = String(currentTime); input('to').value = String(Math.min(trace.frames.at(-1)!.t, currentTime + 30));
  input('scrub').min = String(currentTime); input('scrub').max = String(trace.frames.at(-1)!.t); input('scrub').value = String(currentTime);
  $('planner-model').textContent = trace.summary.planner.replace('openai/', '');
  $('decision-model').textContent = trace.summary.decisionModel.replace('typesafe/', '');
  controls(true); status(`${trace.runId} · ${trace.frames.at(-1)!.t.toFixed(1)} s recorded`);
  view.snap(flight);
}
async function record() {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support video recording.');
  clip();
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser cannot encode WebM.');
  const fps = Number($<HTMLSelectElement>('fps').value);
  const canvas = document.createElement('canvas'); canvas.width = innerWidth; canvas.height = innerHeight;
  const context = canvas.getContext('2d')!;
  const stream = canvas.captureStream(fps);
  const chunks: BlobPart[] = [];
  recording = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
  recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recording.onstop = () => {
    stream.getTracks().forEach(track => track.stop());
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    const link = $<HTMLAnchorElement>('download'); link.href = downloadUrl;
    link.download = `vector-${trace!.runId}-${input('from').value}-${input('to').value}.webm`; link.hidden = false;
    document.body.classList.remove('recording'); $('stop').hidden = true; recording = undefined; controls(true);
    status('Recording ready. Download the clip below.');
  };
  // Capture the scene and the same gauges as the live game, using a clean export canvas.
  capture = () => {
    context.drawImage(view.city.renderer.domElement, 0, 0, canvas.width, canvas.height);
    drawOverlay(context, canvas.width, canvas.height);
  };
  play(); draw(0); capture();
  try { recording.start(); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); recording = undefined; playing = false; throw error; }
  controls(false); $('download').hidden = true; $('stop').hidden = false;
  document.body.classList.add('recording');
}
let capture: (() => void) | undefined;
function drawOverlay(context: CanvasRenderingContext2D, width: number, height: number) {
  if (!trace) return;
  const { a, b, fraction } = frameAt(trace.frames, currentTime);
  const reserve = THREE.MathUtils.lerp(a.energy, b.energy, fraction), altitude = THREE.MathUtils.lerp(a.position[1], b.position[1], fraction);
  const speed = Math.hypot(flight.velocity.x, flight.velocity.z) * 3.6;
  context.save();
  const scale = width < 600 ? .8 : 1;
  context.translate(28, height - 28); context.scale(scale, scale);
  function dial(x: number, radius: number, label: string, value: number, unit: string, max: number) {
    const cy = -radius;
    const start = Math.PI * .75, end = Math.PI * 2.25;
    context.lineWidth = 2; context.strokeStyle = '#718f86'; context.beginPath(); context.arc(x, cy, radius - 3, start, end); context.stroke();
    context.strokeStyle = '#b5f2dc'; context.beginPath(); context.arc(x, cy, radius - 10, start, start + Math.max(0, Math.min(1, value / max)) * Math.PI * 1.5); context.stroke();
    context.textAlign = 'center'; context.shadowColor = '#06141e'; context.shadowBlur = 12;
    context.fillStyle = '#b8d2c7'; context.font = '9px Segoe UI'; context.fillText(label, x, cy - radius * .35);
    context.fillStyle = '#eef8f1'; context.font = `${radius > 60 ? 51 : 26}px Segoe UI`; context.fillText(String(Math.round(value)), x, cy + radius * .24);
    context.font = '9px Segoe UI'; context.fillStyle = '#bacdc3'; context.fillText(unit, x, cy + radius * .55);
  }
  dial(77, 77, a.grounded ? 'TIRES DOWN' : 'AIRBORNE', speed, 'KM / H', 100);
  dial(213, 46, 'RESERVE', reserve, '%', 100); dial(317, 46, 'ALTITUDE', altitude, 'M', 100);
  context.font = '7px Segoe UI'; context.textAlign = 'left'; context.fillStyle = '#b6cac4'; context.fillText('THRUST', 176, -4);
  context.fillStyle = '#4c675e'; context.fillRect(223, -8, 128, 2);
  context.fillStyle = '#b5f2dc'; context.fillRect(223, -8, 128 * Math.max(0, Math.min(1, flight.throttle)), 2);
  context.restore();
  if (input('show-responses').checked) {
    context.save(); const x = Math.max(14, width - 355);
    context.fillStyle = '#0e252be6'; context.fillRect(x, 24, 327, 82);
    context.fillStyle = '#afcabe'; context.font = '10px Segoe UI'; context.fillText($('planner-model').textContent!, x + 14, 48);
    context.fillText($('decision-model').textContent!, x + 14, 85);
    context.textAlign = 'right'; context.fillStyle = '#e1f2e6'; context.font = '11px Segoe UI'; context.fillText($('route').textContent!, width - 44, 48);
    context.font = '17px Segoe UI'; context.fillStyle = '#b5f2dc'; context.fillText(a.action.toUpperCase(), width - 44, 86); context.restore();
  }
}
function draw(dt: number) {
  if (!trace) return;
  const { a, b, fraction } = frameAt(trace.frames, currentTime);
  flight.position.fromArray(a.position).lerp(position.fromArray(b.position), fraction);
  flight.quaternion.copy(q1.fromArray(a.quaternion).slerp(q2.fromArray(b.quaternion), fraction));
  flight.up.set(0, 1, 0).applyQuaternion(flight.quaternion);
  flight.velocity.fromArray(a.velocity).lerp(velocity.fromArray(b.velocity), fraction);
  flight.grounded = a.grounded; flight.energy = THREE.MathUtils.lerp(a.energy, b.energy, fraction);
  facing.set(0, 0, -1).applyQuaternion(flight.quaternion); flight.yaw = Math.atan2(-facing.x, -facing.z);
  // Only older traces lack nozzle measurements. This approximation is visual only.
  const visualPower = a.energy > .01 && (a.action === 'climb' || !a.grounded) ? a.action === 'climb' ? .7 : a.action === 'descend' ? .38 : .52 : 0;
  flight.throttle = a.throttle ?? visualPower; flight.thrusts = a.thrusts ? [...a.thrusts] : [visualPower, visualPower, visualPower, visualPower];
  const plan = trace.plans.filter(plan => plan.t <= currentTime).at(-1);
  if (plan !== cachedPlan) {
    cachedPlan = plan;
    $('planner-model').textContent = (plan?.model ?? trace.summary.planner).replace('openai/', '');
    const names: Record<string, string> = { 'relay-1': 'R1', 'relay-2': 'R2', 'relay-3': 'R3', charger: 'CHARGE', depot: 'DEPOT' };
    $('route').textContent = [...new Set(plan?.targets ?? [])].map(id => names[id] ?? id).join(' › ');
  }
  $('action').textContent = a.action.toUpperCase();
  view.render(flight, dt, a.completedIds ?? []);
  dashboard.update({ speed: Math.hypot(flight.velocity.x, flight.velocity.z) * 3.6, reserve: flight.energy,
    altitude: flight.position.y, thrust: flight.throttle, state: a.grounded ? 'TIRES DOWN' : 'AIRBORNE' });
  input('scrub').value = String(currentTime);
}
async function boot() {
  await RAPIER.init(); flight = new Flight(); view = new DriveView($<HTMLCanvasElement>('scene'), flight, 7);
  $('play').onclick = () => { try { if (playing) stop(); else play(); } catch (error) { status(String(error)); } };
  $('record').onclick = () => { void record().catch(error => { status(String(error)); console.error(error); }); };
  $('stop').onclick = stop;
  input('file').onchange = () => { const file = input('file').files?.[0]; if (file) void file.text().then(text => install(JSON.parse(text))).catch(error => status(String(error))); };
  input('scrub').oninput = () => { stop(); currentTime = Number(input('scrub').value); draw(0); view.snap(flight); };
  input('show-responses').onchange = () => { $('responses').hidden = !input('show-responses').checked; };
  document.addEventListener('keydown', event => { if (event.code === 'Escape') stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stop(); status('Playback stopped because the tab was hidden.'); } });
  window.addEventListener('resize', () => { stop(); view.city.resize(); });
  const response = await fetch('/replay-trace.json');
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) install(await response.json());
  previous = performance.now();
  function frame(time: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((time - previous) / 1000, .1); previous = time;
    if (playing && trace) {
      currentTime = Math.min(clip().to, currentTime + dt);
      draw(dt); if (recording?.state === 'recording') capture?.();
      if (currentTime >= clip().to) stop();
    } else if (trace) draw(0);
    else view.render(flight, 0, [], true);
  }
  requestAnimationFrame(frame);
}
boot().catch(error => { status(String(error)); console.error(error); });
