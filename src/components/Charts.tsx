import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

export const CHART_PALETTE = [
  '#4d8dff', // electric blue
  '#38bdf8', // sky
  '#34d399', // emerald
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#fb7185', // rose
  '#64748b', // slate
];

const TOOLTIP_STYLE = {
  backgroundColor: '#0e131c',
  borderColor: '#232d40',
  borderRadius: '12px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  fontSize: '12px',
  color: '#f2f5fa',
  padding: '8px 12px',
};

/** Donut / Pie chart of portfolio allocation by category */
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
    <div className="h-[250px] w-full" role="img" aria-label="Asset allocation by category">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={rows}
            dataKey="valueLkr"
            nameKey="name"
            innerRadius="58%"
            outerRadius="84%"
            paddingAngle={2.5}
            stroke="#0b0f16"
            strokeWidth={2}
            isAnimationActive={true}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: '#f2f5fa' }}
            formatter={(value: number) => [
              `${displayCurrency} ${compactFormat(value)}`,
              'Estimated Value',
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bar chart of total value by asset category */
export function CategoryBarChart({
  data,
  displayCurrency,
}: {
  data: { category: AssetCategory; valueLkr: number }[];
  displayCurrency: CurrencyCode;
}) {
  const rows = data.map((d) => ({
    name: categoryMeta(d.category).shortLabel,
    fullName: categoryMeta(d.category).label,
    value: d.valueLkr,
  }));

  return (
    <div className="h-[250px] w-full" role="img" aria-label="Total value by asset category">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#1a2232" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#232d40' }}
          />
          <YAxis
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={(v: number) => compactFormat(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: '#f2f5fa' }}
            formatter={(v: number) => [`${displayCurrency} ${compactFormat(v)}`, 'Total Value']}
            labelFormatter={(_, arr) => arr[0]?.payload?.fullName ?? ''}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={true}>
            {rows.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bar chart showing individual top asset holdings */
export function TopAssetsBarChart({
  data,
  displayCurrency,
}: {
  data: { name: string; valueLkr: number; category: AssetCategory }[];
  displayCurrency: CurrencyCode;
}) {
  const rows = data.map((d) => ({
    name: d.name.length > 20 ? `${d.name.slice(0, 18)}…` : d.name,
    fullName: d.name,
    value: d.valueLkr,
  }));

  return (
    <div className="h-[250px] w-full" role="img" aria-label="Individual asset values">
      <ResponsiveContainer>
        <BarChart layout="vertical" data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 12 }}>
          <CartesianGrid stroke="#1a2232" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#232d40' }}
            tickFormatter={(v: number) => compactFormat(v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: '#f2f5fa' }}
            formatter={(v: number) => [`${displayCurrency} ${compactFormat(v)}`, 'Estimated Value']}
            labelFormatter={(_, arr) => arr[0]?.payload?.fullName ?? ''}
          />
          <Bar dataKey="value" fill="#4d8dff" radius={[0, 6, 6, 0]} isAnimationActive={true} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Comparison grouped bar chart: Purchase Cost vs Current Value */
export function CostVsValueChart({
  data,
  displayCurrency,
}: {
  data: { label: string; costLkr: number; valueLkr: number }[];
  displayCurrency: CurrencyCode;
}) {
  return (
    <div className="h-[250px] w-full" role="img" aria-label="Purchase cost vs current value comparison">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#1a2232" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#232d40' }}
          />
          <YAxis
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={(v: number) => compactFormat(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: '#f2f5fa' }}
            formatter={(v: number, name: string) => [
              `${displayCurrency} ${compactFormat(v)}`,
              name === 'costLkr' ? 'Purchase Cost' : 'Current Value',
            ]}
          />
          <Legend
            verticalAlign="top"
            height={28}
            formatter={(value: string) => (
              <span className="text-xs text-txt-muted">
                {value === 'costLkr' ? 'Purchase Cost' : 'Current Value'}
              </span>
            )}
          />
          <Bar dataKey="costLkr" name="costLkr" fill="#5d6779" radius={[4, 4, 0, 0]} isAnimationActive={true} />
          <Bar dataKey="valueLkr" name="valueLkr" fill="#4d8dff" radius={[4, 4, 0, 0]} isAnimationActive={true} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Recorded valuations over time — only genuine historical snapshots */
export function HistoryLine({ data }: { data: { date: string; valueLkr: number }[] }) {
  const rows = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    }),
    value: d.valueLkr,
  }));

  return (
    <div className="h-[250px] w-full" role="img" aria-label="Recorded portfolio value over time">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 12, right: 12, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4d8dff" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#4d8dff" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1a2232" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#232d40' }}
          />
          <YAxis
            tick={{ fill: '#8b95a8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={(v: number) => compactFormat(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: '#f2f5fa' }}
            formatter={(v: number) => [`LKR ${v.toLocaleString('en-US')}`, 'Recorded Value']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#4d8dff"
            strokeWidth={2.5}
            fillOpacity={1}
            fill="url(#valGrad)"
            isAnimationActive={true}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
