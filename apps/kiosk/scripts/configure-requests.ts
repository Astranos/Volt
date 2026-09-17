import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit deployment required. Never prints or places credentials in argv.
const [deployment, deploymentUrl, filename = '.env.local'] = process.argv.slice(2);
if (!deployment || !/^[a-z0-9-]+$/.test(deployment) || !deploymentUrl || !/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(deploymentUrl)) {
  throw new Error('Usage: node scripts/configure-requests.ts DEPLOYMENT https://DEPLOYMENT.convex.cloud [.env.local]');
}
if (!/^\.env\.[a-z.]+$/.test(filename)) throw new Error('Use an ignored .env.local or .env.production.local file');
const app = fileURLToPath(new URL('../', import.meta.url));
const cwd = resolve(app, '../..');
const lookup = spawnSync('pnpm', ['exec', 'convex', 'env', 'get', 'KIOSK_REQUEST_SECRET', '--deployment', deployment], { cwd, encoding: 'utf8' });
let secret = lookup.stdout.trim();
if (lookup.status !== 0 && !/not (?:set|found)|does not exist/i.test(lookup.stderr)) throw new Error('Could not read the selected deployment configuration');
if (secret && !/^[A-Za-z0-9_-]{32,}$/.test(secret)) throw new Error('Unexpected credential format; refusing to replace it');
if (!secret) {
  secret = randomBytes(32).toString('base64url');
  const result = spawnSync('pnpm', ['exec', 'convex', 'env', 'set', 'KIOSK_REQUEST_SECRET', '--deployment', deployment], { cwd, input: secret, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not configure the selected deployment');
}
const path = resolve(app, filename);
let previous = '';
try { previous = await readFile(path, 'utf8'); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}
const retained = previous.split('\n').filter(line => !/^(?:KIOSK_CONVEX_URL|KIOSK_REQUEST_SECRET)=/.test(line)).join('\n').trimEnd();
await writeFile(path, `${retained}${retained ? '\n' : ''}KIOSK_CONVEX_URL=${deploymentUrl}\nKIOSK_REQUEST_SECRET=${secret}\n`, { mode: 0o600 });
await chmod(path, 0o600);
process.stdout.write(`Configured requests for ${deployment}. Server-only configuration saved to ${path}.\n`);
