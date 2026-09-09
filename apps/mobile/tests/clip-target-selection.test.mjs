import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(new URL('../ios/VoltClip/Services/ClipScannerStore.swift', import.meta.url), 'utf8');

function declaration(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing production declaration: ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}

test('App Clip explicit local and computer destinations survive list refreshes', {
  skip: process.platform !== 'darwin' && 'requires Swift on macOS',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'volt-clip-target-'));
  try {
    const fixture = `
import Foundation
struct AppClipWorkspaceComputer {
    let deviceId: String
    let label: String
    var online = true
    var supportsCursorInsertion = true
}
final class TargetFixture {
    ${declaration('private enum WorkspaceTarget')}
    private var workspaceTarget: WorkspaceTarget = .automatic
    var workspaceComputers: [AppClipWorkspaceComputer] = []
    var pairingLabel: String? = "Preferred"
    var targetHint = ""
    ${declaration('var selectedWorkspaceComputerId: String?')}
    ${declaration('var availableWorkspaceComputers:')}
    ${declaration('var selectedWorkspaceComputer:')}
    ${declaration('var typingTargetLabel:')}
    ${declaration('func selectWorkspaceComputer(deviceId:')}
    ${declaration('private func selectInitialComputer()')}
    func refresh(_ computers: [AppClipWorkspaceComputer]) {
        workspaceComputers = computers
        selectInitialComputer()
    }
}
let a = AppClipWorkspaceComputer(deviceId: "a", label: "Other")
let b = AppClipWorkspaceComputer(deviceId: "b", label: "Preferred")
let store = TargetFixture()
store.refresh([])
store.refresh([a, b])
precondition(store.selectedWorkspaceComputerId == "b")
store.selectWorkspaceComputer(deviceId: nil)
store.refresh([a, b])
precondition(store.selectedWorkspaceComputerId == nil)
precondition(store.typingTargetLabel == "This iPhone")
store.selectWorkspaceComputer(deviceId: "invalid")
precondition(store.selectedWorkspaceComputerId == nil)
store.selectWorkspaceComputer(deviceId: "a")
store.refresh([b])
precondition(store.selectedWorkspaceComputerId == "a")
precondition(store.selectedWorkspaceComputer == nil)
store.refresh([a, b])
precondition(store.selectedWorkspaceComputer?.deviceId == "a")
print("target selection fixtures passed")
`;
    const path = join(directory, 'main.swift');
    writeFileSync(path, fixture);
    assert.equal(execFileSync('xcrun', ['swift', path], { encoding: 'utf8' }).trim(), 'target selection fixtures passed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refresh and disconnect use the target selection model', () => {
  assert.match(declaration('func refreshWorkspaceComputers()'), /selectInitialComputer\(\)/);
  assert.match(declaration('func disconnect()'), /workspaceTarget = \.automatic/);
  assert.match(declaration('private func preparePairing('), /workspaceTarget = \.automatic/);
});
