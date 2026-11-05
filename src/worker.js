import { validateModel, solve, analyzeKit } from './engine.js';

self.onmessage = ({ data }) => {
  try {
    const model = validateModel(data.model);
    const options = { maxStates: 20000, maxCandidates: 2048 };
    self.postMessage({ type: 'progress', text: 'Checking the workshop without any borrowed stock…' });
    const baseline = analyzeKit(model, {}, { mode: 'loan', maxStates: options.maxStates });
    const modes = [data.mode, data.mode === 'loan' ? 'gift' : 'loan'];
    const results = {};
    for (const mode of modes) {
      self.postMessage({ type: 'progress', text: mode === 'loan' ? 'Searching for a kit that can be returned in full…' : 'Checking what changes if the starter kit is a gift…' });
      results[mode] = solve(model, { ...options, mode });
    }
    self.postMessage({ type: 'result', results, baseline });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
