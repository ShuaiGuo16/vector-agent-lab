// Static presentation server. No env file, Python worker, agent bridge or model APIs.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { sourceIdentity } from './identity';

const { values } = parseArgs({ options: {
  port: { type: 'string', default: '5176' },
  'replay-data': { type: 'string' },
  replay: { type: 'boolean', default: false },
} });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const trace = values['replay-data'] ? JSON.parse(readFileSync(resolve(values['replay-data']), 'utf8')) : null;
const app = Fastify({ logger: false });
app.get('/api/health', async () => ({ ok: true, app: values.replay ? 'VECTOR Replay' : 'VECTOR Game', sourceIdentity, traceRunId: trace?.runId ?? null }));
if (trace) app.get('/replay-trace.json', async () => trace);
if (values.replay) app.get('/', async (_request, reply) => reply.redirect('/demo/replay.html'));
await app.register(fastifyStatic, { root: resolve('dist'), index: 'index.html', list: false, dotfiles: 'deny' });
await app.listen({ host: '127.0.0.1', port });
console.log(`VECTOR ${values.replay ? 'Replay' : 'Game'}: http://127.0.0.1:${port}/`);
process.on('SIGINT', () => { void app.close().then(() => process.exit()); });
