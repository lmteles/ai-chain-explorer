import type { Entity } from '../lib/data/schema';

type Props = { trail: string[]; entities: Entity[]; current: string | null; go: (id: string) => void; clear: () => void };

export function Breadcrumb({ trail, entities, current, go, clear }: Props) {
  if (!trail.length) return null;
  const name = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
  return (
    <nav aria-label="Visited companies" className="absolute left-3 top-3 z-10 flex max-w-[90%] flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-xs shadow-sm">
      {trail.map((id, i) => (
        <span key={id} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-400">›</span>}
          <button type="button" onClick={() => go(id)} aria-current={id === current ? 'page' : undefined}
            className={`rounded px-1 hover:bg-slate-100 ${id === current ? 'font-semibold text-[#1B2A4A]' : 'text-slate-600'}`}>
            {name(id)}
          </button>
        </span>
      ))}
      <button type="button" onClick={clear} className="ml-1 text-slate-400 hover:text-slate-700" aria-label="Clear trail">×</button>
    </nav>
  );
}
