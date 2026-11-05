import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModel, analyzeKit, solve, makeCertificate } from '../src/engine.js';
import { verifyCertificate } from '../src/verify.js';

const resource = (id, extra = {}) => ({ id, label: id, initial: 0, capacity: 4, seedMax: 0, seedCost: 1, ...extra });
const model = (resources, recipes, goal) => ({ version: 1, name: 'Test workshop', resources, recipes, goal });
const clone = x => JSON.parse(JSON.stringify(x));
const loanExample = () => model([
  resource('ore', { initial: 3 }), resource('tool', { seedMax: 2, seedCost: 3 }), resource('part'),
], [
  { id: 'machine', require: { tool: 1 }, consume: { ore: 1 }, produce: { part: 1 } },
  { id: 'build', consume: { part: 1 }, produce: { tool: 1 } },
], { tool: 1, part: 1 });

test('loan pays back the tool while keeping the full goal; gift needs fewer firings', () => {
  const loan = solve(loanExample());
  const gift = solve(loanExample(), { mode: 'gift' });
  assert.equal(loan.status, 'optimal');
  assert.equal(loan.solutions.length, 1);
  assert.equal(loan.solutions[0].cost, 3);
  assert.equal(loan.solutions[0].steps.length, 3);
  assert.equal(gift.solutions[0].steps.length, 1);
  assert.equal(loan.solutions[0].final.tool, 2);
  assert.equal(loan.solutions[0].retained.tool, 1);
  assert.equal(analyzeKit(loanExample()).status, 'unreachable');
});

test('a dependency path does not conjure resources consumed by a competing recipe', () => {
  const m = model([resource('stock', { initial: 1 }), resource('a'), resource('b')], [
    { id: 'a', consume: { stock: 1 }, produce: { a: 1 } },
    { id: 'b', consume: { stock: 1 }, produce: { b: 1 } },
  ], { a: 1, b: 1 });
  assert.equal(solve(m).status, 'infeasible');
  assert.equal(analyzeKit(m).explored, 3);
});

test('reusable requirement is additional to consumption of the same resource', () => {
  const m = model([resource('tool', { initial: 1 }), resource('part')], [
    { id: 'use', require: { tool: 1 }, consume: { tool: 1 }, produce: { part: 1 } },
  ], { part: 1 });
  assert.equal(analyzeKit(m).status, 'unreachable');
  m.resources[0].initial = 2;
  const r = analyzeKit(m);
  assert.equal(r.status, 'reachable');
  assert.equal(r.final.tool, 1);
});

test('capacity rejects an entire firing; outputs are never silently clipped', () => {
  const m = model([resource('a', { initial: 1, capacity: 1 }), resource('b')], [
    { id: 'overflow', produce: { a: 1, b: 1 } },
  ], { b: 1 });
  assert.equal(analyzeKit(m).status, 'unreachable');
});

test('BFS returns a shortest trace even if a longer route is listed first', () => {
  const m = model([resource('a', { initial: 1 }), resource('b'), resource('c')], [
    { id: 'detour', consume: { a: 1 }, produce: { b: 1 } },
    { id: 'finish', consume: { b: 1 }, produce: { c: 1 } },
    { id: 'direct', consume: { a: 1 }, produce: { c: 1 } },
  ], { c: 1 });
  assert.deepEqual(analyzeKit(m).steps, ['direct']);
});

test('all equally cheapest kits returned, weighted cost precedes unit count', () => {
  const m = model([resource('a', { seedMax: 1, seedCost: 2 }), resource('b', { seedMax: 2 }), resource('goal')], [
    { id: 'a-route', require: { a: 1 }, produce: { goal: 1 } },
    { id: 'b-route', require: { b: 2 }, produce: { goal: 1 } },
  ], { goal: 1 });
  const r = solve(m);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(r.solutions.map(x => [x.cost, x.units]), [[2, 1], [2, 2]]);
  assert.deepEqual(r.solutions.map(x => x.seed), [{ a: 1, b: 0, goal: 0 }, { a: 0, b: 2, goal: 0 }]);
});

test('gift can consume imported material, while loan must replace it', () => {
  const m = model([resource('ore', { seedMax: 1 }), resource('part')], [
    { id: 'make', consume: { ore: 1 }, produce: { part: 1 } },
  ], { part: 1 });
  assert.equal(solve(m, { mode: 'gift' }).status, 'optimal');
  assert.equal(solve(m, { mode: 'loan' }).status, 'infeasible');
});

test('loan goal and repayment share capacity; seed alone cannot satisfy retained goal', () => {
  const m = model([resource('a', { seedMax: 1, capacity: 1 })], [], { a: 1 });
  assert.equal(analyzeKit(m, { a: 1 }).status, 'unreachable');
  assert.equal(solve(m).status, 'infeasible');
  assert.equal(solve(m, { mode: 'gift' }).status, 'optimal');
});

