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
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTheme } from '../contexts/ThemeContext';

function useAxis() {
  const { theme } = useTheme();
  const tick = { fill: theme === 'dark' ? '#94a3b8' : '#64748b', fontSize: 11 };
  const grid = theme === 'dark' ? '#1e293b' : '#e2e8f0';
  const tooltip = {
    contentStyle: {
      background: theme === 'dark' ? '#0f172a' : '#ffffff',
      border: `1px solid ${theme === 'dark' ? '#1e293b' : '#e2e8f0'}`,
      borderRadius: 8,
      fontSize: 12,
      color: theme === 'dark' ? '#e2e8f0' : '#0f172a',
    },
    labelStyle: { color: theme === 'dark' ? '#94a3b8' : '#64748b', fontSize: 11 },
  };
  return { tick, grid, tooltip };
}

export function MasteryTrendChart({ data, height = 220 }) {
  const { tick, grid, tooltip } = useAxis();
  if (!data?.length) return <ChartEmpty height={height} label="No learning history yet" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="masteryFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...tooltip} />
        <Area type="monotone" dataKey="masteryScore" name="Mastery" stroke="#2563eb" strokeWidth={2} fill="url(#masteryFill)" />
        <Line type="monotone" dataKey="independenceScore" name="Independence" stroke="#059669" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ConceptMasteryBar({ data, height = 260 }) {
  const { tick, grid, tooltip } = useAxis();
  if (!data?.length) return <ChartEmpty height={height} label="No concept evidence yet" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={{ ...tick, fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltip} formatter={(v) => [`${Math.round(v)}%`, 'Mastery']} />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={12}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color || '#2563eb'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SkillRadar({ data, height = 260 }) {
  const { tick, grid, tooltip } = useAxis();
  if (!data?.length) return <ChartEmpty height={height} label="Skill profile appears after evidence" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={grid} />
        <PolarAngleAxis dataKey="skill" tick={{ ...tick, fontSize: 10 }} />
        <Radar name="Score" dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.25} />
        <Tooltip {...tooltip} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function WeaknessPie({ data, height = 220 }) {
  const { tooltip } = useAxis();
  const filtered = (data || []).filter((d) => d.value > 0);
  if (!filtered.length) return <ChartEmpty height={height} label="No open weaknesses detected" />;
  const colors = ['#7c3aed', '#e11d48', '#d97706', '#ea580c'];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={filtered} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="80%" paddingAngle={2}>
          {filtered.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Tooltip {...tooltip} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ActivityChart({ data, height = 220 }) {
  const { tick, grid, tooltip } = useAxis();
  if (!data?.length) return <ChartEmpty height={height} label="No activity recorded yet" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={tick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (v ? String(v).slice(5) : '')}
        />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
        <Tooltip {...tooltip} />
        <Bar dataKey="sessions" name="Sessions" fill="#2563eb" radius={[3, 3, 0, 0]} barSize={12} stackId="a" />
        <Bar dataKey="assessments" name="Assessments" fill="#7c3aed" radius={[3, 3, 0, 0]} barSize={12} stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function UsageLineChart({ data, height = 200 }) {
  const { tick, grid, tooltip } = useAxis();
  if (!data?.length) return <ChartEmpty height={height} label="No AI usage recorded yet" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => String(v).slice(5)} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
        <Tooltip {...tooltip} />
        <Line type="monotone" dataKey="requests" stroke="#2563eb" strokeWidth={2} dot={false} name="Requests" />
        <Line type="monotone" dataKey="tokens" stroke="#7c3aed" strokeWidth={2} dot={false} name="Tokens" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ScoreLineChart({ data, height = 180 }) {
  const { tick, grid, tooltip } = useAxis();
  if (!data?.length) return <ChartEmpty height={height} label="No assessments yet" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...tooltip} formatter={(v) => [`${Math.round(v)}%`, 'Score']} />
        <Line type="monotone" dataKey="percentage" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ height, label }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500"
      style={{ height }}
    >
      {label}
    </div>
  );
}
