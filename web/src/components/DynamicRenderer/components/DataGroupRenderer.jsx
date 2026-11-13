import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Empty, Panel, WIDTH_CLASS } from './shared';
import { cx } from '../../ui';
import { useSafeTheme } from '../DynamicContext';

/**
 * `data` — a chart and/or a table describing one dataset
 * ======================================================
 *
 * The authoring shape is column-oriented: the chart names an `x_key` and a
 * `y_key` and carries `data: [{ month: "Jan", users: 120 }, …]`. That is far
 * easier for a model to get right than the older parallel-arrays `chart`
 * component, and it maps onto a table without any translation.
 *
 * Both children are *read-only visualisations*. Nothing here executes, and the
 * numbers are rendered as text, so a hostile value is just a strange number.
 */

const CHART_COLORS = ['#2563eb', '#059669', '#7c3aed', '#ea580c', '#0891b2', '#db2777'];

function useChartTheme() {
  const { theme } = useSafeTheme();
  const dark = theme === 'dark';
  return {
    tick: { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 },
    grid: dark ? '#1e293b' : '#e2e8f0',
    tooltip: {
      contentStyle: {
        background: dark ? '#0f172a' : '#ffffff',
        border: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`,
        borderRadius: 8,
        fontSize: 12,
        color: dark ? '#e2e8f0' : '#0f172a',
      },
      labelStyle: { color: dark ? '#94a3b8' : '#64748b', fontSize: 11 },
    },
  };
}

/** Coerce a cell to a finite number or null. Never `NaN`, which breaks the axis. */
function toNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function KeyedChart({ item }) {
  const theme = useChartTheme();
  const rows = (item.data || []).filter((row) => row && typeof row === 'object');
  const xKey = item.x_key;
  const yKey = item.y_key;

  if (!rows.length) return <Empty label="This chart has no data." />;
  if (!xKey || !yKey) return <Empty label="This chart is missing its axis keys." />;

  // Drop rows whose y value is not a number: a bar of NaN renders as a zero
  // bar, which would silently misrepresent the data.
  const points = rows
    .map((row) => ({ label: String(row[xKey] ?? ''), value: toNumber(row[yKey]) }))
    .filter((point) => point.value !== null);

  if (!points.length) return <Empty label="This chart has no numeric values to plot." />;

  const chartType = item.chart_type || 'bar';
  const height = 240;

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
      <XAxis dataKey="label" tick={theme.tick} stroke={theme.grid} interval="preserveStartEnd" />
      <YAxis tick={theme.tick} stroke={theme.grid} width={40} />
      <Tooltip {...theme.tooltip} />
    </>
  );

  return (
    <figure className="w-full">
      {item.title ? (
        <figcaption className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{item.title}</figcaption>
      ) : null}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          {chartType === 'line' ? (
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          ) : chartType === 'area' ? (
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              <Area type="monotone" dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.2} />
            </AreaChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <Tooltip {...theme.tooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={points} dataKey="value" nameKey="label" outerRadius="75%" label={false}>
                {points.map((point, index) => (
                  <Cell key={point.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={CHART_COLORS[0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {item.description ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{item.description}</p> : null}
    </figure>
  );
}

function DataTable({ item }) {
  const columns = item.columns || [];
  const rows = item.rows || [];
  if (!columns.length) return <Empty label="This table has no columns." />;

  return (
    <div className="w-full">
      {item.title ? <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{item.title}</p> : null}
      {/* Tables overflow horizontally rather than squashing on a phone. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[320px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col" className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/50 dark:border-slate-700 dark:odd:bg-slate-900 dark:even:bg-slate-800/30">
                {columns.map((_, cellIndex) => {
                  const value = row?.[cellIndex];
                  return (
                    <td key={cellIndex} className="px-3 py-2 align-top text-slate-700 dark:text-slate-200">
                      {value === null || value === undefined ? <span className="text-slate-300 dark:text-slate-600">—</span> : String(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {item.description ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{item.description}</p> : null}
    </div>
  );
}

export default function DataGroupRenderer({ component }) {
  const items = component.components || [];
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';

  if (!items.length) return <Empty label="This data block has nothing to show." />;

  const charts = items.filter((item) => item.type === 'chart');
  const tables = items.filter((item) => item.type === 'table');
  // Side by side only when there is one of each; otherwise stack, because a
  // chart next to a wide table is unreadable below ~900px.
  const sideBySide = charts.length === 1 && tables.length === 1;

  return (
    <Panel title={component.title} className={width}>
      <div className={cx('grid gap-5', sideBySide ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>
        {charts.map((item, index) => <KeyedChart key={item.id || `chart-${index}`} item={item} />)}
        {tables.map((item, index) => <DataTable key={item.id || `table-${index}`} item={item} />)}
      </div>
    </Panel>
  );
}
