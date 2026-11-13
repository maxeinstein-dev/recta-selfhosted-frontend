import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '../../utils/format';
import { monthLabel } from '../../utils/netWorth';

interface NetWorthChartProps {
  series: Array<{ month: string; label: string; total: number }>;
  currency: string;
  /** Text for screen readers: the chart is one image for them. */
  label: string;
}

/** Short money for the axis (1,2 mil), the full one in the tooltip. */
const compact = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** The total month by month, a line on recharts like the other charts of the app. */
export default function NetWorthChart({ series, currency, label }: NetWorthChartProps) {
  return (
    <div role="img" aria-label={label} className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#9ca3af" strokeOpacity={0.3} />
          <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} />
          <YAxis tickFormatter={(v: number) => compact(v)} width={52} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), currency)}
            labelFormatter={(_label, payload) => {
              const month = (payload?.[0]?.payload as { month?: string } | undefined)?.month;
              return month ? monthLabel(month, true) : String(_label);
            }}
          />
          <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
