import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = join(root, 'ios/VoltKiosk');
const swiftFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? swiftFiles(path) : entry.name.endsWith('.swift') ? [path] : [];
});
const scratch = mkdtempSync(join(tmpdir(), 'volt-kiosk-check-'));
const run = (tool, args) => execFileSync(tool, args, { stdio: 'inherit', cwd: root });

try {
  run('plutil', ['-lint', join(sources, 'Info.plist'), join(root, 'ios/VoltKiosk.xcodeproj/project.pbxproj')]);
  const project = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(root, 'ios/VoltKiosk.xcodeproj/project.pbxproj')], { encoding: 'utf8' }));
  const phase = Object.values(project.objects).find(object => object.isa === 'PBXSourcesBuildPhase');
  const wired = phase.files.map(id => project.objects[project.objects[id].fileRef].path).sort();
  const disk = swiftFiles(sources).map(path => path.slice(sources.length + 1)).sort();
  if (JSON.stringify(wired) !== JSON.stringify(disk)) throw new Error('Xcode source list does not match native Swift files.');
  if (process.argv.includes('--typecheck')) {
    const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim();
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run('xcrun', ['swiftc', '-typecheck', '-parse-as-library', '-swift-version', '6', '-sdk', sdk,
      '-target', `${arch}-apple-ios17.0-simulator`, '-module-cache-path', join(scratch, 'modules'),
      ...swiftFiles(sources)]);
    console.log('iPad app Swift typecheck passed.');
  } else {
    const executable = join(scratch, 'native-kiosk-tests');
    run('xcrun', ['swiftc', '-parse-as-library', '-swift-version', '6', '-module-cache-path', join(scratch, 'modules'),
      ...swiftFiles(join(sources, 'Models')), ...swiftFiles(join(sources, 'Services')),
      ...swiftFiles(join(root, 'tests')), '-o', executable]);
    run(executable, process.argv.includes('--live') ? ['--live'] : []);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
