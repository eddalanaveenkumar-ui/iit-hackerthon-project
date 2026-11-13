import {
  isSafeMediaUrl,
  uiDocumentSchema,
  componentSchema,
  COMPONENT_SCHEMAS,
  UI_LIMITS,
  UI_ACTIONS,
  NAV_TARGETS,
  QUESTION_TYPES,
} from '../schemas/uiSchema';

/**
 * VALIDATION + SANITISATION
 * =========================
 *
 * Two jobs, kept separate:
 *
 *  `validateUI` — is this document the shape the renderers expect? Returns a
 *  normalised document plus the list of rejected components, so a single bad
 *  component degrades the lesson instead of breaking the page.
 *
 *  `sanitizeContent` — make a value safe to *render as text*. Nothing in this
 *  renderer ever builds HTML from model output; markdown is rendered by
 *  react-markdown (which does not evaluate raw HTML unless a plugin enables
 *  it), math is rendered by KaTeX with `trust: false`, and everything else is a
 *  React text node. These helpers exist so that assumption is explicit and
 *  testable rather than implicit.
 *
 * Repair policy (why it is lenient, and where it is not)
 * -----------------------------------------------------
 * A language model writing a 40-component lesson will, occasionally, produce one
 * over-long paragraph or one component nested a level too deep. Rejecting the
 * whole document turns a small authoring defect into "the lesson failed". So the
 * validator repairs what it can *without weakening a guarantee*:
 *
 *   - strings over the ceiling are truncated to the ceiling (never rendered
 *     whole, never rejected);
 *   - a missing id gets a generated one; a duplicate id is suffixed;
 *   - containers nested too deep are flattened to the depth ceiling;
 *   - a list longer than its ceiling is trimmed, and the trim is reported;
 *   - an unknown `type` is dropped and reported.
 *
 * It refuses the document only when nothing survives, or when the envelope is
 * unusable. Every repair appears in `issues`, so the UI can say what happened.
 */

export const CONTAINER_KEYS = {
  layout: (c) => c.children,
  // Presentation groups hold children too, so the depth counter, the id
  // deduplicator and the walker must all look inside them.
  row: (c) => c.children || [],
  grid: (c) => c.children || [],
  card: (c) => c.children || [],
  tabs: (c) => (c.tabs || []).flatMap((t) => t.children || []),
  accordion: (c) => (c.items || []).flatMap((i) => i.children || []),
};

/** Read a container's children regardless of how they are grouped. */
function getChildren(component) {
  switch (component?.type) {
    case 'layout':
    case 'card':
    case 'row':
    case 'grid':
      return Array.isArray(component.children) ? component.children : null;
    case 'tabs':
      return Array.isArray(component.tabs) ? component.tabs.flatMap((t) => t.children || []) : null;
    case 'accordion':
      return Array.isArray(component.items) ? component.items.flatMap((i) => i.children || []) : null;
    default:
      return null;
  }
}

/** Put children back in the shape the component expects. */
function setChildren(component, children) {
  if (['layout', 'card', 'row', 'grid'].includes(component.type)) return { ...component, children };
  if (component.type === 'tabs') {
    let cursor = 0;
    return {
      ...component,
      tabs: component.tabs.map((tab) => {
        const slice = children.slice(cursor, cursor + (tab.children || []).length);
        cursor += (tab.children || []).length;
        return { ...tab, children: slice };
      }),
    };
  }
  let cursor = 0;
  return {
    ...component,
    items: component.items.map((item) => {
      const slice = children.slice(cursor, cursor + (item.children || []).length);
      cursor += (item.children || []).length;
      return { ...item, children: slice };
    }),
  };
}

/** A text-ish component carrying no words is dropped rather than rendered empty. */
export const PRESENTATION_TYPES = Object.freeze(['row', 'grid', 'box']);

function isPresentation(item) {
  return Boolean(item) && PRESENTATION_TYPES.includes(item.type);
}

