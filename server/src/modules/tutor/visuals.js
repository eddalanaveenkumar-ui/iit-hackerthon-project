/**
 * Visual explanation blocks.
 *
 * The tutor explains concepts in two registers at once: prose to read, and a
 * rendered visual to *see*. This module produces the second one.
 *
 * Two paths, same output contract:
 *
 *  1. Model path — when an NVIDIA key is configured, the tutoring prompt asks
 *     for `visuals` alongside the reply, and the model's blocks are validated
 *     and normalised here.
 *  2. Deterministic path — when there is no key (or the model returns no usable
 *     visuals), a block is derived from the syllabus concept and retrieval
 *     chunks. This is why visual explanation never degrades into "unavailable".
 *
 * The client renders `kind` with a small set of primitives — it never evaluates
 * arbitrary markup, so a misbehaving model cannot inject HTML into a lesson.
 *
 * Block kinds
 *   flow        ordered stages with an optional return edge (loops, pipelines)
 *   compare     two or three columns compared across attributes (list vs tuple)
 *   steps       numbered procedure
 *   code        annotated code sample
 *   hierarchy   parent/child tree (syllabus structure, taxonomy)
 *   table       lightweight attribute table
 */

const MAX_BLOCKS = 3;
const MAX_NODES = 10;

const KINDS = new Set(['flow', 'compare', 'steps', 'code', 'hierarchy', 'table']);

const str = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanList(value, max, mapper) {
  return (Array.isArray(value) ? value : []).slice(0, max).map(mapper).filter(Boolean);
}

/**
 * Validate one model-authored block. Returns null when the block is unusable —
 * a malformed visual is dropped rather than rendered half-broken.
 */
export function normaliseVisualBlock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  const title = str(raw.title, 120);
  const caption = str(raw.caption, 240);

  if (kind === 'flow') {
    const nodes = cleanList(raw.nodes, MAX_NODES, (n) => {
      if (!n) return null;
      if (typeof n === 'string') return { label: str(n, 80), detail: '' };
      const label = str(n.label ?? n.title, 80);
      return label ? { label, detail: str(n.detail ?? n.description, 160) } : null;
    });
    if (nodes.length < 2) return null;
    return {
      kind,
      title: title || 'How it flows',
      caption,
      nodes,
      loop: Boolean(raw.loop),
    };
  }

  if (kind === 'compare') {
    const columns = cleanList(raw.columns, 3, (c) => {
      if (!c) return null;
      const name = str(c.name ?? c.title, 60);
      if (!name) return null;
      return { name, items: cleanList(c.items ?? c.points, 6, (i) => (typeof i === 'string' ? str(i, 160) : str(i?.text, 160))) };
    });
    if (columns.length < 2) return null;
    return { kind, title: title || 'Side by side', caption, columns };
  }

  if (kind === 'steps') {
    const steps = cleanList(raw.steps, MAX_NODES, (s) => {
      if (!s) return null;
      if (typeof s === 'string') return { label: str(s, 200), detail: '' };
      const label = str(s.label ?? s.title ?? s.text, 200);
      return label ? { label, detail: str(s.detail, 200) } : null;
    });
    if (steps.length < 2) return null;
    return { kind, title: title || 'Step by step', caption, steps };
  }

  if (kind === 'code') {
    const code = String(raw.code ?? '').slice(0, 2000);
    if (!code.trim()) return null;
    return {
      kind,
      title: title || 'Example',
      caption,
      language: str(raw.language, 20) || 'plaintext',
      code,
      annotations: cleanList(raw.annotations, 5, (a) => (typeof a === 'string' ? str(a, 200) : str(a?.text, 200))),
    };
  }

  if (kind === 'hierarchy') {
    const root = raw.root && typeof raw.root === 'object' ? raw.root : null;
    if (!root) return null;
    const build = (node, depth) => {
      if (!node || depth > 2) return null;
      const label = str(node.label ?? node.name, 80);
      if (!label) return null;
      return {
        label,
        children: cleanList(node.children, 6, (c) => build(c, depth + 1)),
      };
    };
    const tree = build(root, 0);
    if (!tree) return null;
    return { kind, title: title || 'Structure', caption, root: tree };
  }

  // table
  const headers = cleanList(raw.headers, 4, (h) => str(h, 60));
  const rows = cleanList(raw.rows, 8, (r) => cleanList(r, 4, (c) => str(c, 120)));
  if (headers.length < 2 || rows.length < 1) return null;
  return { kind, title: title || 'Comparison table', caption, headers, rows };
}

export function normaliseVisuals(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_BLOCKS).map(normaliseVisualBlock).filter(Boolean);
}

