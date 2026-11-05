import { ServerMessageSchema, type PublicAgentConfig } from '../shared/server-messages';
import { canAcceptAction, isActionCurrent, type RemoteAction } from '../shared/remote-actions';
// Real-time agent client: shares the manual game's physics, without a browser UI.
// No baseline action selection. Intended for repeatable unattended experiments.
import RAPIER from '@dimforge/rapier3d-compat';
import WebSocket from 'ws';
import { once } from 'node:events';
import { Simulation } from '../shared/simulation';
import { STEP } from '../src/flight';
import { PlanSchema } from '../shared/protocol';
import { config } from '../server/config';
import { randomUUID } from 'node:crypto';
await RAPIER.init();
const sim = new Simulation(Number(process.argv[2] || 7));
const id = `live-${randomUUID()}`;
const socket = new WebSocket(`ws://127.0.0.1:${config.PORT}/agent`, { origin: `http://127.0.0.1:${config.PORT}` });
let activeConfig: PublicAgentConfig;
let helloResolve: () => void;
const helloReady = new Promise<void>(resolve => { helloResolve = resolve; });
let started = false, finished = false, latestSeq = -1, last = performance.now(), acc = 0, tick: any, heartbeat: any, remote: RemoteAction | undefined;
const send = (data: unknown) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(data));
const observe = () => send({ type: 'observation', data: sim.observe(id) });
function actionState() { return {
    runId: id, planVersion: sim.navigator.version, legIndex: sim.navigator.index, objectiveKey: sim.objectiveKey
}; }
function clean() { process.stdin.pause(); clearInterval(tick); clearInterval(heartbeat); socket.close(); sim.dispose(); }
socket.on('message', raw => {
    let m;
    try {
        m = ServerMessageSchema.parse(JSON.parse(String(raw)));
    }
    catch (error) {
        console.error(error);
        send({ type: 'stop', reason: 'invalid_server_message' });
        sim.mission.fail('Invalid agent message');
        return;
    }
    try {
        if (m.type === 'hello') {
            activeConfig = m.config;
            helloResolve();
        }
        if (m.type === 'started') {
            started = true;
            sim.startAgentSetup(m.reviewSchedule);
            last = performance.now();
            console.log(JSON.stringify({ runId: id, event: 'started' }));
            observe();
        }
        if (m.type === 'plan') {
            const previousProgress = {
                legIndex: sim.navigator.index, waypointIndex: 0, stage: sim.navigator.stage
            };
            const progressPreserved = sim.applyAgentPlan(PlanSchema.parse(m.plan), m.version);
            remote = undefined;
            const appliedProgress = {
                legIndex: sim.navigator.index, waypointIndex: 0, stage: sim.navigator.stage
            };
            console.log(JSON.stringify({
                event: 'plan', time: sim.time, progressPreserved, previousProgress, appliedProgress, plan: m.plan
            }));
        }
        if (m.type === 'action' && canAcceptAction(m, actionState(), latestSeq, activeConfig.maxActionAge)) {
            latestSeq = m.seq;
            remote = m;
        }
        if (m.type === 'agent_status' && !String(m.state).includes('Expired'))
            console.log(JSON.stringify({
                event: 'status', time: sim.time, state: m.state
            }));
        if (m.type === 'error') {
            console.error(JSON.stringify({ event: 'error', message: m.message }));
            send({ type: 'stop', reason: 'client_error' });
            if (!started) {
                finished = true;
                clean();
                process.exitCode = 1;
            }
        }
        if (m.type === 'finished') {
            finished = true;
            console.log(JSON.stringify({
                event: 'finished', runId: id, reason: sim.mission.reason, summary: m.summary
            }));
            clean();
        }
    }
    catch (error) {
        console.error(error);
        send({
            type: 'event', runId: id, name: 'implementation_error', data: { where: 'headless client', message: error instanceof Error ? error.message : String(error) }
        });
        sim.mission.fail('Headless implementation error');
    }
});
await once(socket, 'open');
await helloReady;
send({
    type: 'start', runId: id, mode: 'openrouter', seed: sim.seed, decisionModel: activeConfig!.decisionModel
});
let lastReport = -5;
tick = setInterval(() => {
    if (!started || finished)
        return;
    const now = performance.now();
    acc += Math.min((now - last) / 1000, .1);
    last = now;
    while (acc >= STEP && sim.mission.status === 'running') {
        acc -= STEP;
        const valid = isActionCurrent(remote, actionState());
        sim.fallback = !valid;
        sim.step('openrouter', valid ? remote!.action : 'hold', undefined, valid ? remote!.objectiveKey : undefined);
    }
    if (sim.time - lastReport >= 5) {
        lastReport = sim.time;
        console.log(JSON.stringify({
            event: 'progress', wallSeconds: Math.round(sim.time), time: Math.round(sim.mission.elapsed), setupPending: sim.setupPending, target: sim.navigator.target.id, stage: sim.navigator.stage, action: sim.lastAction, position: sim.flight.position.toArray().map(v => Math.round(v * 10) / 10), energy: Math.round(sim.flight.energy), completed: sim.mission.completed
        }));
    }
    if (sim.mission.status !== 'running')
        observe();
}, 8);
heartbeat = setInterval(observe, 100);
socket.on('close', () => { if (!finished) {
    finished = true;
    console.error('Disconnected before run completion');
    clean();
    process.exitCode = 1;
} });
process.on('SIGINT', () => { send({ type: 'stop', reason: 'experiment stopped' }); });
process.stdin.on('data', chunk => { if (String(chunk).trim() === 'stop')
    send({ type: 'stop', reason: 'diagnostic stop requested' }); });
