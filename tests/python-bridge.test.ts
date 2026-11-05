import { ACTION_MECHANICS } from '../shared/action-mechanics';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { MODEL_ACTIONS, type Observation } from '../shared/protocol';
import { GOAL_PLANNER_INSTRUCTIONS } from '../server/goal-prompts';
const goal = {
    id: "roof", kind: "relay" as const, target: "relay-1" as const, position: null, speed: 8, guidance: [], reviewAfter: false
};
const python = join(process.cwd(), '.venv', 'Scripts', 'python.exe');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function freePort() { const s = createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); const p = (s.address() as any).port; await new Promise<void>(r => s.close(() => r())); return p; }
async function kill(child: ChildProcess | undefined) { if (!child || child.exitCode !== null)
    return; const ended = once(child, 'exit'); child.kill(); await ended; }
test('Python backend bridges the unchanged game protocol, exact context, ownership and manual takeover', { timeout: 30000, skip: !existsSync(python) && 'Install python_agent first' }, async () => {
    const requests: {
        path: string;
        body: any;
    }[] = [];
    let responseAttempts = 0;
    const mock = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req)
            raw += chunk;
        const body = JSON.parse(raw);
        requests.push({ path: req.url!, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/v1/responses') {
            if (++responseAttempts === 1) {
                res.setHeader('content-type', 'text/event-stream');
                res.write('data: ' + JSON.stringify({ type: 'response.created', response: { id: 'mock_stall' } }) + '\n\n');
                return;
            }
            res.setHeader('content-type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'mock_stream' } })}\n\n`);
            res.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
                    status: 'completed', model: body.model, output_text: JSON.stringify({ disposition: "revise", goals: [goal] }), usage: { input_tokens: 12, output_tokens: 8 }
                } })}\n\n`);
        }
        else
            res.end(JSON.stringify({
                model: body.model, answers: { maneuver: {
                        type: 'choice', choice: 'climb', confidence: 1, probabilities: Object.fromEntries(MODEL_ACTIONS.map(a => [a, a === 'climb' ? 1 : 0]))
                    } }, usage: { input_tokens: 5, output_tokens: 1 }
            }));
    });
    await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
    const port = await freePort(), agentPort = await freePort();
    const env = {
        ...process.env, MODEL_PROVIDER: 'openrouter', DECISION_PROVIDER: 'inherit', PLANNER_TIMEOUT_MS: '1000', API_RETRY_DELAY_MS: '0', MAX_TRANSIENT_RETRIES: '1', PORT: String(port), PYTHON_AGENT_PORT: String(agentPort), AGENT_BACKEND: 'python', OPENROUTER_API_KEY: 'test-only-no-real-key', OPENROUTER_BASE_URL: `http://127.0.0.1:${(mock.address() as any).port}/api`, DECISION_INTERVAL_MS: '100'
    };
    let worker: ChildProcess | undefined, game: ChildProcess | undefined, socket: WebSocket | undefined, other: WebSocket | undefined;
    let output = '';
    const watch = (c: ChildProcess) => { c.stdout?.on('data', b => output += b); c.stderr?.on('data', b => output += b); return c; };
    const until = async (predicate: () => boolean, label: string) => { const end = Date.now() + 12000; while (!predicate() && Date.now() < end)
        await sleep(10); assert.ok(predicate(), `${label}: ${output}`); };
    try {
        worker = watch(spawn(python, ['-m', 'vector_agent.server'], {
            cwd: process.cwd(), env, windowsHide: true
        }));
        game = watch(spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
            cwd: process.cwd(), env, windowsHide: true
        }));
        await until(() => output.includes('VECTOR Python Agent:') && output.includes('VECTOR Agent Lab:'), 'Both servers start');
        assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json() as any).agentBackend, 'python');
        const messages: any[] = [];
        socket = new WebSocket(`ws://127.0.0.1:${port}/agent`, { origin: `http://127.0.0.1:${port}` });
        socket.on('message', raw => messages.push(JSON.parse(String(raw))));
        await once(socket, 'open');
        await until(() => messages.some(m => m.type === 'hello'), 'Python hello');
        assert.equal(messages[0].config.agentBackend, 'python');
        assert.ok(!JSON.stringify(messages).includes('test-only-no-real-key'));
        const runId = `test-python-${randomUUID()}`;
        const start = {
            type: 'start', runId, mode: 'openrouter', seed: 7, decisionModel: 'typesafe/jev-1.14'
        };
        socket.send(JSON.stringify(start));
        await until(() => messages.some(m => m.type === 'started'), 'Started');
        const observation: Observation = {
            flightThrottle: .52, nozzleThrustLevels: [.5, .51, .52, .53], runId, seq: 1, simTime: 0, observedAt: Date.now(), position: [35, .6, 150], velocity: [0, 0, 0], yaw: 0, grounded: true, energy: 100, speed: 0, headingError: 0, distance: 31, heightAboveTarget: -18, cruiseAltitude: 68, target: 'relay-1', targetPosition: [0, 18, 12], departureComplete: false, roadTravelPending: false, stage: 'departure', completed: [], status: 'running', seed: 7, interventions: 0, collisions: 0, staleSeconds: 0, planVersion: 0, legIndex: 0, paused: false
        };
        socket.send(JSON.stringify({ type: 'observation', data: observation }));
        let observationSeq = 1;
        const heartbeat = setInterval(() => socket?.send(JSON.stringify({ type: 'observation', data: {
                ...observation, seq: ++observationSeq, observedAt: Date.now()
            } })), 100);
        try {
            await until(() => messages.some(m => m.type === 'plan'), 'Fresh plan after full first-attempt timeout');
        }
        finally {
            clearInterval(heartbeat);
        }
        const plan = messages.find(m => m.type === 'plan');
        assert.equal(plan.version, 1);
        const current = {
            ...observation, goal, completedGoalIds: [], goalLedger: [], seq: ++observationSeq, planVersion: 1, observedAt: Date.now()
        };
        socket.send(JSON.stringify({ type: 'observation', data: current }));
        await until(() => messages.some(m => m.type === 'action'), 'Action');
        const action = messages.find(m => m.type === 'action');
        assert.equal(action.action, 'climb');
        assert.ok(action.validUntil > Date.now());
        const route = requests.find(r => r.path === '/api/v1/responses')!.body;
        assert.equal(route.instructions, GOAL_PLANNER_INSTRUCTIONS);
        assert.equal(route.stream, true);
        assert.equal(route.text.format.type, 'json_schema');
        assert.equal(route.text.format.strict, true);
        const context = JSON.parse(route.input);
        assert.equal(context.setupTiming.elapsedExecutionSeconds, 0);
        assert.equal(context.review.installedPlan, null);
        assert.ok(context.map.geometry.solids.length > 50);
        const decision = requests.find(r => r.path === '/api/alpha/decisions')!.body;
        assert.equal(decision.state.liveState.currentGoal.id, 'roof');
        assert.equal(decision.state.liveState.currentGoal.position[1], 18.6);
        assert.deepEqual(Object.keys(decision.questions.maneuver.criteria), MODEL_ACTIONS);
        assert.equal(action.continuity, 'goal');
        const otherMessages: any[] = [];
        other = new WebSocket(`ws://127.0.0.1:${port}/agent`, { origin: `http://127.0.0.1:${port}` });
        other.on('message', raw => otherMessages.push(JSON.parse(String(raw))));
        await once(other, 'open');
        other.send(JSON.stringify({ ...start, runId: `test-python-other-${randomUUID()}` }));
        await until(() => otherMessages.some(m => m.type === 'error'), 'Exclusive owner');
        assert.match(otherMessages.find(m => m.type === 'error').message, /Another tab owns/);
        socket.send(JSON.stringify({
            type: 'event', runId, name: 'manual_takeover', data: {}
        }));
        await until(() => messages.some(m => m.type === 'agent_status' && m.state.startsWith('Manual takeover')), 'Takeover');
        socket.send(JSON.stringify({ type: 'observation', data: {
                ...current, seq: ++observationSeq, observedAt: Date.now()
            } }));
        socket.send(JSON.stringify({ type: 'stop', reason: 'mock integration complete' }));
        await until(() => messages.some(m => m.type === 'finished'), 'Finished');
        const summary = await (await fetch(`http://127.0.0.1:${port}/api/runs/${runId}`)).json() as any;
        assert.equal(summary.retryAttempts, 1);
        assert.equal(summary.agentBackend, 'python');
        assert.equal(summary.final.flightThrottle, .52);
        assert.deepEqual(summary.final.nozzleThrustLevels, [.5, .51, .52, .53]);
        assert.equal(summary.calls, 3);
        assert.equal(summary.inputTokens, 17);
        assert.equal(summary.outputTokens, 9);
        assert.equal(requests.length, 3);
    }
    finally {
        socket?.terminate();
        other?.terminate();
        await kill(game);
        await kill(worker);
        mock.closeAllConnections();
        await new Promise<void>(r => mock.close(() => r()));
    }
});
