import { readFileSync } from 'node:fs';
import { validateGraph } from '../src/lib/data/schema';

const g = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const undated = g.relations.filter((r) => !r.as_of).length;
console.log(`entities ${g.entities.length} / relations ${g.relations.length} / metrics ${g.metrics.length} / sources ${g.sources.length} / claims ${g.claims.length}`);
console.log(`undated relations: ${undated} of ${g.relations.length}`);
