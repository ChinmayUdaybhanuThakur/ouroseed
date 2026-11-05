/** Finite-state bootstrap planning. No persistence, network, or external solver. */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const integer = (n, label, minimum = 0) => {
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error(`${label} must be a safe integer >= ${minimum}.`);
  return n;
};
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(id)
  && !['constructor', 'prototype'].includes(id);
const text = (value, fallback, label) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 10000) throw new Error(`${label} must be text of at most 10000 characters.`);
  return value;
};
const defaulted = (value, fallback) => value === undefined ? fallback : value;

/** Validate, copy, and fill optional defaults. Throws an actionable Error. */
export function validateModel(input) {
  if (!isRecord(input) || input.version !== 1) throw new Error('Model version must be 1.');
  if (!Array.isArray(input.resources) || !input.resources.length || input.resources.length > 64) {
    throw new Error('Model needs 1 to 64 resources.');
  }
  const ids = new Set();
  const resources = input.resources.map((r, index) => {
    if (!isRecord(r) || !validId(r.id)) throw new Error(`Resource ${index + 1} needs a lowercase ID (letters, digits, _ or -).`);
    if (ids.has(r.id)) throw new Error(`Duplicate resource ID: ${r.id}.`);
    ids.add(r.id);
    const resource = {
      id: r.id, label: text(r.label, r.id, `${r.id}.label`),
      initial: integer(defaulted(r.initial, 0), `${r.id}.initial`),
      capacity: integer(r.capacity, `${r.id}.capacity`),
      seedMax: integer(defaulted(r.seedMax, 0), `${r.id}.seedMax`),
      seedCost: integer(defaulted(r.seedCost, 1), `${r.id}.seedCost`, 1),
    };
    if (resource.initial > resource.capacity) throw new Error(`${r.id}: initial inventory exceeds capacity.`);
    return resource;
  });
  let maxCost = 0;
  let maxUnits = 0;
  for (const r of resources) {
    const bound = Math.min(r.seedMax, r.capacity - r.initial);
    maxCost += bound * r.seedCost;
    maxUnits += bound;
  }
  if (!Number.isSafeInteger(maxCost) || !Number.isSafeInteger(maxUnits)) throw new Error('Seed range is too large for exact integer arithmetic.');
  function quantities(map, label, optional = true) {
    if (map === undefined && optional) return {};
    if (!isRecord(map)) throw new Error(`${label} must be a resource-to-quantity object.`);
    const result = {};
    for (const [id, quantity] of Object.entries(map)) {
      if (!ids.has(id)) throw new Error(`${label} references unknown resource: ${id}.`);
      result[id] = integer(quantity, `${label}.${id}`);
    }
    return result;
  }
  if (!Array.isArray(input.recipes) || input.recipes.length > 256) throw new Error('recipes must be an array of at most 256 recipes.');
  const recipeIds = new Set();
  const recipes = input.recipes.map((r, index) => {
    if (!isRecord(r) || !validId(r.id)) throw new Error(`Recipe ${index + 1} needs a lowercase ID.`);
    if (recipeIds.has(r.id)) throw new Error(`Duplicate recipe ID: ${r.id}.`);
    recipeIds.add(r.id);
    const recipe = {
      id: r.id, label: text(r.label, r.id, `${r.id}.label`),
      consume: quantities(r.consume, `${r.id}.consume`),
      produce: quantities(r.produce, `${r.id}.produce`),
      require: quantities(r.require, `${r.id}.require`),
    };
    for (const id of ids) {
      if (!Number.isSafeInteger((recipe.consume[id] ?? 0) + (recipe.require[id] ?? 0))) {
        throw new Error(`${r.id}: consume + require exceeds safe integer arithmetic.`);
      }
    }
    return recipe;
  });
  const goal = quantities(input.goal, 'goal', false);
  if (!Object.values(goal).some(n => n > 0)) throw new Error('goal must require at least one positive resource quantity.');
  for (const r of resources) if ((goal[r.id] ?? 0) > r.capacity) throw new Error(`Goal for ${r.id} exceeds capacity.`);
  return { version: 1, name: text(input.name, 'Untitled workshop', 'name'),
    description: text(input.description, '', 'description'), resources, recipes, goal };
}