test('zero seed and zero-step success are valid and verify', () => {
  const m = model([resource('a', { initial: 1, seedMax: 2 })], [], { a: 1 });
  const r = solve(m);
  assert.equal(r.stats.candidates, 1);
  assert.equal(r.solutions[0].cost, 0);
  assert.deepEqual(r.solutions[0].steps, []);
  assert.equal(verifyCertificate(makeCertificate(m, r.solutions[0], 'loan')).valid, true);
});

test('state budget exhaustion is inconclusive, including a competitive smaller kit', () => {
  const m = model([resource('a', { initial: 1 }), resource('b', { seedMax: 1 })], [
    { id: 'make', consume: { a: 1 }, produce: { b: 1 } },
  ], { b: 1 });
  const r = solve(m, { mode: 'gift', maxStates: 1 });
  assert.equal(r.status, 'inconclusive');
  assert.equal(r.solutions[0].cost, 1);
  assert.equal(analyzeKit(m, {}, { maxStates: 1 }).status, 'inconclusive');
});

test('candidate budget never turns an incomplete kit enumeration into infeasibility', () => {
  const m = loanExample();
  assert.equal(solve(m, { maxCandidates: 1 }).status, 'inconclusive');
  const r = solve(m, { maxCandidates: 2 });
  assert.equal(r.status, 'optimal');
});

test('candidate cap before equally priced alternative means all-optima result is inconclusive', () => {
  const m = model([resource('a', { seedMax: 1 }), resource('b', { seedMax: 1 }), resource('c')], [
    { id: 'a', require: { a: 1 }, produce: { c: 1 } },
    { id: 'b', require: { b: 1 }, produce: { c: 1 } },
  ], { c: 1 });
  const r = solve(m, { maxCandidates: 2 });
  assert.equal(r.status, 'inconclusive');
  assert.equal(r.solutions.length, 1);
});

test('kit enumeration is lazy even with a huge Cartesian product', () => {
  const resources = Array.from({ length: 30 }, (_, i) => resource(`r${i}`, { capacity: 100, seedMax: 100 }));
  const m = model(resources, [], { r0: 1 });
  const r = solve(m, { maxCandidates: 1 });
  assert.equal(r.status, 'inconclusive');
  assert.equal(r.stats.candidates, 1);
});

test('no-op cycles terminate with finite visited inventories', () => {
  const m = model([resource('a', { initial: 1 }), resource('b')], [
    { id: 'noop', consume: { a: 1 }, produce: { a: 1 } },
  ], { b: 1 });
  assert.equal(analyzeKit(m).status, 'unreachable');
  assert.equal(analyzeKit(m).explored, 1);
});

test('model validation rejects malformed and unsafe inputs without mutating the original', () => {
  const good = loanExample(), before = clone(good);
  validateModel(good); assert.deepEqual(good, before);
  const invalid = [null, {}, { ...good, version: 2 }, { ...good, goal: {} }, { ...good, goal: { tool: 0 } },
    { ...good, goal: { missing: 1 } }, { ...good, resources: [...good.resources, good.resources[0]] },
    { ...good, recipes: [{ id: 'x', consume: { ore: -1 } }] },
    { ...good, recipes: [{ id: 'x', consume: { missing: 1 } }] },
    { ...good, resources: [resource('constructor')] },
    { ...good, resources: [resource('a', { capacity: NaN })] },
    { ...good, resources: [resource('a', { initial: null })] },
    { ...good, recipes: [{ id: 'x', consume: { ore: 0.5 } }] },
    { ...good, recipes: [{ id: 'x', consume: { ore: Number.MAX_SAFE_INTEGER }, require: { ore: 1 } }] },
  ];
  for (const m of invalid) assert.throws(() => validateModel(m));
  assert.throws(() => solve(good, { mode: 'oops' }));
  assert.throws(() => solve(good, { mode: null }));
  assert.throws(() => solve(good, { maxStates: 0 }));
  assert.throws(() => solve(good, { maxCandidates: Infinity }));
  assert.throws(() => analyzeKit(good, { tool: 3 }));
  assert.throws(() => analyzeKit(good, { missing: 1 }));
  assert.throws(() => analyzeKit(good, { tool: -1 }));
});

test('independent verifier accepts real loan and gift witnesses', () => {
  for (const mode of ['loan', 'gift']) {
    const m = loanExample();
    const solution = solve(m, { mode }).solutions[0];
    const certificate = makeCertificate(m, solution, mode);
    const r = verifyCertificate(certificate);
    assert.equal(r.valid, true, r.errors.join('; '));
    assert.deepEqual(r.final, solution.final);
    assert.deepEqual(r.retained, solution.retained);
  }
});

