/** Independent witness checker. Deliberately imports no planner code. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const idOkay = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(value)
  && value !== 'constructor' && value !== 'prototype';
function check(condition, message) { if (!condition) throw new Error(message); }
function number(value, label, min = 0) {
  check(Number.isSafeInteger(value) && value >= min, `${label} must be a safe integer >= ${min}.`);
  return value;
}
function string(value, label) {
  check(value === undefined || (typeof value === 'string' && value.length <= 10000), `${label} must be text of at most 10000 characters.`);
}
const defaulted = (value, fallback) => value === undefined ? fallback : value;

/** Replay quantities from scratch and verify every claimed inventory and repayment. */
export function verifyCertificate(certificate) {
  try {
    check(record(certificate), 'Certificate must be an object.');
    check(certificate.format === 'ouroseed-witness-v1', 'Unknown certificate format.');
    check(certificate.mode === 'loan' || certificate.mode === 'gift', 'Certificate mode must be loan or gift.');
    const model = certificate.model;
    check(record(model) && model.version === 1, 'Model version must be 1.');
    string(model.name, 'name'); string(model.description, 'description');
    check(Array.isArray(model.resources) && model.resources.length > 0 && model.resources.length <= 64, 'Model needs 1 to 64 resources.');
    const resources = new Map();
    let possibleCost = 0, possibleUnits = 0;
    for (const r of model.resources) {
      check(record(r) && idOkay(r.id), 'Invalid resource ID.');
      check(!resources.has(r.id), `Duplicate resource ID: ${r.id}.`);
      string(r.label, `${r.id}.label`);
      const initial = number(defaulted(r.initial, 0), `${r.id}.initial`);
      const capacity = number(r.capacity, `${r.id}.capacity`);
      const seedMax = number(defaulted(r.seedMax, 0), `${r.id}.seedMax`);
      const seedCost = number(defaulted(r.seedCost, 1), `${r.id}.seedCost`, 1);
      check(initial <= capacity, `${r.id}: initial inventory exceeds capacity.`);
      const seedBound = Math.min(seedMax, capacity - initial);
      possibleCost += seedBound * seedCost;
      possibleUnits += seedBound;
      resources.set(r.id, { initial, capacity, seedMax });
    }
    check(Number.isSafeInteger(possibleCost) && Number.isSafeInteger(possibleUnits), 'Seed range exceeds exact integer arithmetic.');
    function quantities(value, label, optional = false, complete = false) {
      if (value === undefined && optional) return {};
      check(record(value), `${label} must be an inventory object.`);
      for (const [id, quantity] of Object.entries(value)) {
        check(resources.has(id), `${label} contains unknown resource: ${id}.`);
        number(quantity, `${label}.${id}`);
      }
      if (complete) {
        check(Object.keys(value).length === resources.size, `${label} must contain every resource.`);
        for (const id of resources.keys()) check(Object.prototype.hasOwnProperty.call(value, id), `${label} is missing ${id}.`);
      }
      return value;
    }
    const goal = quantities(model.goal, 'goal');
    check(Object.values(goal).some(value => value > 0), 'Goal needs a positive resource quantity.');
    for (const [id, r] of resources) check((goal[id] ?? 0) <= r.capacity, `Goal for ${id} exceeds capacity.`);
    check(Array.isArray(model.recipes) && model.recipes.length <= 256, 'recipes must be an array of at most 256 recipes.');
    const recipes = new Map();
    for (const r of model.recipes) {
      check(record(r) && idOkay(r.id), 'Invalid recipe ID.');
      check(!recipes.has(r.id), `Duplicate recipe ID: ${r.id}.`);
      string(r.label, `${r.id}.label`);
      const consume = quantities(r.consume, `${r.id}.consume`, true);
      const produce = quantities(r.produce, `${r.id}.produce`, true);
      const require = quantities(r.require, `${r.id}.require`, true);
      for (const id of resources.keys()) check(Number.isSafeInteger((consume[id] ?? 0) + (require[id] ?? 0)), `${r.id}: consume + require exceeds exact integer arithmetic.`);
      recipes.set(r.id, { consume, produce, require });
    }
    const seed = quantities(certificate.seed, 'seed');
    check(Array.isArray(certificate.steps), 'steps must be an array.');
    check(certificate.steps.length <= 1000000, 'Certificate exceeds the one-million-step verification limit.');
    check(Array.isArray(certificate.states) && certificate.states.length === certificate.steps.length + 1,
      'states must contain the initial inventory and one inventory per step.');
    let inventory = {};
    for (const [id, r] of resources) {
      const borrowed = seed[id] ?? 0;
      check(borrowed <= r.seedMax, `Seed for ${id} exceeds seedMax.`);
      check(borrowed <= r.capacity - r.initial, `Seed for ${id} exceeds capacity.`);
      inventory[id] = r.initial + borrowed;
    }
    function match(actual, expected, label) {
      quantities(actual, label, false, true);
      for (const id of resources.keys()) check(actual[id] === expected[id], `${label}.${id} does not match replay (expected ${expected[id]}).`);
    }
    match(certificate.states[0], inventory, 'states[0]');
    for (let i = 0; i < certificate.steps.length; i++) {
      const step = certificate.steps[i];
      check(typeof step === 'string' && recipes.has(step), `Step ${i + 1} references an unknown recipe.`);
      const recipe = recipes.get(step);
      const next = {};
      for (const [id, r] of resources) {
        const consumed = recipe.consume[id] ?? 0;
        const reusable = recipe.require[id] ?? 0;
        check(inventory[id] >= consumed + reusable, `Step ${i + 1} (${step}) lacks ${id} for consume + require.`);
        const remaining = inventory[id] - consumed;
        const produced = recipe.produce[id] ?? 0;
        check(produced <= r.capacity - remaining, `Step ${i + 1} (${step}) exceeds ${id} capacity.`);
        next[id] = remaining + produced;
      }
      inventory = next;
      match(certificate.states[i + 1], inventory, `states[${i + 1}]`);
    }
    match(certificate.final, inventory, 'final');
    const retained = {};
    for (const id of resources.keys()) {
      retained[id] = inventory[id] - (certificate.mode === 'loan' ? (seed[id] ?? 0) : 0);
      check(retained[id] >= 0, `The loan cannot repay ${id}.`);
      check(retained[id] >= (goal[id] ?? 0), `Retained inventory does not meet the goal for ${id}.`);
    }
    match(certificate.retained, retained, 'retained');
    return { valid: true, errors: [], final: inventory, retained };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], final: null, retained: null };
  }
}
