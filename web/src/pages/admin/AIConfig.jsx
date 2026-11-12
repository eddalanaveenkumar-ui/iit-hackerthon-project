import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Gauge,
  KeyRound,
  Layers,
  Loader2,
  PlugZap,
  RefreshCw,
  Route,
  ShieldAlert,
  Sliders,
  XCircle,
  Zap,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, ErrorBanner, LoadingBlock, ProgressBar, StatCard, Switch, Tabs, cx, useToast } from '../../components/ui';
import { UsageLineChart } from '../../components/charts';
import { timeAgo } from '../../lib/format';

export default function AIConfig() {
  const [tab, setTab] = useState('provider');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api('/ai/admin/overview'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock rows={5} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">AI configuration</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Central control for providers, models, routing and features. Changes apply immediately — no restart required.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={data.provider.health?.ok ? 'success' : 'warning'}>
            <PlugZap className="h-3 w-3" /> {data.provider.health?.ok ? `${data.provider.name} healthy` : `${data.provider.name} · local fallback`}
          </Badge>
          <button onClick={load} className="btn-secondary btn-sm" disabled={busy === 'reload'}>
            {busy === 'reload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'provider', label: 'Provider' },
          { key: 'models', label: 'Models', count: data.models.length },
          { key: 'routing', label: 'Task routing' },
          { key: 'generation', label: 'Generation' },
          { key: 'features', label: 'Features', count: data.features.length },
          { key: 'usage', label: 'Usage' },
          { key: 'health', label: 'Health & logs' },
        ]}
      />

      {tab === 'provider' ? <ProviderTab data={data} onSaved={load} toast={toast} /> : null}
      {tab === 'models' ? <ModelsTab data={data} onChanged={load} toast={toast} setBusy={setBusy} busy={busy} /> : null}
      {tab === 'routing' ? <RoutingTab data={data} onChanged={load} toast={toast} /> : null}
      {tab === 'generation' ? <GenerationTab data={data} onChanged={load} toast={toast} /> : null}
      {tab === 'features' ? <FeaturesTab data={data} onChanged={load} toast={toast} /> : null}
      {tab === 'usage' ? <UsageTab /> : null}
      {tab === 'health' ? <HealthTab data={data} onReload={load} toast={toast} /> : null}
    </div>
  );
}