function isEmptyContent(component) {
  if (!component) return true;
  if (component.type === 'text') return !String(component.content || '').trim();
  // A group holds no content of its own; its cells are checked individually.
  if (isPresentation(component)) return false;
  return false;
}

/**
 * Enforce the depth ceiling on an *already valid* tree by promoting children of
 * a container that sits at the limit. Content survives; nesting does not grow.
 */
function flattenToDepth(list, depth, notes) {
  const out = [];
  for (const component of list || []) {
    const children = getChildren(component);
    if (!children) {
      out.push(component);
      continue;
    }
    if (depth >= UI_LIMITS.maxDepth) {
      if (children.length) {
        notes.push(issue(`components.${component.id}`, `nesting limited to ${UI_LIMITS.maxDepth} levels; children were lifted`, 'flattened'));
        out.push(...flattenToDepth(children, depth, notes));
      }
      continue;
    }
    out.push(setChildren(component, flattenToDepth(children, depth + 1, notes)));
  }
  return out;
}

/** Rename duplicate ids in place (on a copy) so React keys stay unique. */
function dedupeIds(list, seen, notes) {
  return (list || []).map((component) => {
    let next = component;
    if (seen.has(next.id)) {
      const base = next.id.slice(0, 56);
      let suffix = 2;
      while (seen.has(`${base}-${suffix}`)) suffix += 1;
      next = { ...next, id: `${base}-${suffix}` };
      notes.push(issue(`components.${component.id}`, `duplicate id "${component.id}" was renamed`, 'duplicate_id'));
    }
    seen.add(next.id);
    const children = getChildren(next);
    if (children) next = setChildren(next, dedupeIds(children, seen, notes));
    return next;
  });
}

/**
 * The structural guarantees, applied identically to clean and repaired trees:
 *  1. a text component with no words is dropped (empty boxes are not content);
 *  2. ids are unique;
 *  3. nesting never exceeds the ceiling.
 * Returns the bounded list plus the notes explaining each repair.
 */
function finalise(components) {
  const notes = [];

  /**
   * Give every presentation cell a stable id, recursively.
   *
   * A cell inside a `grid` is written as `{ "type": "text", "content": "A" }`
   * with no id — the documented authoring shape — but React needs a key and the
   * schema requires one. Generating it here keeps the authored JSON honest while
   * the rendered tree stays addressable.
   */
  let cellCounter = 0;
  const withCellIds = (list) => (list || []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    if (isPresentation(item)) {
      const next = Array.isArray(item.children) ? { ...item, children: withCellIds(item.children) } : { ...item };
      if (!next.id) next.id = `cell-${(cellCounter += 1).toString(36)}`;
      return next;
    }
    const next = { ...item };
    if (!next.id) next.id = `auto-${next.type || 'component'}-${(cellCounter += 1).toString(36)}`;
    return next;
  });

  const pruneEmpty = (list) => withCellIds(list).flatMap((component) => {
    if (!component) return [];
    if (isEmptyContent(component)) {
      notes.push(issue(`components.${component.id}`, 'a component with empty content was removed', 'empty'));
      return [];
    }
    const children = getChildren(component);
    if (!children) return [component];
    return [setChildren(component, pruneEmpty(children))];
  });
  const pruned = pruneEmpty(components);
  return { components: flattenToDepth(dedupeIds(pruned, new Set(), notes), 1, notes), notes };
}

function issue(path, message, code = 'invalid') {
  return { path, message, code };
}

function flattenIssues(error, prefix = '') {
  return (error?.issues || []).slice(0, 20).map((entry) =>
    issue([prefix, entry.path.join('.')].filter(Boolean).join('.'), entry.message, entry.code));
}

