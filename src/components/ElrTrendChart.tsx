import type { ElrPosition } from "../lib/types";

const WIDTH = 640;
const HEIGHT = 160;
const PADDING = 24;

/**
 * Deliberately a small inline SVG line, not a charting library — this is
 * the only chart in the app, and pulling in a dependency for one sparkline
 * isn't worth the bundle weight or the extra thing to keep patched.
 */
export default function ElrTrendChart({ history }: { history: ElrPosition[] }) {
  const sorted = [...history].sort(
    (a, b) => new Date(a.financialPeriodEndDate).getTime() - new Date(b.financialPeriodEndDate).getTime(),
  );
  const ratios = sorted.map((p) => p.earnedLossRatio).filter((r): r is number => r !== null);

  if (sorted.length < 2 || ratios.length < 2) {
    return <p className="text-sm text-brand-400">Not enough history yet to plot a trend.</p>;
  }

  const maxRatio = Math.max(...ratios, 0.85) * 1.1;
  const plotWidth = WIDTH - PADDING * 2;
  const plotHeight = HEIGHT - PADDING * 2;

  const points = sorted
    .filter((p) => p.earnedLossRatio !== null)
    .map((p, i, arr) => {
      const x = PADDING + (i / (arr.length - 1)) * plotWidth;
      const y = PADDING + plotHeight - ((p.earnedLossRatio as number) / maxRatio) * plotHeight;
      return { x, y, point: p };
    });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const redY = PADDING + plotHeight - (0.85 / maxRatio) * plotHeight;
  const amberY = PADDING + plotHeight - (0.8 / maxRatio) * plotHeight;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Earned Loss Ratio trend">
      <line x1={PADDING} y1={redY} x2={WIDTH - PADDING} y2={redY} stroke="#C5221F" strokeDasharray="4 4" strokeWidth={1} />
      <line x1={PADDING} y1={amberY} x2={WIDTH - PADDING} y2={amberY} stroke="#B8860B" strokeDasharray="4 4" strokeWidth={1} />
      <path d={pathD} fill="none" stroke="#0D2356" strokeWidth={2} />
      {points.map((p) => (
        <circle key={p.point.financialPeriodEndDate} cx={p.x} cy={p.y} r={3} fill="#0D2356" />
      ))}
    </svg>
  );
}
