import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = join(root, 'ios/VoltKiosk');
const scratch = mkdtempSync(join(tmpdir(), 'volt-kiosk-check-'));
const run = (tool, args) => execFileSync(tool, args, { stdio: 'inherit', cwd: root });

try {
  run('plutil', ['-lint', join(sources, 'Info.plist'), join(root, 'ios/VoltKiosk.xcodeproj/project.pbxproj')]);
  if (process.argv.includes('--typecheck')) {
    const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim();
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run('xcrun', ['swiftc', '-typecheck', '-parse-as-library', '-swift-version', '5', '-sdk', sdk,
      '-target', `${arch}-apple-ios17.0-simulator`, '-module-cache-path', join(scratch, 'modules'),
      ...readdirSync(sources).filter(name => name.endsWith('.swift')).map(name => join(sources, name))]);
    console.log('iPad app Swift typecheck passed.');
  } else {
    const executable = join(scratch, 'portal-policy-tests');
    run('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', join(scratch, 'modules'),
      join(sources, 'PortalNavigationPolicy.swift'), join(root, 'tests/PortalNavigationPolicyTests.swift'), '-o', executable]);
    run(executable, []);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
