import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { config } from './config';
import { ClientMessage } from '../shared/protocol';
import { bridgePython } from './python-bridge';
import { sourceIdentity } from './identity';
const app = Fastify({ logger: false, bodyLimit: 65536 });
const root = resolve('.'), port = config.PORT;
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
app.addHook('onRequest', async (req, reply) => { if (req.headers.origin && !origins.has(req.headers.origin)) {
    reply.code(403);
    return { error: 'Local lab origin required' };
} });
app.get('/api/config', async () => {
    const response = await fetch(`http://127.0.0.1:${config.PYTHON_AGENT_PORT}/health`);
    return (await response.json() as {
        config: unknown;
    }).config;
});
app.get('/api/health', async () => ({
    ok: true, app: 'VECTOR Agent Lab', agentBackend: 'python', sourceIdentity
}));
app.get<{
    Params: {
        id: string;
    };
}>('/api/runs/:id', async (req, reply) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(req.params.id))
    return reply.code(400).send({ error: 'Invalid run ID' }); const path = join(root, 'runs', `${req.params.id}.summary.json`); if (!existsSync(path))
    return reply.code(404).send({ error: 'Run is not finished' }); reply.header('Content-Disposition', `attachment; filename="${req.params.id}.summary.json"`); return JSON.parse(readFileSync(path, 'utf8')); });
// The agent transport has no browser application. Use server/game.ts for manual play.
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
app.server.on('upgrade', (req, socket, head) => { if (req.url !== '/agent')
    return; if (!req.headers.origin || !origins.has(req.headers.origin)) {
    socket.destroy();
    return;
} wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)); });
wss.on('connection', (socket: WebSocket) => bridgePython(socket, config));
await app.listen({ host: '127.0.0.1', port });
console.log(`VECTOR Agent Lab: http://127.0.0.1:${port}/`);
process.on('SIGINT', () => { for (const client of wss.clients)
    client.close(1001, 'Server stopped'); wss.close(); void app.close().then(() => process.exit()); });