function optionsWithDefaults(options = {}) {
  if (!isRecord(options)) throw new Error('Options must be an object.');
  const mode = defaulted(options.mode, 'loan');
  if (mode !== 'loan' && mode !== 'gift') throw new Error('mode must be loan or gift.');
  return { mode, maxStates: integer(defaulted(options.maxStates, 20000), 'maxStates', 1),
    maxCandidates: integer(defaulted(options.maxCandidates, 2048), 'maxCandidates', 1) };
}

function compile(model) {
  const { resources } = model;
  const ids = resources.map(r => r.id);
  const vector = map => ids.map(id => map[id] ?? 0);
  return { model, ids, vector, object: values => Object.fromEntries(ids.map((id, i) => [id, values[i]])),
    initial: resources.map(r => r.initial), capacity: resources.map(r => r.capacity),
    bounds: resources.map(r => Math.min(r.seedMax, r.capacity - r.initial)),
    goal: vector(model.goal), costs: resources.map(r => r.seedCost),
    recipes: model.recipes.map(r => ({ id: r.id, consume: vector(r.consume), produce: vector(r.produce),
      need: resources.map(x => (r.consume[x.id] ?? 0) + (r.require[x.id] ?? 0)) })) };
}

function seedVector(compiled, seed) {
  if (!isRecord(seed)) throw new Error('Seed must be a resource-to-quantity object.');
  for (const [id, value] of Object.entries(seed)) {
    if (!compiled.ids.includes(id)) throw new Error(`Seed references unknown resource: ${id}.`);
    integer(value, `seed.${id}`);
  }
  const values = compiled.vector(seed);
  values.forEach((quantity, i) => {
    if (quantity > compiled.bounds[i]) throw new Error(`Seed for ${compiled.ids[i]} exceeds seedMax or available capacity.`);
  });
  return values;
}

function search(compiled, seed, options) {
  const { ids, initial, capacity, goal, recipes, object, costs } = compiled;
  const start = initial.map((value, i) => value + seed[i]);
  const target = goal.map((value, i) => value + (options.mode === 'loan' ? seed[i] : 0));
  const common = { seed: object(seed), cost: seed.reduce((sum, q, i) => sum + q * costs[i], 0),
    units: seed.reduce((sum, q) => sum + q, 0) };
  const failed = (status, explored, reason) => ({ ...common, status, explored, reason, steps: [], states: [], final: null, retained: null });
  if (target.some((value, i) => value > capacity[i] || !Number.isSafeInteger(value))) {
    return failed('unreachable', 1, 'The goal plus loan repayment exceeds capacity.');
  }
  const nodes = [{ state: start, parent: -1, recipe: null }];
  const seen = new Set([start.join(',')]);
  const isGoal = state => target.every((quantity, i) => state[i] >= quantity);
  const success = index => {
    const chain = [];
    for (let i = index; i !== -1; i = nodes[i].parent) chain.push(nodes[i]);
    chain.reverse();
    const final = nodes[index].state;
    return { ...common, status: 'reachable', explored: seen.size,
      steps: chain.slice(1).map(node => node.recipe), states: chain.map(node => object(node.state)),
      final: object(final), retained: object(final.map((value, i) => value - (options.mode === 'loan' ? seed[i] : 0))) };
  };
  if (isGoal(start)) return success(0);
  for (let head = 0; head < nodes.length; head++) {
    const state = nodes[head].state;
    for (const recipe of recipes) {
      if (recipe.need.some((quantity, i) => quantity > state[i])) continue;
      const remainder = state.map((quantity, i) => quantity - recipe.consume[i]);
      if (recipe.produce.some((quantity, i) => quantity > capacity[i] - remainder[i])) continue;
      const next = remainder.map((quantity, i) => quantity + recipe.produce[i]);
      const key = next.join(',');
      if (seen.has(key)) continue;
      if (seen.size >= options.maxStates) return failed('inconclusive', seen.size, `Per-kit state budget (${options.maxStates}) reached.`);
      seen.add(key);
      nodes.push({ state: next, parent: head, recipe: recipe.id });
      if (isGoal(next)) return success(nodes.length - 1);
    }
  }
  return failed('unreachable', seen.size, 'All reachable inventories were exhausted.');
}

