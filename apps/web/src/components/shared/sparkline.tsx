import { Area, AreaChart, ResponsiveContainer } from 'recharts';

/** Tiny area chart, no axes (docs/11 §5 - 13d health rows). */
export function Sparkline({
  data,
  height = 32,
  stroke = 'var(--color-info)',
}: {
  data: number[];
  height?: number;
  stroke?: string;
}) {
  const points = data.map((y, i) => ({ i, y }));
  return (
    <div style={{ height }} className="w-full min-w-16" data-testid="sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="y"
            stroke={stroke}
            strokeWidth={1.5}
            fill={stroke}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