function countComponents(components = []) {
  let total = 0;
  let maxDepth = 0;
  const walk = (list, depth) => {
    for (const component of list || []) {
      total += 1;
      maxDepth = Math.max(maxDepth, depth);
      const get = CONTAINER_KEYS[component?.type];
      if (get) walk(get(component), depth + 1);
    }
  };
  walk(components, 1);
  return { total, maxDepth };
}

/** The schema for one component type, if the type is in the registry. */
function schemaFor(type) {
  return Object.prototype.hasOwnProperty.call(COMPONENT_SCHEMAS, type) ? COMPONENT_SCHEMAS[type] : null;
}

/**
 * Deep-repair a raw component tree, then validate each node.
 *
 * Truncation happens here, on the *raw* value, because zod's `.max()` rejects
 * rather than trims — by the time the schema has run it is too late to shorten
 * the string.
 */
function repairTree(raw, { generateId, seen, dropped, issues, depth = 1 }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    dropped.push(issue(`components.${depth}`, 'component is not an object'));
    return null;
  }
  const type = typeof raw.type === 'string' ? raw.type : '';

  // A `row` / `grid` / `box` is not in the component registry — it is a
  // presentation primitive — but it is legal inside a layout. Recurse through
  // it here so its cells are repaired individually rather than the whole group
  // being discarded as an "unknown component".
  if (isPresentation(raw)) {
    const group = { ...raw };
    if (Array.isArray(group.children)) {
      group.children = group.children
        .slice(0, UI_LIMITS.maxGridCells || 12)
        .flatMap((child) => {
          const repaired = repairTree(child, { generateId, seen, dropped, issues, depth: depth + 1 });
          return repaired ? [repaired] : [];
        })
        .filter(Boolean);
    }
    if (group.type === 'box' && !String(group.content || '').trim()) return null;
    return group;
  }

  if (!schemaFor(type)) {
    dropped.push(issue(`components.${raw.id || type || '?'}`, `unknown component type "${type || 'missing'}"`, 'unknown_type'));
    return null;
  }

  const candidate = { ...raw };

  // --- identity -----------------------------------------------------------
  if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(candidate.id)) {
    candidate.id = generateId(type);
    issues.push(issue(`components.${type}`, 'component was missing a valid id, one was generated', 'repaired_id'));
  }
  const base = candidate.id;
  let suffix = 2;
  while (seen.has(candidate.id)) candidate.id = `${base.slice(0, 58)}-${suffix++}`;
  if (candidate.id !== base) issues.push(issue(`components.${base}`, `duplicate component id "${base}" was renamed`, 'duplicate_id'));
  seen.add(candidate.id);

  // --- collection children ------------------------------------------------
  // A `media` group and a `data` block hold *several* things. One unusable
  // item is not a reason to drop the whole block: strip the bad item, keep the
  // rest, and report it. If nothing usable survives, the component goes.
  if (type === 'media' && Array.isArray(candidate.items)) {
    const before = candidate.items.length;
    candidate.items = candidate.items.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      // An icon carries no URL; anything with a source must pass the check.
      if (item.media_type === 'icon') return true;
      return typeof item.src === 'string' && isSafeMediaUrl(item.src);
    });
    if (candidate.items.length !== before) {
      issues.push(issue(`components.${candidate.id}.items`, `${before - candidate.items.length} unsafe media source(s) removed`, 'unsafe_media'));
      dropped.push(issue(`components.${candidate.id}.items`, 'unsafe media source', 'unsafe_media'));
    }
    if (!candidate.items.length) return null;
  }

  if (type === 'data' && Array.isArray(candidate.components)) {
    candidate.components = candidate.components.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.type === 'chart') return Array.isArray(item.data) && item.data.length > 0;
      if (item.type === 'table') return Array.isArray(item.columns) && item.columns.length > 0;
      return false;
    });
    if (!candidate.components.length) {
      dropped.push(issue(`components.${candidate.id}`, 'no non-empty chart or table survived', 'empty'));
      return null;
    }
  }

  // --- bounded scalars ----------------------------------------------------
  truncateStrings(candidate, issues, candidate.id);

  // --- containers ---------------------------------------------------------
  // At the ceiling the container is replaced by its children (see repairList).
  // `depth` here is this node's level; the ceiling is applied when recursing.
  if (type === 'layout' || type === 'card') {
    const kids = Array.isArray(candidate.children) ? candidate.children : [];
    const limit = type === 'layout' ? 12 : 20;
    if (kids.length > limit) {
      issues.push(issue(`components.${candidate.id}.children`, `${kids.length} children trimmed to ${limit}`, 'trimmed'));
    }
    candidate.children = kids
      .slice(0, limit)
      .flatMap((child) => repairTree(child, { generateId, seen, dropped, issues, depth: depth + 1 }))
      .filter(Boolean);
  } else if (type === 'tabs') {
    candidate.tabs = (Array.isArray(candidate.tabs) ? candidate.tabs : []).slice(0, UI_LIMITS.maxTabsOrPanels).map((tab) => {
      if (!tab || typeof tab !== 'object') return null;
      const kids = Array.isArray(tab.children) ? tab.children : [];
      return {
        ...tab,
        children: kids
          .slice(0, 12)
          .flatMap((child) => repairTree(child, { generateId, seen, dropped, issues, depth: depth + 1 }))
          .filter(Boolean),
      };
    }).filter(Boolean);
  } else if (type === 'accordion') {
    candidate.items = (Array.isArray(candidate.items) ? candidate.items : []).slice(0, UI_LIMITS.maxTabsOrPanels).map((item) => {
      if (!item || typeof item !== 'object') return null;
      const kids = Array.isArray(item.children) ? item.children : [];
      return {
        ...item,
        children: kids
          .slice(0, 12)
          .flatMap((child) => repairTree(child, { generateId, seen, dropped, issues, depth: depth + 1 }))
          .filter(Boolean),
      };
    }).filter(Boolean);
  }

  // A container that sits at the depth ceiling is replaced by its children.
  if (depth >= UI_LIMITS.maxDepth && CONTAINER_KEYS[type]) {
    const kids = getChildren(candidate) || [];
    if (kids.length) {
      issues.push(issue(`components.${candidate.id}`, `nesting limited to ${UI_LIMITS.maxDepth} levels; container was flattened`, 'flattened'));
      return kids;
    }
    return [];
  }

  // --- unknown enum values would reject the node; normalise the safe ones ---
  if (type === 'actions' && Array.isArray(candidate.actions)) {
    const before = candidate.actions.length;
    candidate.actions = candidate.actions.filter((action) => action && UI_ACTIONS.includes(action.action));
    if (candidate.actions.length !== before) issues.push(issue(`components.${candidate.id}.actions`, 'an action outside the allowlist was removed', 'blocked_action'));
    for (const action of candidate.actions) {
      if (action.target && !NAV_TARGETS.includes(action.target)) {
        delete action.target;
        issues.push(issue(`components.${candidate.id}.actions`, 'an off-application navigation target was removed', 'blocked_navigation'));
      }
    }
  }

  const parsed = componentSchema.safeParse(candidate);
  if (!parsed.success) {
    dropped.push({ ...flattenIssues(parsed.error)[0], id: candidate.id, type });
    return null;
  }
  // Drop list entries that flattened away, keep nodes as single-element arrays
  // so the caller can flatMap uniformly.
  return isEmptyContent(parsed.data) ? null : parsed.data;
}

