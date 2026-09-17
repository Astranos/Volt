import { describe, expect, it } from 'vitest';
import { standaloneLockfile } from './prepare-deploy.ts';

describe('isolated kiosk deployment', () => {
  it('keeps locked package resolutions but installs only the kiosk importer', () => {
    const fixture = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      private-app: {}\n\n  apps/kiosk:\n    dependencies:\n      react:\n        version: 19.2.3\n\n  apps/web:\n    dependencies:\n      other-app: {}\n\npackages:\n  react@19.2.3: {}\n\nsnapshots:\n  react@19.2.3: {}\n";
    const result: string = standaloneLockfile(fixture);
    expect(result).toContain('  .:\n    dependencies:\n      react:');
    expect(result).not.toMatch(/private-app|other-app|apps\/web|apps\/kiosk/);
    expect(result).toContain('snapshots:\n  react@19.2.3: {}');
  });
  it('refuses to stage without an authoritative kiosk lock entry', () => {
    expect(() => standaloneLockfile('lockfileVersion: 9')).toThrow('Kiosk lockfile entry not found');
  });
});
