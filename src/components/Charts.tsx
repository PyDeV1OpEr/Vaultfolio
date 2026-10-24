import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AssetCategory, CurrencyCode } from '../lib/types';
import { categoryMeta } from '../lib/categories';
import { compactFormat } from '../lib/money';

const PIE_COLORS = ['#4d8dff', '#7cc4ff', '#f5c26b', '#b58cf5', '#6ce0b1', '#f281a1', '#9aa7bd'];

/** Donut of category allocation. Missing valuations never appear (handled by caller). */
export function AllocationDonut({
  data,
  displayCurrency,
}: {
  data: { category: AssetCategory; valueLkr: number }[];
  displayCurrency: CurrencyCode;
}) {
  const rows = data.map((d) => ({
    ...d,
    name: categoryMeta(d.category).label,
  }));
  return (
    <div className="h-[230px] w-full" role="img" aria-label="Asset allocation by category">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey="valueLkr" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="#0b0f16" strokeWidth={2}>
            {rows.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#0e131c',
              border: '1px solid #232d40',
              borderRadius: 10,
              fontSize: 12,
            }}
            formatter={(value: number) => `${displayCurrency} ${compactFormat(value)}`}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Recorded valuations over time — only real snapshots. */
export function HistoryLine({ data }: { data: { date: string; valueLkr: number }[] }) {
  const rows = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    value: d.valueLkr,
  }));
  return (
    <div className="h-[230px] w-full" role="img" aria-label="Recorded portfolio value over time">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="date" tick={{ fill: '#8b95a8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#232d40' }} />
          <YAxis
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v: number) => compactFormat(v)}
          />
          <Tooltip
            contentStyle={{ background: '#0e131c', border: '1px solid #232d40', borderRadius: 10, fontSize: 12 }}
            formatter={(v: number) => `LKR ${v.toLocaleString('en-US')}`}
          />
          <Line type="monotone" dataKey="value" stroke="#4d8dff" strokeWidth={2} dot={{ r: 3, fill: '#4d8dff' }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
