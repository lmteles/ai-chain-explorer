import { readFileSync, writeFileSync } from 'node:fs';
import { failingTwice } from './runs';

// CI gate: fail the job when any adapter has failed twice in a row; the workflow then opens an issue.
const failing = failingTwice(JSON.parse(readFileSync('public/data/runs.json', 'utf8')));
const body = failing.map((f) => `- **${f.adapter}**: ${f.errors.join('; ') || 'no error text'}`).join('\n');
writeFileSync('.adapter-failures.md', body ? `These adapters failed on their last two runs:\n\n${body}\n\nThe site keeps serving their last stored data. See the /sources page.\n` : '');
console.log(body || 'all adapters healthy (no adapter failed twice in a row)');
process.exit(failing.length ? 1 : 0);