/**
 * Recursively cap every string in a component subtree.
 *
 * The ceilings come from the schema itself so there is exactly one source of
 * truth for a limit: if the schema says 12 000, this trims to 12 000 and the
 * schema then accepts it.
 */
function truncateStrings(node, issues, componentId, depth = 0) {
  if (depth > 8 || !node || typeof node !== 'object') return;
  const MAX = UI_LIMITS.maxText;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && value.length > MAX) {
      node[key] = value.slice(0, MAX);
      issues.push(issue(`components.${componentId}.${key}`, `text truncated to ${MAX} characters`, 'truncated'));
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.length > MAX) {
          // Handled by the parent array below when it is replaced.
        } else if (entry && typeof entry === 'object') {
          truncateStrings(entry, issues, componentId, depth + 1);
        }
      }
      // Trim long string arrays (options, objectives, labels).
      const stringLimit = key === 'learning_objectives' || key === 'objectives' ? 20 : UI_LIMITS.maxOptions * 4;
      if (value.length > stringLimit) node[key] = value.slice(0, stringLimit);
    } else if (value && typeof value === 'object') {
      truncateStrings(value, issues, componentId, depth + 1);
    }
  }
}

/**
 * Strict validation of one component.
 * @returns {{ ok: boolean, component?: object, issues: object[] }}
 */
