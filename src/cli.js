#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { solve, makeCertificate } from './engine.js';
import { verifyCertificate } from './verify.js';

const help = `Ouroseed — borrow the beginning, return it at the end.

node src/cli.js solve MODEL.json [--mode loan|gift] [--states N] [--candidates N] [--witness FILE]
node src/cli.js verify WITNESS.json

Solve prints JSON. --witness writes the first feasible plan, if one is found.
Verification replays a witness; it does not certify cheapest cost.
Exit codes: 0 optimal / valid; 2 infeasible; 3 inconclusive; 1 invalid input / witness.
`;

try {
  const [command, path, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') { console.log(help); }
  else {
    if (!['solve', 'verify'].includes(command) || !path) throw new Error(help);
    const info = await readFile(path, 'utf8');
    if (info.length > 2_000_000) throw new Error('Input exceeds 2 MB. Use a smaller model or witness.');
    const input = JSON.parse(info);
    if (command === 'verify') {
      if (args.length) throw new Error('verify accepts only a witness filename.');
      const result = verifyCertificate(input);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
    } else {
      const options = {};
      let witnessPath;
      for (let i = 0; i < args.length; i += 2) {
        const flag = args[i], value = args[i + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
        if (flag === '--mode') options.mode = value;
        else if (flag === '--states' || flag === '--candidates') {
          if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} requires a positive integer.`);
          options[flag === '--states' ? 'maxStates' : 'maxCandidates'] = Number(value);
        } else if (flag === '--witness') witnessPath = value;
        else throw new Error(`Unknown option ${flag}`);
      }
      const result = solve(input, options);
      console.log(JSON.stringify(result, null, 2));
      if (witnessPath && result.solutions.length) {
        await writeFile(witnessPath, JSON.stringify(makeCertificate(input, result.solutions[0], options.mode || 'loan'), null, 2) + '\n', { flag: 'wx' });
        console.error(`Wrote witness to ${witnessPath}`);
      } else if (witnessPath) console.error('No feasible witness found; no file written.');
      if (result.status === 'infeasible') process.exitCode = 2;
      if (result.status === 'inconclusive') process.exitCode = 3;
    }
  }
} catch (error) {
  console.error(`Ouroseed: ${error.message}`);
  process.exitCode = 1;
}
