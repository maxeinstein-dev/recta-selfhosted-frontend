import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '../../utils/format';
import { longDate, shortDate, type CashFlowPoint } from '../../utils/cashFlow';

interface CashFlowChartProps {
  points: CashFlowPoint[];
  lowest: { date: string; amount: number } | null;
  currency: string;
  /** Text for screen readers: the chart is one image for them. */
  label: string;
}

/** Short money for the axis (1,2 mil), the full one in the tooltip. */
const compact = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/**
 * The balance day by day. The zero line is dashed red, the lowest day has a dot. Built on recharts, like the other
 * charts of the dashboard; the axis keeps few ticks so it reads at 360 px.
 */
export default function CashFlowChart({ points, lowest, currency, label }: CashFlowChartProps) {
  const data = points.map((p) => ({ date: p.date, balance: p.balance }));
  return (
    <div role="img" aria-label={label} className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#9ca3af" strokeOpacity={0.3} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => shortDate(d)}
            interval="preserveStartEnd"
            minTickGap={28}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => compact(v)}
            width={52}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            tickLine={false}
            axisLine={false}
          />
          {/* No text on the zero line: the axis already prints "0" at it, and a label there sat on top of the axis text */}
          <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), currency)}
            labelFormatter={(d) => longDate(String(d))}
          />
          <Area type="monotone" dataKey="balance" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} isAnimationActive={false} />
          {lowest && (
            <ReferenceDot
              x={lowest.date}
              y={lowest.amount}
              r={5}
              fill={lowest.amount < 0 ? '#dc2626' : '#2563eb'}
              stroke="#ffffff"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