/** Exact reachability for one permitted kit. A trace uses the fewest recipe firings. */
export function analyzeKit(input, seed = {}, options = {}) {
  const compiled = compile(validateModel(input));
  return search(compiled, seedVector(compiled, seed), optionsWithDefaults(options));
}

class Heap {
  constructor(compare) { this.items = []; this.compare = compare; }
  peek() { return this.items[0]; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(a[parent], item) <= 0) break;
      a[i] = a[parent]; i = parent;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    const first = a[0], last = a.pop();
    if (!a.length) return first;
    let i = 0;
    while (2 * i + 1 < a.length) {
      let child = 2 * i + 1;
      if (child + 1 < a.length && this.compare(a[child + 1], a[child]) < 0) child++;
      if (this.compare(last, a[child]) <= 0) break;
      a[i] = a[child]; i = child;
    }
    a[i] = last;
    return first;
  }
}

/** Find all cheapest feasible kits under supplied bounds. Budget exhaustion is never infeasibility. */
export function solve(input, options = {}) {
  const compiled = compile(validateModel(input));
  const settings = optionsWithDefaults(options);
  const { costs, bounds, ids } = compiled;
  const compare = (a, b) => a.cost - b.cost || a.units - b.units || (() => {
    for (let i = 0; i < a.seed.length; i++) if (a.seed[i] !== b.seed[i]) return a.seed[i] - b.seed[i];
    return 0;
  })();
  const heap = new Heap(compare);
  const zero = ids.map(() => 0);
  heap.push({ seed: zero, cost: 0, units: 0 });
  const seen = new Set([zero.join(',')]);
  const solutions = [];
  const stats = { candidates: 0, states: 0 };
  let best = Infinity, unknown = false, budgetHit = false;
  while (heap.peek() && heap.peek().cost <= best) {
    if (stats.candidates >= settings.maxCandidates) { budgetHit = true; break; }
    const candidate = heap.pop();
    const result = search(compiled, candidate.seed, settings);
    stats.candidates++;
    stats.states += result.explored;
    if (result.status === 'reachable') {
      best = result.cost;
      const { seed, cost, units, steps, states, final, retained } = result;
      solutions.push({ seed, cost, units, steps, states, final, retained });
    } else if (result.status === 'inconclusive') unknown = true;
    // Lazy lattice traversal: never materialize the full Cartesian product.
    for (let i = 0; i < candidate.seed.length; i++) {
      if (candidate.seed[i] >= bounds[i] || candidate.cost + costs[i] > best) continue;
      const seed = candidate.seed.slice(); seed[i]++;
      const key = seed.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      heap.push({ seed, cost: candidate.cost + costs[i], units: candidate.units + 1 });
    }
  }
  const incomplete = unknown || budgetHit;
  return { status: incomplete ? 'inconclusive' : solutions.length ? 'optimal' : 'infeasible', mode: settings.mode,
    solutions, stats,
    ...(incomplete ? { reason: [unknown ? 'At least one potentially competitive kit exceeded its state budget.' : '',
      budgetHit ? `Candidate budget (${settings.maxCandidates}) reached before all potentially competitive kits were checked.` : '']
      .filter(Boolean).join(' ') } : {}) };
}

/** A portable feasibility witness. Verification does not certify cheapest-kit optimality. */
export function makeCertificate(input, solution, mode = 'loan') {
  const model = validateModel(input);
  optionsWithDefaults({ mode });
  return JSON.parse(JSON.stringify({ format: 'ouroseed-witness-v1', model, mode,
    seed: solution.seed, steps: solution.steps, states: solution.states,
    final: solution.final, retained: solution.retained }));
}
