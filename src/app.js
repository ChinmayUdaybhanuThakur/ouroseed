import { validateModel, makeCertificate } from './engine.js';
import { verifyCertificate } from './verify.js';

const $ = id => document.getElementById(id);
const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};
const examples = [
  ['locked-workshop.json', 'The locked workshop'],
  ['shared-consumable.json', 'The shared consumable trap'],
  ['borrowed-battery.json', 'A battery you cannot return'],
  ['regenerative-starter.json', 'A starter you can repay'],
];
const FILE_LIMIT = 1024 * 1024;
let model = null;
let mode = 'loan';
let worker = null;
let wallTimer = null;
let generation = 0;
let results = null;
let selectedSolution = null;
let certificate = null;
let scenarioGeneration = 0;
let dirty = false;

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function stopWorker() {
  generation += 1;
  if (worker) worker.terminate();
  worker = null;
  clearTimeout(wallTimer);
  wallTimer = null;
  $('cancel').hidden = true;
  $('run').disabled = !model || dirty;
}

function badge(text, kind = '') {
  $('result-badge').textContent = text;
  $('result-badge').className = `badge ${kind}`;
}

function placeholder(title, text) {
  const empty = el('div', 'empty-state');
  const orbit = el('span', 'empty-orbit', '↻');
  orbit.setAttribute('aria-hidden', 'true');
  empty.append(orbit, el('h3', '', title), el('p', '', text));
  $('results').replaceChildren(empty);
  $('results').hidden = false;
  $('plan').hidden = true;
}

function clearResults(message = 'Run the model to find a starter kit.') {
  stopWorker();
  results = null;
  selectedSolution = null;
  certificate = null;
  $('download-witness').disabled = true;
  $('baseline').textContent = 'Run the model to check whether the initial stock is enough.';
  $('bounds-note').textContent = 'Finite inventory and borrowing caps define the search domain. A stopped search is not a proof of impossibility.';
  $('run-status').textContent = message;
  badge('READY TO EXPLORE');
  placeholder('Every beginning has a cost.', message);
}

function labelFor(id) {
  return model.resources.find(resource => resource.id === id)?.label || id;
}

function stockText(stock, empty = 'None') {
  const parts = Object.entries(stock || {}).filter(([, amount]) => amount > 0).map(([id, amount]) => `${amount} × ${labelFor(id)}`);
  return parts.length ? parts.join(' + ') : empty;
}

function summaryRow(label, text) {
  const row = el('div', 'summary-row');
  row.append(el('span', '', label), el('strong', '', text));
  return row;
}

function renderModel() {
  $('scenario-description').textContent = model.description || '';
  $('model-summary').replaceChildren(
    summaryRow('Target to keep', stockText(model.goal)),
    summaryRow('Initial stock', stockText(Object.fromEntries(model.resources.map(r => [r.id, r.initial])))),
    summaryRow('This world', `${model.resources.length} items · ${model.recipes.length} recipes`),
  );
  $('model-json').value = JSON.stringify(model, null, 2);
  $('recipes').replaceChildren(...model.recipes.map((recipe, index) => {
    const card = el('article', 'recipe-card');
    card.append(el('span', 'recipe-index', `RECIPE ${String(index + 1).padStart(2, '0')}`), el('h3', '', recipe.label || recipe.id));
    for (const [name, values] of [['Requires', recipe.require], ['Consumes', recipe.consume], ['Produces', recipe.produce]]) {
      const line = el('div', 'recipe-rule');
      line.append(el('span', '', name), el('span', '', stockText(values)));
      card.append(line);
    }
    return card;
  }));
  $('download-model').disabled = false;
  $('run').disabled = false;
}

function setModel(raw) {
  const nextModel = validateModel(raw);
  clearResults();
  model = nextModel;
  dirty = false;
  showError('');
  renderModel();
}

function parseJson(text) {
  if (text.length > FILE_LIMIT) throw new Error('This file is too large. Open a model or witness smaller than 1 MB.');
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`This is not valid JSON: ${error.message}`); }
}