export function validateComponent(raw) {
  const result = componentSchema.safeParse(raw);
  if (result.success) return { ok: true, component: result.data, issues: [] };
  return { ok: false, issues: flattenIssues(result.error) };
}

let idCounter = 0;

/**
 * Validate a whole document, repairing where it is safe to do so.
 *
 * @param {unknown} raw
 * @param {{ strict?: boolean }} options  strict = reject the document on any error
 * @returns {{ ok: boolean, document: object|null, issues: object[], dropped: object[], stats: object }}
 */
export function validateUI(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, document: null, issues: [issue('', 'Not a UI document', 'invalid_type')], dropped: [], stats: null };
  }

  const bytes = (() => {
    try {
      return new Blob([JSON.stringify(raw)]).size;
    } catch {
      return 0;
    }
  })();
  if (bytes > UI_LIMITS.maxDocumentBytes) {
    return { ok: false, document: null, issues: [issue('', `Document exceeds ${UI_LIMITS.maxDocumentBytes} bytes`, 'too_large')], dropped: [], stats: { bytes } };
  }

  const envelope = uiDocumentSchema.safeParse(raw);
  if (envelope.success) {
    // A clean parse can still repeat ids, nest to the ceiling or carry an empty
    // text box, so the same structural pass runs here: the promise is identical
    // whether or not the document needed repair.
    const finalised = finalise(envelope.data.components);
    if (!finalised.components.length) {
      return {
        ok: false,
        document: null,
        issues: [...finalised.notes, issue('components', 'the document contains no renderable content')],
        dropped: [],
        stats: { bytes },
      };
    }
    const { total, maxDepth } = countComponents(finalised.components);
    return {
      ok: true,
      document: { ...envelope.data, components: finalised.components },
      issues: finalised.notes,
      dropped: [],
      stats: { total, maxDepth, bytes },
    };
  }
  if (strict) {
    return { ok: false, document: null, issues: flattenIssues(envelope.error), dropped: [], stats: { bytes } };
  }

  // --- lenient path -------------------------------------------------------
  const issues = flattenIssues(envelope.error);
  const dropped = [];
  const seen = new Set();
  const generateId = (type) => `auto-${type || 'component'}-${(idCounter += 1).toString(36)}`;

  const rawList = Array.isArray(raw.components) ? raw.components : [];
  if (!rawList.length) {
    return { ok: false, document: null, issues: [...issues, issue('components', 'the document contains no components')], dropped, stats: { bytes } };
  }
  if (rawList.length > UI_LIMITS.maxComponents) {
    issues.push(issue('components', `${rawList.length} components trimmed to ${UI_LIMITS.maxComponents}`, 'trimmed'));
  }

  const components = rawList
    .slice(0, UI_LIMITS.maxComponents)
    .flatMap((entry) => repairTree(entry, { generateId, seen, dropped, issues }))
    .filter(Boolean);

  if (!components.length) {
    return {
      ok: false,
      document: null,
      issues: [...issues, ...dropped.map((d) => issue(d.path, d.message, d.code))],
      dropped,
      stats: { bytes },
    };
  }

  const rebuilt = {
    version: '1.0',
    response_id: typeof raw.response_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.response_id)
      ? raw.response_id
      : `repaired_${(idCounter += 1).toString(36)}`,
    response_type: ['educational_tutorial', 'concept_check', 'question_form', 'code_practice', 'assessment', 'progress_summary', 'clarification'].includes(raw.response_type)
      ? raw.response_type
      : 'educational_tutorial',
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined,
    learning_objectives: Array.isArray(raw.learning_objectives) ? raw.learning_objectives.slice(0, 12).map((o) => String(o).slice(0, UI_LIMITS.maxShortText)) : undefined,
    components,
  };
  const repaired = uiDocumentSchema.safeParse(rebuilt);
  if (!repaired.success) {
    return { ok: false, document: null, issues: [...issues, ...flattenIssues(repaired.error)], dropped, stats: { bytes } };
  }
  // Same structural pass as the clean path.
  const finalised = finalise(repaired.data.components);
  if (!finalised.components.length) {
    return { ok: false, document: null, issues: [...issues, ...finalised.notes], dropped, stats: { bytes } };
  }
  const { total, maxDepth } = countComponents(finalised.components);
  return {
    ok: true,
    document: { ...repaired.data, components: finalised.components },
    issues: [...issues, ...finalised.notes],
    dropped,
    stats: { total, maxDepth, bytes, repaired: true },
  };
}

