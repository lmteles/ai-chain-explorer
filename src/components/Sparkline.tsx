type Props = { values: number[]; width?: number; height?: number; refLine?: number; colour?: string; label: string };

/** Inline SVG sparkline. The optional reference line is included in the y-range so it is always visible. */
export function Sparkline({ values, width = 120, height = 28, refLine, colour = '#128C7E', label }: Props) {
  if (values.length < 2) return null;
  const all = refLine === undefined ? values : [...values, refLine];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0 overflow-visible">
      {refLine !== undefined && <line x1={0} x2={width} y1={y(refLine)} y2={y(refLine)} stroke="#C05746" strokeDasharray="3 3" strokeWidth={1} />}
      <path d={d} fill="none" stroke={colour} strokeWidth={1.5} />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={2} fill={colour} />
    </svg>
  );
}
