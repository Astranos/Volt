import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Retain the workspace's exact resolutions when uploading only this app.
export function standaloneLockfile(source: string): string {
  const importer = '\n  apps/kiosk:\n';
  const start = source.indexOf(importer);
  const packages = source.indexOf('\npackages:\n');
  const importers = source.indexOf('\nimporters:\n');
  if (start < 0 || packages < start || importers < 0) throw new Error('Kiosk lockfile entry not found');
  const tail = source.slice(start + importer.length, packages);
  const end = tail.search(/\n  \S[^\n]*:\n/);
  const entry = end < 0 ? tail : tail.slice(0, end);
  return `${source.slice(0, importers)}\nimporters:\n\n  .:\n${entry.trimEnd()}\n${source.slice(packages)}`;
}

export async function prepareDeploy() {
  const app = new URL('../', import.meta.url);
  const destination = await mkdtemp(join(tmpdir(), 'paymore-kiosk-'));
  for (const path of ['src', 'server', 'api', 'public', 'index.html', 'package.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'vercel.json']) {
    await cp(new URL(path, app), join(destination, path), { recursive: true });
  }
  const lockfile = await readFile(new URL('../../pnpm-lock.yaml', app), 'utf8');
  await writeFile(join(destination, 'pnpm-lock.yaml'), standaloneLockfile(lockfile));
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${await prepareDeploy()}\n`);
}