async function loadScenario(filename) {
  const thisLoad = ++scenarioGeneration;
  clearResults('Loading the selected model…');
  model = null;
  $('download-model').disabled = true;
  $('run').disabled = true;
  try {
    const response = await fetch(`./examples/${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error(`Could not load the example (${response.status}).`);
    const raw = parseJson(await response.text());
    if (thisLoad !== scenarioGeneration) return;
    setModel(raw);
    $('scenario').querySelector('option[value="custom"]')?.remove();
    run();
  } catch (error) {
    if (thisLoad !== scenarioGeneration) return;
    showError(error.message);
    $('run-status').textContent = 'The example did not load.';
    $('run').disabled = !model || dirty;
  }
}

function run() {
  if (!model || dirty) return;
  clearResults('Searching the bounded model…');
  showError('');
  badge('SEARCHING');
  placeholder('Finding a returnable beginning.', 'Each candidate kit is checked against the recipes, one inventory state at a time.');
  $('run').disabled = true;
  $('cancel').hidden = false;
  const thisRun = generation;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  wallTimer = setTimeout(() => {
    if (thisRun !== generation) return;
    stopWorker();
    badge('INCOMPLETE', 'warning');
    placeholder('The search needs more room.', 'Stopped after 10 seconds to keep the page responsive. No conclusion about feasibility or minimum cost was reached. Try a smaller model.');
    $('run-status').textContent = 'Time limit reached. No result claimed.';
  }, 10000);
  worker.onmessage = ({ data }) => {
    if (thisRun !== generation) return;
    if (data.type === 'progress') {
      $('run-status').textContent = data.text;
      return;
    }
    if (data.type === 'error') {
      stopWorker();
      showError(data.message);
      badge('CHECK THE MODEL', 'warning');
      placeholder('This model could not be searched.', 'Read the validation message, edit the model, then try again.');
      $('run-status').textContent = 'Search stopped with an error.';
      return;
    }
    if (data.type === 'result') {
      stopWorker();
      results = data.results;
      renderResults(data.baseline);
    }
  };
  worker.onerror = event => {
    if (thisRun !== generation) return;
    stopWorker();
    showError(event.message || 'The search worker could not start. Serve the project through its local web server.');
    badge('SEARCH ERROR', 'warning');
    placeholder('The planner could not finish.', 'The error is shown beside the model. No result has been claimed.');
    $('run-status').textContent = 'Search error.';
  };
  worker.postMessage({ model, mode });
}

function costCard(key, result) {
  const card = el('div', `cost-card${key === mode ? ' selected' : ''}`);
  card.append(el('span', 'eyebrow', key === 'loan' ? 'BORROW & RETURN' : 'KEEP AS A GIFT'));
  let label = 'Not found';
  let detail = 'No feasible kit within the declared bounds.';
  if (result.status === 'inconclusive') {
    label = 'Unresolved';
    detail = 'Search limit reached; minimum cost is unknown.';
  }
  if (result.status === 'optimal' && result.solutions.length) {
    const value = el('div', 'cost-value', String(result.solutions[0].cost));
    value.append(el('small', '', 'cost units'));
    card.append(value);
    detail = 'Lowest cost in this bounded model.';
  } else card.append(el('div', 'cost-value textual', label));
  card.append(el('p', 'fine', detail));
  return card;
}

function renderResults(baseline) {
  const current = results[mode];
  $('results').hidden = true;
  $('plan').hidden = false;
  $('comparison').replaceChildren(costCard('loan', results.loan), costCard('gift', results.gift));
  const stats = current.stats || {};
  $('run-status').textContent = `${stats.candidates ?? 0} candidate kits checked · ${stats.states ?? 0} inventory states explored in selected mode.`;
  $('baseline').textContent = baseline.status === 'reachable'
    ? 'Yes. The initial stock can reach the target without borrowing anything.'
    : baseline.status === 'unreachable'
      ? 'No. Exhaustive search found no route from the initial stock to the target within these capacities.'
      : 'Unknown. The zero-kit search reached its computation limit.';
  $('bounds-note').textContent = 'Results use the listed item capacities and seed limits. Each kit allows at most 20,000 explored states; at most 2,048 kits are evaluated per mode. Incomplete searches remain unresolved.';
  if (current.status === 'optimal') {
    badge('MINIMUM FOUND');
    const loan = results.loan;
    const gift = results.gift;
    if (loan.status === 'optimal' && gift.status === 'optimal') {
      const difference = loan.solutions[0].cost - gift.solutions[0].cost;
      $('verdict-note').textContent = difference === 0
        ? 'Repayment is possible at the same minimum starter cost as a gift. Follow the trace to see how.'
        : `Returning the kit adds ${difference} cost ${difference === 1 ? 'unit' : 'units'} to the cheapest beginning. The extra stock must be recoverable.`;
    } else $('verdict-note').textContent = mode === 'loan' ? 'A legal route reaches the target and leaves enough stock to repay the entire kit.' : 'A legal route reaches the target. Gift mode does not reserve stock for repayment.';
  } else if (current.status === 'infeasible') {
    badge('NO KIT IN BOUNDS', 'error-badge');
    $('verdict-note').textContent = current.reason || 'No allowed starter kit can satisfy this mode within the model’s inventory capacities. This says nothing about larger or different models.';
  } else {
    badge('INCOMPLETE', 'warning');
    $('verdict-note').textContent = current.reason || 'The search reached a computation limit. Any listed witnesses are feasible candidates; their optimality is not established.';
  }
  const solutions = current.solutions || [];
  $('kit-count').textContent = solutions.length ? `${solutions.length} ${current.status === 'optimal' ? 'CHEAPEST' : 'FOUND'} ${solutions.length === 1 ? 'KIT' : 'KITS'}` : 'NO WITNESS';
  $('kits').replaceChildren();
  $('trace-area').hidden = !solutions.length;
  if (!solutions.length) {
    $('kits').append(el('p', 'fine', current.status === 'infeasible' ? 'Try changing the target, recipes, or borrowing limits.' : 'Try reducing the model or the borrowing limits, then run again.'));
    return;
  }
  solutions.forEach((solution, index) => {
    const button = el('button', 'kit');
    button.type = 'button';
    button.append(el('span', '', stockText(solution.seed, 'No starter kit needed')), el('small', '', `${solution.cost} cost units · ${solution.steps.length} recipe steps`));
    button.addEventListener('click', () => selectKit(index));
    $('kits').append(button);
  });
  selectKit(0);
}

function selectKit(index) {
  selectedSolution = results[mode].solutions[index];
  [...$('kits').children].forEach((button, position) => {
    button.classList.toggle('active', position === index);
    button.setAttribute('aria-pressed', String(position === index));
  });
  certificate = null;
  $('download-witness').disabled = true;
  try {
    const candidate = makeCertificate(model, selectedSolution, mode);
    const checked = verifyCertificate(candidate);
    if (!checked.valid) throw new Error(checked.errors.join('; '));
    certificate = candidate;
    $('download-witness').disabled = false;
    $('witness-status').textContent = '✓ This witness passes the separate feasibility verifier. Minimum cost comes from the completed search.';
    if (results[mode].status !== 'optimal') $('witness-status').textContent = '✓ This witness is feasible. The incomplete search has not established minimum cost.';
  } catch (error) {
    $('witness-status').textContent = `Verification failed: ${error.message}`;
  }
  const labels = ['Start', ...selectedSolution.steps.map(id => model.recipes.find(recipe => recipe.id === id)?.label || id)];
  if (mode === 'loan') labels.push('Return the kit');
  $('trace').replaceChildren(...labels.map((label, position) => {
    const button = el('button', 'trace-step', `${position === 0 ? '○' : position}  ${label}`);
    button.type = 'button';
    button.title = label;
    button.addEventListener('click', () => showStep(position));
    return button;
  }));
  $('scrubber').max = String(labels.length - 1);
  $('scrubber').value = '0';
  showStep(0);
}

function showStep(position) {
  if (!selectedSolution) return;
  const end = Number($('scrubber').max);
  position = Math.max(0, Math.min(end, position));
  $('scrubber').value = String(position);
  [...$('trace').children].forEach((button, index) => {
    button.classList.toggle('active', position === index);
    button.classList.toggle('finished', index < position);
    button.setAttribute('aria-pressed', String(position === index));
  });
  $('step-label').textContent = `${String(position).padStart(2, '0')} / ${String(end).padStart(2, '0')}`;
  const returned = mode === 'loan' && position === end;
  const inventory = returned ? selectedSolution.retained : selectedSolution.states[position];
  if (returned) $('step-description').textContent = `Return ${stockText(selectedSolution.seed, 'nothing')}. The remaining workbench stock meets the target.`;
  else if (position === 0) $('step-description').textContent = mode === 'loan'
    ? `Start with the workshop’s own stock and borrow ${stockText(selectedSolution.seed, 'nothing')}. The shaded quantities must eventually be returned.`
    : `Start with the workshop’s own stock and receive ${stockText(selectedSolution.seed, 'nothing')} as a gift.`;
  else {
    const recipe = model.recipes.find(item => item.id === selectedSolution.steps[position - 1]);
    $('step-description').textContent = `${recipe.label || recipe.id}: consume ${stockText(recipe.consume, 'nothing')}; produce ${stockText(recipe.produce, 'nothing')}. Reusable requirements remain available.`;
  }
  $('inventory').replaceChildren(...model.resources.map(resource => {
    const quantity = inventory[resource.id] || 0;
    const owed = mode === 'loan' && !returned ? selectedSolution.seed[resource.id] || 0 : 0;
    const row = el('div', 'inventory-row');
    const track = el('div', 'inventory-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('div', 'inventory-fill');
    fill.style.width = `${resource.capacity ? Math.min(100, quantity / resource.capacity * 100) : 0}%`;
    if (owed && quantity) {
      const debt = el('div', 'inventory-owed');
      debt.style.width = `${Math.min(100, owed / quantity * 100)}%`;
      fill.append(debt);
    }
    track.append(fill);
    const count = el('div', 'inventory-quantity', `${quantity} / ${resource.capacity}`);
    count.append(el('small', '', owed ? `${owed} owed${owed > quantity ? ' · short' : ''}` : returned ? 'after return' : 'available'));
    row.append(el('span', 'inventory-name', resource.label || resource.id), track, count);
    return row;
  }));
}

function downloadJson(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = el('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readFile(input) {
  const file = input.files?.[0];
  if (!file) return null;
  if (file.size > FILE_LIMIT) throw new Error('Choose a JSON file smaller than 1 MB.');
  return parseJson(await file.text());
}

$('scenario').addEventListener('change', () => {
  if ($('scenario').value && $('scenario').value !== 'custom') loadScenario($('scenario').value);
});
for (const key of ['loan', 'gift']) $('mode-' + key).addEventListener('click', () => {
  if (mode === key) return;
  mode = key;
  for (const other of ['loan', 'gift']) {
    $('mode-' + other).classList.toggle('active', other === mode);
    $('mode-' + other).setAttribute('aria-pressed', String(other === mode));
  }
  $('mode-help').textContent = mode === 'loan'
    ? 'Finish with your target stock plus everything you borrowed. Return the kit; keep the target.'
    : 'The starter kit is yours to use up. Finish with your target stock; no repayment is required.';
  $('result-title').textContent = mode === 'loan' ? 'A beginning you can give back' : 'A beginning you can keep';
  clearResults(dirty ? 'Apply the edited model before running.' : 'Mode changed. Checking the new experiment…');
  if (!dirty) run();
});
$('run').addEventListener('click', run);
$('cancel').addEventListener('click', () => {
  stopWorker();
  badge('CANCELLED', 'warning');
  placeholder('Search cancelled.', 'No feasibility or minimum-cost conclusion has been claimed. Run again whenever you are ready.');
  $('run-status').textContent = 'Cancelled. No result claimed.';
});
$('scrubber').addEventListener('input', () => showStep(Number($('scrubber').value)));
$('model-json').addEventListener('input', () => {
  dirty = true;
  clearResults('Unapplied edits. Apply the model before running.');
  $('download-model').disabled = true;
});
$('apply-model').addEventListener('click', () => {
  try {
    ++scenarioGeneration;
    setModel(parseJson($('model-json').value));
    const custom = $('scenario').querySelector('option[value="custom"]');
    if (!custom) {
      const option = el('option', '', 'Your custom model');
      option.value = 'custom';
      $('scenario').append(option);
    }
    $('scenario').value = 'custom';
    run();
  } catch (error) { showError(error.message); }
});
$('import-model').addEventListener('change', async event => {
  try {
    const raw = await readFile(event.target);
    if (!raw) return;
    ++scenarioGeneration;
    setModel(raw);
    if (!$('scenario').querySelector('option[value="custom"]')) {
      const option = el('option', '', 'Your custom model');
      option.value = 'custom';
      $('scenario').append(option);
    }
    $('scenario').value = 'custom';
    run();
  } catch (error) { showError(error.message); }
  finally { event.target.value = ''; }
});
$('download-model').addEventListener('click', () => {
  if (model && !dirty) downloadJson(model, 'ouroseed-model.json');
});
$('download-witness').addEventListener('click', () => {
  if (certificate && !dirty) downloadJson(certificate, `ouroseed-${mode}-witness.json`);
});
$('import-witness').addEventListener('change', async event => {
  $('verify-status').classList.remove('invalid');
  try {
    const raw = await readFile(event.target);
    if (!raw) return;
    const verified = verifyCertificate(raw);
    if (!verified.valid) throw new Error(verified.errors.join('; '));
    $('verify-status').textContent = '✓ Valid witness. Every transition, the target, and the repayment rule check out. This does not establish minimum cost.';
  } catch (error) {
    $('verify-status').textContent = `Invalid witness: ${error.message}`;
    $('verify-status').classList.add('invalid');
  } finally { event.target.value = ''; }
});

$('scenario').replaceChildren(...examples.map(([file, label]) => {
  const option = el('option', '', label);
  option.value = file;
  return option;
}));
$('download-model').disabled = true;
$('download-witness').disabled = true;
$('run').disabled = true;
loadScenario(examples[0][0]);