function ProviderTab({ data, onSaved, toast }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(data.provider.baseUrl);
  const [timeoutMs, setTimeoutMs] = useState(data.provider.timeoutMs);
  const [maxRetries, setMaxRetries] = useState(data.provider.maxRetries);
  const [busy, setBusy] = useState('');
  const [testing, setTesting] = useState(null);

  const save = async () => {
    setBusy('save');
    try {
      await api('/ai/admin/provider', {
        method: 'PUT',
        body: {
          baseUrl,
          timeoutMs: Number(timeoutMs),
          maxRetries: Number(maxRetries),
          ...(apiKey ? { apiKey } : {}),
        },
      });
      setApiKey('');
      toast.success('Provider settings saved — live without restart');
      onSaved();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const clearKey = async () => {
    if (!window.confirm('Remove the stored API key? Requests will fall back to the local analyser.')) return;
    setBusy('clear');
    try {
      await api('/ai/admin/provider', { method: 'PUT', body: { clearApiKey: true } });
      toast.success('Stored API key removed');
      onSaved();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setTesting(null);
    try {
      const res = await api('/ai/admin/provider/test', { method: 'POST' });
      setTesting(res);
      toast[res.ok ? 'success' : 'info'](res.ok ? 'Provider reachable' : res.detail);
    } catch (e) {
      setTesting({ ok: false, detail: e.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad lg:col-span-2 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">NVIDIA NIM configuration</h2>
        </div>
        <div>
          <label className="label">API base URL</label>
          <input className="input font-mono text-xs" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <p className="mt-1 text-[11px] text-slate-400">Default: https://integrate.api.nvidia.com/v1</p>
        </div>
        <div>
          <label className="label">API key</label>
          <input
            type="password"
            className="input font-mono text-xs"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={data.provider.hasApiKey ? `${data.provider.apiKeyPreview} (stored — enter a new key to replace)` : 'nvapi-…'}
            autoComplete="off"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Stored encrypted with AES-256-GCM in the database. It is never returned by the API, never written to logs, and never sent to a
            browser.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Request timeout (ms)</label>
            <input type="number" className="input" min={1000} max={180000} step={1000} value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
          </div>
          <div>
            <label className="label">Retry attempts</label>
            <input type="number" className="input" min={0} max={5} value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={save} className="btn-primary" disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
          </button>
          <button onClick={test} className="btn-secondary" disabled={busy === 'test'}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Test connection
          </button>
          {data.provider.hasApiKey ? (
            <button onClick={clearKey} className="btn-ghost text-rose-600" disabled={busy === 'clear'}>
              Remove stored key
            </button>
          ) : null}
        </div>
        {testing ? (
          <div
            className={cx(
              'rounded-lg border p-3 text-xs',
              testing.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
            )}
          >
            <p className="font-semibold">{testing.ok ? 'Connection healthy' : 'Connection failed'}</p>
            <p className="mt-0.5">{testing.detail}</p>
            {testing.latencyMs ? <p className="mt-0.5">Latency: {testing.latencyMs}ms</p> : null}
            {testing.hasApiKey === false ? <p className="mt-0.5">No API key is stored, so the deterministic local analyser is serving every task. All product workflows remain fully functional.</p> : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="card card-pad">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Status</h2>
          <dl className="mt-2 space-y-2 text-xs">
            <Row label="Credential source" value={data.provider.credentialSource} />
            <Row label="Has API key" value={data.provider.hasApiKey ? 'Yes' : 'No'} />
            <Row label="Provider" value={data.provider.provider} />
            <Row label="Timeout" value={`${data.provider.timeoutMs} ms`} />
            <Row label="Retries" value={data.provider.maxRetries} />
          </dl>
          {!data.provider.hasApiKey ? (
            <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              No provider key is configured. The platform is running the deterministic local analyser so every workflow remains
              functional. Add a key to use NVIDIA NIM models.
            </div>
          ) : null}
        </div>
        <div className="card card-pad">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Architecture</h2>
          <ul className="mt-2 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <li>• Central orchestration service — one entry point for all AI calls</li>
            <li>• Provider adapters (NVIDIA today, others pluggable)</li>
            <li>• Model registry with verified availability</li>
            <li>• Task-based routing, editable without code changes</li>
            <li>• Fallback model + local analyser safety net</li>
            <li>• Usage logging: tokens, latency, cost, failures</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ModelsTab({ data, onChanged, toast, busy, setBusy }) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState(null);

  const verify = async () => {
    setVerifying(true);
    try {
      const res = await api('/ai/admin/models/verify', { method: 'POST' });
      setResult(res);
      toast[res.catalogueReachable ? 'success' : 'error'](res.catalogueReachable ? 'Catalogue verified' : res.detail);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const toggle = async (modelId, enabled) => {
    setBusy?.(modelId);
    try {
      await api(`/ai/admin/models/${encodeURIComponent(modelId)}`, { method: 'PATCH', body: { enabled } });
      toast.success(`${modelId} ${enabled ? 'enabled' : 'disabled'}`);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy?.('');
    }
  };

  const CATEGORY_TONE = { chat: 'brand', reasoning: 'violet', embedding: 'success', rerank: 'success', parse: 'warning', safety: 'danger', coding: 'brand' };

  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Model registry</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Availability is verified against the live provider catalogue — never assumed. Disabled models are skipped by routing.
          </p>
        </div>
        <button onClick={verify} className="btn-primary btn-sm" disabled={verifying}>
          {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />} Verify availability
        </button>
      </div>

      {result ? (
        <div className={cx('card card-pad text-xs', result.catalogueReachable ? 'border-emerald-200 dark:border-emerald-900' : 'border-amber-200 dark:border-amber-900')}>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{result.catalogueReachable ? 'Catalogue reachable' : 'Catalogue not reachable'}</p>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">{result.detail}</p>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Model</th>
                <th>Category</th>
                <th>Availability</th>
                <th>Capabilities</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.modelId}>
                  <td>
                    <p className="font-medium text-slate-800 dark:text-slate-100">{m.displayName}</p>
                    <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{m.modelId}</p>
                    {m.notes ? <p className="mt-0.5 max-w-md text-[11px] text-slate-400">{m.notes}</p> : null}
                  </td>
                  <td>
                    <Badge tone={CATEGORY_TONE[m.category] || 'neutral'}>{m.category}</Badge>
                  </td>
                  <td>
                    <span className="inline-flex flex-col gap-1">
                      <Badge tone={m.availability === 'available' ? 'success' : m.availability === 'unavailable' ? 'danger' : 'warning'}>
                        {m.availability === 'available' ? <CheckCircle2 className="h-3 w-3" /> : m.availability === 'unavailable' ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {m.availability}
                      </Badge>
                      {m.validatedAt ? <span className="text-[10px] text-slate-400">{timeAgo(m.validatedAt)}</span> : null}
                    </span>
                  </td>
                  <td>
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {m.capabilities.slice(0, 4).map((c) => (
                        <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <Switch checked={m.enabled} onChange={(v) => toggle(m.modelId, v)} label="" disabled={busy === m.modelId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RoutingTab({ data, onChanged, toast }) {
  const update = async (task, field, value) => {
    try {
      await api(`/ai/admin/routing/${task}`, { method: 'PATCH', body: { [field]: value } });
      toast.success('Routing updated — active immediately');
      onChanged();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Route className="h-4 w-4 text-slate-400" /> Task → model mapping
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Change which model each capability uses. No source code changes required.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Task</th>
              <th>Primary model</th>
              <th>Fallback</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {data.routing.map((r) => (
              <tr key={r.task}>
                <td>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{r.label}</p>
                  <p className="text-[11px] text-slate-400">{r.description}</p>
                </td>
                <td>
                  <select className="input py-1 text-xs" value={r.model} onChange={(e) => update(r.task, 'model', e.target.value)}>
                    {data.models.filter((m) => m.enabled).map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="input py-1 text-xs" value={r.fallbackModel || ''} onChange={(e) => update(r.task, 'fallbackModel', e.target.value)}>
                    <option value="">None</option>
                    {data.models.filter((m) => m.enabled && m.modelId !== r.model).map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Switch checked={r.enabled} onChange={(v) => update(r.task, 'enabled', v)} label="" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GenerationTab({ data, onChanged, toast }) {
  const [gen, setGen] = useState(data.generation);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api('/ai/admin/generation', { method: 'PUT', body: gen });
      toast.success('Generation parameters saved');
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card card-pad space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Sliders className="h-4 w-4 text-slate-400" /> Global defaults
        </h2>
        <div>
          <label className="label">Temperature ({gen.temperature})</label>
          <input type="range" min={0} max={2} step={0.05} value={gen.temperature} onChange={(e) => setGen({ ...gen, temperature: Number(e.target.value) })} className="w-full accent-brand-600" />
        </div>
        <div>
          <label className="label">Top P ({gen.topP})</label>
          <input type="range" min={0} max={1} step={0.01} value={gen.topP} onChange={(e) => setGen({ ...gen, topP: Number(e.target.value) })} className="w-full accent-brand-600" />
        </div>
        <div>
          <label className="label">Max output tokens</label>
          <input type="number" className="input" min={64} max={16000} value={gen.maxTokens} onChange={(e) => setGen({ ...gen, maxTokens: Number(e.target.value) })} />
        </div>
        <Switch checked={gen.jsonMode} onChange={(v) => setGen({ ...gen, jsonMode: v })} label="Structured JSON responses" description="Ask models for response_format=json_object and repair malformed JSON." />
        <Switch checked={gen.stream} onChange={(v) => setGen({ ...gen, stream: v })} label="Streaming" description="Reserved for streaming transport; the tutor currently returns complete responses." />
        <button onClick={save} className="btn-primary w-full" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save parameters
        </button>
      </div>

      <div className="card card-pad">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Per-model defaults</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Applied when a task override is not set.</p>
        <ul className="mt-3 space-y-2">
          {data.models.map((m) => (
            <li key={m.modelId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-xs dark:border-slate-800">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-700 dark:text-slate-200">{m.displayName}</p>
                <p className="font-mono text-[10px] text-slate-400">{m.modelId}</p>
              </div>
              <span className="shrink-0 text-[11px] text-slate-500">
                t={m.params?.temperature ?? '—'} · p={m.params?.topP ?? '—'} · {m.params?.maxTokens ?? '—'} tok
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FeaturesTab({ data, onChanged, toast }) {
  const toggle = async (key, enabled) => {
    try {
      await api(`/ai/admin/features/${key}`, { method: 'PATCH', body: { enabled } });
      toast.success(`${key} ${enabled ? 'enabled' : 'disabled'}`);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const grouped = data.features.reduce((acc, f) => {
    acc[f.category || 'other'] = acc[f.category || 'other'] || [];
    acc[f.category || 'other'].push(f);
    return acc;
  }, {});

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Object.entries(grouped).map(([category, features]) => (
        <div key={category} className="card card-pad">
          <h2 className="text-sm font-semibold capitalize text-slate-900 dark:text-white">{category}</h2>
          <div className="mt-3 space-y-3.5">
            {features.map((f) => (
              <Switch key={f.key} checked={f.enabled} onChange={(v) => toggle(f.key, v)} label={f.label} description={f.description} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageTab() {
  const [usage, setUsage] = useState(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');

  useEffect(() => {
    setUsage(null);
    api(`/ai/admin/usage?days=${days}`)
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, [days]);

  if (error) return <ErrorBanner message={error} />;
  if (!usage) return <LoadingBlock rows={4} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">AI usage ({usage.rangeDays} days)</h2>
        <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Requests" value={usage.totals.requests} sub={`${usage.totals.successRate}% success`} icon={Activity} />
        <StatCard label="Tokens" value={(usage.totals.inputTokens + usage.totals.outputTokens).toLocaleString()} sub={`${usage.totals.inputTokens.toLocaleString()} in · ${usage.totals.outputTokens.toLocaleString()} out`} icon={Layers} tone="violet" />
        <StatCard label="Estimated cost" value={`$${usage.totals.costUsd.toFixed(4)}`} sub="based on per-model pricing" icon={Gauge} tone="success" />
        <StatCard label="Avg latency" value={`${usage.totals.avgLatencyMs} ms`} sub={`${usage.totals.failures} failed requests`} icon={Zap} tone={usage.totals.failures ? 'warning' : 'brand'} />
      </div>

      <div className="card card-pad">
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Daily requests & tokens</h3>
        <UsageLineChart data={(usage.daily || []).map((d) => ({ ...d, date: d._id ?? d.date }))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">Model-wise usage</p>
          <table className="table-base">
            <thead>
              <tr>
                <th>Model</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {usage.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="max-w-[180px] truncate font-mono text-[11px]">{m.model}</td>
                  <td className="text-xs">{m.requests}</td>
                  <td className="text-xs">{(m.inputTokens + m.outputTokens).toLocaleString()}</td>
                  <td className="text-xs">${m.costUsd.toFixed(4)}</td>
                  <td className="text-xs">{m.avgLatencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.byModel.length === 0 ? <p className="p-4 text-sm text-slate-500">No requests recorded.</p> : null}
        </div>

        <div className="card overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">Feature-wise usage</p>
          <table className="table-base">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Requests</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {usage.byFeature.map((f) => (
                <tr key={f.feature}>
                  <td className="text-xs">{f.feature}</td>
                  <td className="text-xs">{f.requests}</td>
                  <td className="text-xs">{f.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">Classroom-wise usage</p>
          <table className="table-base">
            <thead>
              <tr>
                <th>Classroom</th>
                <th>Requests</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {usage.byClassroom.map((c) => (
                <tr key={c.classroomId}>
                  <td className="text-xs">
                    {c.name} <span className="font-mono text-[10px] text-slate-400">{c.code}</span>
                  </td>
                  <td className="text-xs">{c.requests}</td>
                  <td className="text-xs">{c.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.byClassroom.length === 0 ? <p className="p-4 text-sm text-slate-500">No classroom-scoped requests yet.</p> : null}
        </div>
        <div className="card overflow-hidden">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">Task breakdown</p>
          <table className="table-base">
            <thead>
              <tr>
                <th>Task</th>
                <th>Requests</th>
                <th>Failures</th>
                <th>Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {usage.byTask.map((t) => (
                <tr key={t.task}>
                  <td className="text-xs">{t.task}</td>
                  <td className="text-xs">{t.requests}</td>
                  <td className="text-xs">{t.failures}</td>
                  <td className="text-xs">{t.avgLatencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HealthTab({ data, onReload, toast }) {
  const [logs, setLogs] = useState(null);
  const [health, setHealth] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api('/ai/admin/logs?limit=60')
      .then((r) => setLogs(r.logs))
      .catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const test = async () => {
    setTesting(true);
    try {
      setHealth(await api('/ai/admin/provider/test', { method: 'POST' }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Provider health</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {data.provider.baseUrl} · {data.provider.hasApiKey ? 'key configured' : 'no key — local analyser active'}
            </p>
          </div>
          <button onClick={test} className="btn-secondary btn-sm" disabled={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Run health check
          </button>
        </div>
        {health ? (
          <div className={cx('mt-3 rounded-lg border p-3 text-xs', health.ok ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30')}>
            <p className="font-semibold">
              {health.ok ? 'Healthy' : 'Not reachable'} · {health.provider} · {health.latencyMs}ms
            </p>
            <p className="mt-0.5">{health.detail}</p>
          </div>
        ) : null}
        {data.provider.health && !health ? (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
            Last known: {data.provider.health.ok ? 'healthy' : 'unhealthy'} — {data.provider.health.detail}
          </div>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">Recent AI requests</p>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Task</th>
                <th>Model</th>
                <th>Tokens</th>
                <th>Latency</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(logs || []).map((l) => (
                <tr key={l.id}>
                  <td className="text-xs">{l.task}</td>
                  <td className="max-w-[200px] truncate font-mono text-[11px]">
                    {l.model}
                    {l.simulated ? <Badge tone="warning" className="ml-1">local</Badge> : null}
                  </td>
                  <td className="text-xs">{(l.inputTokens + l.outputTokens).toLocaleString()}</td>
                  <td className="text-xs">{l.latencyMs}ms</td>
                  <td>
                    <Badge tone={l.success ? 'success' : 'danger'}>{l.success ? 'ok' : 'failed'}</Badge>
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-400">{timeAgo(l.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs && logs.length === 0 ? <p className="p-4 text-sm text-slate-500">No AI requests logged yet.</p> : null}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium capitalize text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}
