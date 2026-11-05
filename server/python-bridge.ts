import { ZodError } from 'zod';
import { ServerMessageSchema } from '../shared/server-messages';
import { WebSocket } from 'ws';
import { ClientMessage, type Plan } from '../shared/protocol';
import { actuatorCommands } from './prompts';
import type { Config } from './config';
// Transport and exact engine measurements only. No agent scheduling or selection.
export function bridgePython(client: WebSocket, config: Config) {
    const upstream = new WebSocket(`ws://127.0.0.1:${config.PYTHON_AGENT_PORT}/agent`, { origin: `http://127.0.0.1:${config.PORT}`, maxPayload: 1048576 });
    let plan: Plan | undefined, version = 0, closed = false, runId: string | undefined;
    const queued: string[] = [];
    const send = (value: unknown) => { if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(value)); };
    const fail = (error: unknown) => {
        console.error(error);
        const detail = { where: 'engine bridge', message: error instanceof Error ? error.message : String(error) };
        if (runId && upstream.readyState === WebSocket.OPEN)
            upstream.send(JSON.stringify({
                type: 'event', runId, name: 'implementation_error', data: detail
            }));
        send({
            type: 'error', kind: 'implementation_error', message: detail.message
        });
        client.close(1011, 'Bridge implementation error');
    };
    client.on('message', raw => {
        let msg;
        try {
            msg = ClientMessage.parse(JSON.parse(String(raw)));
        }
        catch (error) {
            if (error instanceof ZodError || error instanceof SyntaxError) {
                send({
                    type: 'error', kind: 'validation_error', message: 'Invalid game message'
                });
                return;
            }
            fail(error);
            return;
        }
        try {
            if (msg.type === 'start') {
                plan = undefined;
                version = 0;
                runId = msg.runId;
            }
            const packet = msg.type === 'observation' ? { ...msg, facts: {
                    actuatorCommandsAtThisState: plan && msg.data.planVersion === version ? actuatorCommands(msg.data, plan) : null
                } } : msg;
            const data = JSON.stringify(packet);
            if (upstream.readyState === WebSocket.OPEN)
                upstream.send(data);
            else if (upstream.readyState === WebSocket.CONNECTING && queued.length < 32)
                queued.push(data);
            else {
                send({ type: 'error', message: 'Python agent is unavailable' });
                client.close(1011, 'Agent unavailable');
            }
        }
        catch (error) {
            fail(error);
        }
    });
    upstream.on('open', () => { for (const data of queued)
        upstream.send(data); queued.length = 0; });
    upstream.on('message', raw => {
        let msg;
        try {
            msg = ServerMessageSchema.parse(JSON.parse(String(raw)));
        }
        catch (error) {
            if (error instanceof ZodError || error instanceof SyntaxError) {
                send({
                    type: 'error', kind: 'validation_error', message: 'Invalid Python agent response'
                });
                client.close(1011, 'Invalid agent response');
                return;
            }
            fail(error);
            return;
        }
        if (msg.type === 'plan') {
            plan = msg.plan;
            version = msg.version;
        }
        send(msg);
    });
    upstream.on('error', () => { send({ type: 'error', message: 'Python agent unavailable. Start scripts/launch-python.ps1.' }); });
    upstream.on('close', () => { if (!closed) {
        closed = true;
        send({ type: 'error', message: 'Python agent disconnected; run stopped' });
        client.close(1011, runId ? 'Agent disconnected during run' : 'Agent unavailable');
    } });
    client.on('close', () => { closed = true; upstream.close(); });
    client.on('error', () => upstream.close());
}
