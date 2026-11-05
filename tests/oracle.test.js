import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { solve } from '../src/engine.js';
import { verifyCertificate } from '../src/verify.js';

// This oracle deliberately uses no planner helpers: enumerate every kit, then
// expand whole distance layers of inventory objects rather than the engine's
// heap, compiled vectors, and predecessor queue.
function exhaustiveOracle(model, mode) {
  const resources = model.resources;
  const key = state => resources.map(r => state[r.id]).join('/');
  const successful = [];
  function checkKit(seed) {
    const initial = Object.fromEntries(resources.map(r => [r.id, r.initial + seed[r.id]]));
    const target = Object.fromEntries(resources.map(r => [r.id,
      (model.goal[r.id] || 0) + (mode === 'loan' ? seed[r.id] : 0)]));
    let layer = [initial], distance = 0;
    const visited = new Set([key(initial)]);
    while (layer.length) {
      if (layer.some(state => resources.every(r => state[r.id] >= target[r.id]))) {
        successful.push({ seed: { ...seed }, distance,
          cost: resources.reduce((cost, r) => cost + seed[r.id] * r.seedCost, 0) });
        return;
      }
      const nextLayer = [];
      for (const state of layer) {
        for (const recipe of model.recipes) {
          const next = { ...state };
          let enabled = true;
          for (const r of resources) {
            const a = recipe.consume?.[r.id] || 0;
            const b = recipe.produce?.[r.id] || 0;
            const q = recipe.require?.[r.id] || 0;
            if (state[r.id] < a + q) enabled = false;
            next[r.id] = state[r.id] - a + b;
            if (next[r.id] < 0 || next[r.id] > r.capacity) enabled = false;
          }
          if (enabled && !visited.has(key(next))) {
            visited.add(key(next));
            nextLayer.push(next);
          }
        }
      }
      layer = nextLayer;
      distance++;
    }
  }
  function kits(index, seed) {
    if (index === resources.length) return checkKit(seed);
    const r = resources[index];
    for (let quantity = 0; quantity <= r.seedMax; quantity++) {
      if (r.initial + quantity <= r.capacity) kits(index + 1, { ...seed, [r.id]: quantity });
    }
  }
  kits(0, {});
  const minimum = successful.reduce((best, result) => Math.min(best, result.cost), Infinity);
  return { minimum, solutions: successful.filter(result => result.cost === minimum) };
}

function checkAgainstOracle(model, mode, label) {
  const before = JSON.stringify(model);
  const expected = exhaustiveOracle(model, mode);
  const actual = solve(model, { mode, maxCandidates: 1000, maxStates: 1000 });
  assert.equal(JSON.stringify(model), before, `${label}: model mutated`);
  assert.equal(actual.status, expected.solutions.length ? 'optimal' : 'infeasible', label);
  const seedKey = seed => model.resources.map(r => seed[r.id] || 0).join('/');
  assert.deepEqual(actual.solutions.map(s => seedKey(s.seed)).sort(),
    expected.solutions.map(s => seedKey(s.seed)).sort(), `${label}: cheapest-kit tie set`);
  for (const solution of actual.solutions) {
    const oracle = expected.solutions.find(s => seedKey(s.seed) === seedKey(solution.seed));
    assert.equal(solution.cost, expected.minimum, `${label}: cost`);
    assert.equal(solution.steps.length, oracle.distance, `${label}: shortest step count`);
    const verified = verifyCertificate({ format: 'ouroseed-witness-v1', model, mode,
      seed: solution.seed, steps: solution.steps, states: solution.states,
      final: solution.final, retained: solution.retained });
    assert.equal(verified.valid, true, `${label}: ${verified.errors.join('; ')}`);
  }
  return actual;
}

function randomModels(count) {
  let seed = 0x5eedcafe;
  const next = limit => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 0x100000000) * limit);
  };
  return Array.from({ length: count }, (_, n) => {
    const size = 2 + next(2);
    const resources = Array.from({ length: size }, (_, i) => ({
      id: `r${i}`, label: `Resource ${i}`, initial: next(3), capacity: 2,
      seedMax: next(3), seedCost: 1 + next(4),
    }));
    const quantityMap = () => Object.fromEntries(resources.map(r => [r.id, next(5) < 3 ? 0 : 1 + next(2)]));
    const recipes = Array.from({ length: 2 + next(3) }, (_, i) => ({
      id: `action-${i}`, label: `Action ${i}`, consume: quantityMap(),
      produce: quantityMap(), require: quantityMap(),
    }));
    const goal = Object.fromEntries(resources.map(r => [r.id, next(3)]));
    if (!Object.values(goal).some(Boolean)) goal.r0 = 1;
    return { version: 1, name: `Oracle case ${n}`, description: '', resources, recipes, goal };
  });
}