/** Split a concept name/description into the phrases a slide should show. */
function phrases(text) {
  return String(text || '')
    .split(/[\n;•]|(?<=\.)\s+/)
    .map((s) => s.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter((s) => s.length > 3);
}

/**
 * Deterministic visual builder.
 *
 * Builds from what we actually know: the concept, its objectives, its subtopics,
 * its keywords and the ranked syllabus chunks. Different block types are chosen
 * based on the shape of that evidence, so the same concept always produces the
 * same visual (stable across renders and safe for tests).
 */
export function buildFallbackVisuals({ concept = {}, subtopics = [], chunks = [], mode = 'learn' } = {}) {
  const blocks = [];
  const name = concept.name || 'this concept';
  const objectives = (concept.objectives || []).filter(Boolean);
  const keywords = (concept.keywords || []).filter(Boolean);
  const subtopicNames = subtopics.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
  const chunkText = chunks.map((c) => String(c.text || '')).join('\n');

  // 1. Structure: always useful, and the syllabus genuinely has this shape.
  if (subtopicNames.length >= 2) {
    blocks.push({
      kind: 'flow',
      title: `${name} in order`,
      caption: 'The pieces of this concept, in the sequence your syllabus covers them.',
      nodes: subtopicNames.slice(0, 6).map((label, i) => ({
        label,
        detail: objectives[i] ? String(objectives[i]).slice(0, 120) : '',
      })),
      loop: false,
      source: 'syllabus',
    });
  } else if (objectives.length >= 2) {
    blocks.push({
      kind: 'steps',
      title: `Working through ${name}`,
      caption: 'Derived from the learning objectives for this concept.',
      steps: objectives.slice(0, 5).map((o) => ({ label: String(o).slice(0, 200), detail: '' })),
      source: 'syllabus',
    });
  }

  // 2. Contrast: only claim a comparison when the material actually contrasts.
  const contrastPairs = [
    ['list', 'tuple'],
    ['list', 'set'],
    ['==', 'is'],
    ['==', 'equals'],
    ['compile', 'interpret'],
    ['stack', 'heap'],
    ['overload', 'override'],
    ['abstract class', 'interface'],
    ['mutuable', 'immutable'],
    ['mutable', 'immutable'],
    ['primary key', 'foreign key'],
    ['process', 'thread'],
  ];
  const haystack = `${name} ${concept.description || ''} ${keywords.join(' ')} ${chunkText}`.toLowerCase();
  const pair = contrastPairs.find(([a, b]) => haystack.includes(a) && haystack.includes(b));
  if (pair) {
    const [a, b] = pair;
    const sentences = phrases(chunkText);
    const pick = (term) =>
      sentences
        .filter((s) => s.toLowerCase().includes(term))
        .slice(0, 3)
        .map((s) => s.slice(0, 150));
    const leftItems = pick(a);
    const rightItems = pick(b);
    if (leftItems.length || rightItems.length) {
      blocks.push({
        kind: 'compare',
        title: `${a} vs ${b}`,
        caption: 'What your classroom material says about each.',
        columns: [
          { name: a.charAt(0).toUpperCase() + a.slice(1), items: leftItems.length ? leftItems : ['See the tutor explanation above.'] },
          { name: b.charAt(0).toUpperCase() + b.slice(1), items: rightItems.length ? rightItems : ['See the tutor explanation above.'] },
        ],
        source: 'material',
      });
    }
  } else if (keywords.length >= 2) {
    // No explicit contrast — show the vocabulary instead of inventing one.
    blocks.push({
      kind: 'table',
      title: 'Key terms for this concept',
      caption: 'Terms your syllabus associates with this topic.',
      headers: ['Term', 'Why it matters here'],
      rows: keywords.slice(0, 5).map((k) => [String(k), `Used when working with ${name}`]),
      source: 'syllabus',
    });
  }

  // 3. Concrete example: code when the concept is code-shaped, else a procedure.
  const codeLike = /\b(code|function|method|class|loop|array|list|syntax|program|variable|operator)\b/i;
  if (codeLike.test(haystack) && mode !== 'test') {
    const example = extractCode(chunkText);
    if (example) {
      blocks.push({
        kind: 'code',
        title: `Example from your material`,
        caption: `A worked fragment relevant to ${name}.`,
        language: example.language,
        code: example.code,
        annotations: [],
        source: 'material',
      });
    }
  }

  if (!blocks.length) {
    blocks.push({
      kind: 'steps',
      title: `How to approach ${name}`,
      caption: 'A generic but reliable approach when the syllabus has no structure recorded yet.',
      steps: [
        { label: 'Say what it is', detail: `Write the definition of ${name} in your own words.` },
        { label: 'Say why it exists', detail: 'What problem would you have without it?' },
        { label: 'Show one example', detail: 'Work a small case end to end.' },
        { label: 'Break it on purpose', detail: 'Change one part and predict what breaks.' },
      ],
      source: 'fallback',
    });
  }

  return blocks.slice(0, MAX_BLOCKS);
}

function extractCode(text) {
  const fenced = text.match(/```([a-z0-9+#]*)\n([\s\S]{10,600}?)```/i);
  if (fenced) {
    return { language: (fenced[1] || 'plaintext').toLowerCase() || 'plaintext', code: fenced[2].trim() };
  }
  // Look for an indented block or a run of lines that look like statements.
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s{2,}\S/.test(l) || /^\s*(def|class|function|public|private|for|while|if)\b/.test(l));
  if (start === -1) return null;
  const block = [];
  for (let i = start; i < lines.length && block.length < 14; i += 1) {
    if (!lines[i].trim()) break;
    block.push(lines[i].replace(/^\s{0,4}/, ''));
  }
  if (block.length < 2) return null;
  return { language: 'plaintext', code: block.join('\n') };
}
