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
import { Table2 } from 'lucide-react';
import { Empty, Panel, WIDTH_CLASS } from './shared';
import { cx } from '../../ui';
import { useSafeTheme } from '../DynamicContext';

/**
 * `chart` and `table` — components whose job is to show a dataset.
 *
 * Kept together because they share the same contract: caption, empty state,
 * horizontal scroll on small screens, and a colour scheme that follows the theme
 * rather than a hard-coded palette.
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

/* -------------------------------------------------------------------------- */
/* chart                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A chart is only renderable when every series has data and the label list is
 * non-empty. A pie chart takes its slices from the FIRST series only — that is
 * what the author promised by choosing `pie`, and stacking series into one ring
 * silently misrepresents the data.
 */
export function chartIsRenderable(chart) {
  if (!chart?.labels?.length || !chart?.series?.length) return false;
  return chart.series.some((s) => (s.data || []).some((n) => Number.isFinite(n)));
}

function buildRows(chart) {
  return chart.labels.map((label, index) => {
    const row = { label };
    for (const series of chart.series) row[series.name] = series.data[index];
    return row;
  });
}

function ChartRenderer({ component }) {
  const theme = useChartTheme();
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';

  if (!chartIsRenderable(component)) {
    return (
      <Panel title={component.title} subtitle={component.description} className={width}>
        <Empty label="This chart has no data to plot." />
      </Panel>
    );
  }

  const rows = buildRows(component);
  const height = component.series.length > 2 ? 280 : 240;

  return (
    <Panel title={component.title} subtitle={component.description} className={width}>
      <div className="min-w-0" role="img" aria-label={`${component.chart_type} chart${component.title ? `: ${component.title}` : ''}`}>
        <ResponsiveContainer width="100%" height={height}>
          {component.chart_type === 'pie' ? (
            <PieChart>
              <Tooltip {...theme.tooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={rows} dataKey={component.series[0].name} nameKey="label" innerRadius="45%" outerRadius="78%" paddingAngle={1}>
                {rows.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : component.chart_type === 'line' || component.chart_type === 'area' ? (
            <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={theme.tick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={theme.tick} axisLine={false} tickLine={false} width={44} />
              <Tooltip {...theme.tooltip} />
              {component.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
              {component.series.map((series, index) =>
                component.chart_type === 'area' ? (
                  <Area
                    key={series.name}
                    type="monotone"
                    dataKey={series.name}
                    stroke={series.color || CHART_COLORS[index % CHART_COLORS.length]}
                    fill={series.color || CHART_COLORS[index % CHART_COLORS.length]}
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                ) : (
                  <Line
                    key={series.name}
                    type="monotone"
                    dataKey={series.name}
                    stroke={series.color || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                ),
              )}
            </AreaChart>
          ) : (
            <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={theme.tick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={theme.tick} axisLine={false} tickLine={false} width={44} />
              <Tooltip {...theme.tooltip} />
              {component.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
              {component.series.map((series, index) => (
                <Bar key={series.name} dataKey={series.name} fill={series.color || CHART_COLORS[index % CHART_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={44} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {component.x_label || component.y_label ? (
        <p className="mt-1.5 text-center text-[11px] text-slate-500 dark:text-slate-400">
          {component.x_label ? `x: ${component.x_label}` : ''}
          {component.x_label && component.y_label ? ' · ' : ''}
          {component.y_label ? `y: ${component.y_label}` : ''}
        </p>
      ) : null}

      {/* The same data, available to screen readers and to copy. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          View as a table
        </summary>
        <div className="mt-1.5 overflow-x-auto">
          <table className="table-base text-xs">
            <thead>
              <tr>
                <th scope="col">{component.x_label || 'Label'}</th>
                {component.series.map((s) => (
                  <th key={s.name} scope="col">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.label}</td>
                  {component.series.map((s) => (
                    <td key={s.name}>{row[s.name] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* table                                                                      */
/* -------------------------------------------------------------------------- */

function cellText(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function TableRenderer({ component }) {
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';
  const columns = component.columns || [];
  const rows = component.rows || [];

  if (!columns.length) {
    return (
      <Panel title={component.title} className={width}>
        <Empty label="This table has no columns." icon={Table2} />
      </Panel>
    );
  }

  return (
    <Panel title={component.title} subtitle={component.description} className={width} flush>
      {rows.length ? (
        // Horizontal scrolling is the only correct fallback for a wide table on a
        // phone; squeezing columns to 30px each is not.
        <div className="overflow-x-auto">
          <table className="table-base">
            <caption className="sr-only">{component.caption || component.title || 'Data table'}</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" style={column.align ? { textAlign: column.align } : undefined}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key} style={column.align ? { textAlign: column.align } : undefined}>
                      {cellText(row?.[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3.5">
          <Empty label="This table has no rows." icon={Table2} />
        </div>
      )}
      {component.caption ? <p className={cx('px-3.5 py-2 text-[11px] text-slate-500 dark:text-slate-400')}>{component.caption}</p> : null}
    </Panel>
  );
}

export default function DataRenderer({ component }) {
  if (component.type === 'table') return <TableRenderer component={component} />;
  return <ChartRenderer component={component} />;
}