test('120 deterministic tiny models agree with a separate exhaustive oracle in both modes', () => {
  randomModels(120).forEach((model, index) => {
    for (const mode of ['loan', 'gift']) checkAgainstOracle(model, mode, `case ${index}, ${mode}`);
  });
});

test('documented examples have the claimed costs, tie sets, and shortest traces', async () => {
  const cases = [
    ['locked-workshop', 'loan', 3, 2, 6],
    ['locked-workshop', 'gift', 3, 2, 3],
    ['shared-consumable', 'loan', null, 0, null],
    ['shared-consumable', 'gift', null, 0, null],
    ['borrowed-battery', 'loan', null, 0, null],
    ['borrowed-battery', 'gift', 2, 1, 1],
    ['regenerative-starter', 'loan', 1, 1, 3],
    ['regenerative-starter', 'gift', 1, 1, 2],
  ];
  for (const [file, mode, cost, count, steps] of cases) {
    const model = JSON.parse(await readFile(new URL(`../examples/${file}.json`, import.meta.url), 'utf8'));
    const actual = checkAgainstOracle(model, mode, `${file}, ${mode}`);
    assert.equal(actual.solutions.length, count);
    for (const solution of actual.solutions) {
      assert.equal(solution.cost, cost);
      assert.equal(solution.steps.length, steps);
    }
  }
});

const resource = (id, capacity, seedMax, seedCost = 1, initial = 0) => ({
  id, label: id, initial, capacity, seedMax, seedCost,
});
const model = (resources, recipes, goal) => ({ version: 1, name: 'Boundary model', resources, recipes, goal });
const recipe = (id, consume, produce, require = {}) => ({ id, consume, produce, require });

test('all cost ties survive even when they use different numbers of external units', () => {
  const input = model([resource('heavy', 1, 1, 2), resource('light', 2, 2), resource('product', 1, 0)], [
    recipe('heavy-route', { heavy: 1 }, { product: 1 }),
    recipe('light-route', { light: 2 }, { product: 1 }),
  ], { product: 1 });
  const result = checkAgainstOracle(input, 'gift', 'mixed unit-count ties');
  assert.equal(result.solutions.length, 2);
  assert.deepEqual(result.solutions.map(s => s.units).sort(), [1, 2]);
  assert.ok(result.solutions.every(s => s.cost === 2));
});

test('weighted kit cost takes priority over unit count', () => {
  const input = model([resource('heavy', 1, 1, 3), resource('light', 2, 2), resource('product', 1, 0)], [
    recipe('heavy-route', { heavy: 1 }, { product: 1 }),
    recipe('light-route', { light: 2 }, { product: 1 }),
  ], { product: 1 });
  const result = checkAgainstOracle(input, 'gift', 'weighted cost before units');
  assert.equal(result.solutions.length, 1);
  assert.equal(result.solutions[0].seed.light, 2);
  assert.equal(result.solutions[0].cost, 2);
});

test('a surviving witness is not claimed optimal when a cheaper kit exceeded the state budget', () => {
  const input = model([resource('input', 1, 1), resource('target', 1, 1, 2)], [
    recipe('make-input', {}, { input: 1 }),
    recipe('make-target', { input: 1 }, { target: 1 }),
  ], { target: 1 });
  const limited = solve(input, { mode: 'gift', maxStates: 1 });
  assert.equal(limited.status, 'inconclusive');
  assert.equal(limited.solutions.length, 1);
  assert.equal(limited.solutions[0].cost, 2);
  assert.equal(checkAgainstOracle(input, 'gift', 'untruncated zero-cost path').solutions[0].cost, 0);
});

test('candidate-budget boundaries distinguish exhausted search from unexamined kits', () => {
  const unavailable = model([resource('target', 1, 0)], [], { target: 1 });
  assert.equal(solve(unavailable, { mode: 'gift', maxCandidates: 1 }).status, 'infeasible');
  const available = model([resource('target', 1, 1)], [], { target: 1 });
  assert.equal(solve(available, { mode: 'gift', maxCandidates: 1 }).status, 'inconclusive');
  assert.equal(solve(available, { mode: 'gift', maxCandidates: 2 }).status, 'optimal');
  const ready = model([resource('target', 2, 1, 1, 1)], [], { target: 1 });
  assert.equal(solve(ready, { maxCandidates: 1 }).status, 'optimal');
});

test('the state budget is exact and includes the initial inventory', () => {
  const input = model([resource('target', 2, 0)], [recipe('grow', {}, { target: 1 })], { target: 2 });
  assert.equal(solve(input, { maxStates: 2 }).status, 'inconclusive');
  const complete = solve(input, { maxStates: 3 });
  assert.equal(complete.status, 'optimal');
  assert.equal(complete.solutions[0].steps.length, 2);
});
