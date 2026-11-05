import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = (...args) => spawnSync(process.execPath, ['src/cli.js', ...args], { cwd: root, encoding: 'utf8' });

test('CLI round trip exports a verifiable witness and refuses to overwrite it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ouroseed-test-'));
  const path = join(directory, 'witness.json');
  try {
    const solved = run('solve', 'examples/locked-workshop.json', '--witness', path);
    assert.equal(solved.status, 0, solved.stderr);
    assert.equal(JSON.parse(solved.stdout).status, 'optimal');
    const verified = run('verify', path);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).valid, true);
    const original = readFileSync(path, 'utf8');
    assert.equal(run('solve', 'examples/locked-workshop.json', '--witness', path).status, 1);
    assert.equal(readFileSync(path, 'utf8'), original);
    const tampered = JSON.parse(original);
    tampered.retained.lathe = 999;
    writeFileSync(path, JSON.stringify(tampered));
    const bad = run('verify', path);
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).valid, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI exposes infeasibility, unknown results, and invalid arguments distinctly', () => {
  const impossible = run('solve', 'examples/borrowed-battery.json');
  assert.equal(impossible.status, 2);
  assert.equal(JSON.parse(impossible.stdout).status, 'infeasible');
  assert.equal(run('solve', 'examples/locked-workshop.json', '--candidates', '1').status, 3);
  assert.equal(run('solve', 'examples/locked-workshop.json', '--mode', 'anything').status, 1);
  assert.equal(run('solve', 'examples/locked-workshop.json', '--states', '2.2').status, 1);
});