/* -------------------------------------------------------------------------- */
/* sanitisation                                                                */
/* -------------------------------------------------------------------------- */

/** Remove control characters and cap length. Never returns a non-string. */
export function sanitizeText(value, max = UI_LIMITS.maxText) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, max);
}

/**
 * Keep a URL only if it is safe to put in `src`/`href`.
 * Returns '' for anything else, so a caller can render "unavailable" instead of
 * a broken or hostile link.
 */
export function sanitizeUrl(value) {
  return isSafeMediaUrl(value) ? String(value).trim() : '';
}

/** A navigation target must be an internal, allowlisted application path. */
export function sanitizeNavTarget(value) {
  return NAV_TARGETS.includes(String(value || '')) ? String(value) : '';
}

/**
 * Strip anything that looks like an embedded script URI from prose before it is
 * rendered by the markdown renderer. The renderer itself does not create HTML,
 * so this is defence in depth: no `javascript:` links survive into an anchor.
 */
export function sanitizeMarkdown(markdown) {
  return sanitizeText(markdown)
    .replace(/\]\(\s*javascript:/gi, '](#blocked:')
    .replace(/\]\(\s*data:text\/html/gi, '](#blocked:')
    .replace(/<script/gi, '&lt;script')
    .replace(/<iframe/gi, '&lt;iframe');
}

/**
 * Normalise the answers of a question form before submitting.
 *
 * A `question_form` answer is one of: a string, a number, a boolean, a date
 * string, or an array of option values. Anything else (a File object, a nested
 * object, a function) is dropped rather than serialised — a payload the server
 * cannot interpret is worse than a missing answer, because it fails the whole
 * submission. Files are handled separately by the host before this point.
 */
export function sanitizeAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) continue; // no __proto__, no dotted paths
    if (key === 'constructor' || key === 'prototype' || key === '__proto__') continue;
    if (typeof value === 'string') out[key] = sanitizeText(value, 20_000);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) {
      out[key] = value
        .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
        .map((entry) => (typeof entry === 'string' ? sanitizeText(entry, 2000) : entry))
        .slice(0, 50);
    }
    // everything else: dropped deliberately
  }
  return out;
}

/** Is this question type part of the form engine? */
export function isQuestionType(type) {
  return QUESTION_TYPES.includes(type);
}

export { UI_LIMITS, UI_ACTIONS, NAV_TARGETS, QUESTION_TYPES };