test('verifier rejects tampering with trace, initial inventory, output, mode or repayment', () => {
  const m = loanExample();
  const good = makeCertificate(m, solve(m).solutions[0], 'loan');
  const mutations = [
    c => { c.format = 'other'; },
    c => { c.seed.tool = 0; },
    c => { c.steps[0] = 'unknown'; },
    c => { c.steps[0] = 'build'; },
    c => { c.states[0].ore++; },
    c => { c.states[1].ore++; },
    c => { c.states.pop(); },
    c => { c.final.tool++; },
    c => { c.retained.tool++; },
    c => { delete c.retained.tool; },
    c => { c.mode = 'gift'; },
    c => { c.model.resources[0].capacity = 1; },
    c => { c.model.goal.part = 4; },
    c => { c.model.recipes[0].produce.part = -1; },
    c => { c.seed.extra = 1; },
    c => { c.model.resources[1].seedMax = 0; },
  ];
  for (const mutate of mutations) {
    const c = clone(good); mutate(c);
    assert.equal(verifyCertificate(c).valid, false, mutate.toString());
  }
  assert.equal(verifyCertificate(null).valid, false);
});

test('verifier independently catches catalyst overlap and overflow', () => {
  const m = model([resource('a', { initial: 1 }), resource('b')], [
    { id: 'make', require: { a: 1 }, produce: { b: 1 } },
  ], { b: 1 });
  const c = makeCertificate(m, solve(m).solutions[0]);
  c.model.recipes[0].consume = { a: 1 };
  assert.match(verifyCertificate(c).errors[0], /consume \+ require/);
  const d = makeCertificate(m, solve(m).solutions[0]);
  d.model.recipes[0].produce.a = 4;
  assert.match(verifyCertificate(d).errors[0], /capacity/);
});

// A separately implemented exhaustive oracle guards heap enumeration and repayment semantics.
test('solver agrees with exhaustive tiny-state oracle on 80 deterministic generated networks', () => {
  let randomState = 830821;
  const random = n => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return Math.floor(randomState / 4294967296 * n); };
  function oracle(m, mode) {
    const feasible = [];
    const n = m.resources.length;
    function visitSeed(seed, i) {
      if (i < n) {
        const r = m.resources[i];
        for (let q = 0; q <= Math.min(r.seedMax, r.capacity - r.initial); q++) visitSeed([...seed, q], i + 1);
        return;
      }
      const start = m.resources.map((r, j) => r.initial + seed[j]);
      const target = m.resources.map((r, j) => (m.goal[r.id] ?? 0) + (mode === 'loan' ? seed[j] : 0));
      let frontier = [start];
      const visited = new Set();
      let found = false;
      while (frontier.length) {
        const current = frontier.pop();
        const key = JSON.stringify(current);
        if (visited.has(key)) continue;
        visited.add(key);
        if (current.every((q, j) => q >= target[j])) { found = true; break; }
        for (const recipe of m.recipes) {
          const next = [];
          let possible = true;
          for (let j = 0; j < n; j++) {
            const r = m.resources[j];
            const consumed = recipe.consume[r.id] ?? 0;
            if (current[j] < consumed + (recipe.require[r.id] ?? 0)) possible = false;
            next[j] = current[j] - consumed + (recipe.produce[r.id] ?? 0);
            if (next[j] > r.capacity) possible = false;
          }
          if (possible) frontier.push(next);
        }
      }
      if (found) feasible.push({ seed, cost: seed.reduce((s, q, j) => s + q * m.resources[j].seedCost, 0) });
    }
    visitSeed([], 0);
    const cost = Math.min(...feasible.map(f => f.cost));
    return feasible.filter(f => f.cost === cost).map(f => f.seed.join(',')).sort();
  }
  for (let iteration = 0; iteration < 80; iteration++) {
    const resources = ['a', 'b', 'c'].map(id => resource(id, { initial: random(2), capacity: 2, seedMax: random(3), seedCost: 1 + random(3) }));
    const recipes = Array.from({ length: 4 }, (_, k) => {
      const consume = {}, produce = {}, require = {};
      for (const r of resources) { consume[r.id] = random(2); produce[r.id] = random(2); require[r.id] = random(2); }
      return { id: `r${k}`, consume, produce, require };
    });
    const m = model(resources, recipes, { c: 1 });
    for (const mode of ['loan', 'gift']) {
      const expected = oracle(m, mode);
      const actual = solve(m, { mode });
      assert.equal(actual.status, expected.length ? 'optimal' : 'infeasible');
      assert.deepEqual(actual.solutions.map(s => resources.map(r => s.seed[r.id]).join(',')).sort(), expected);
      for (const solution of actual.solutions) assert.equal(verifyCertificate(makeCertificate(m, solution, mode)).valid, true);
    }
  }
});
