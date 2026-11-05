import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : ['.ts', '.py', '.json', '.css'].includes(extname(path)) ? [path.replaceAll('\\', '/')] : [];
});
const paths = [...['server', 'shared', 'src', 'python_agent/vector_agent', 'config'].flatMap(walk), 'index.html', 'package.json'].sort();
const hash = createHash('sha256');
for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
}
export const sourceIdentity = hash.digest('hex');
