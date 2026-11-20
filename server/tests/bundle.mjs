/**
 * Serverless bundling regression: the pdfjs worker must reach the deployment.
 *
 * This bug is invisible to every other test. Locally `node_modules` is complete,
 * so pdfjs always finds its worker and PDF uploads parse fine. On Vercel the
 * function only contains files the bundler *traced*, and pdfjs loads the worker
 * with a runtime string:
 *
 *   await import(GlobalWorkerOptions.workerSrc)   // "./pdf.worker.mjs"
 *
 * Nothing can trace a runtime string, so the file was absent and every PDF
 * upload failed with "Setting up fake worker failed: Cannot find module
 * .../pdf.worker.mjs" — while the whole local suite stayed green.
 *
 * So this traces the real serverless entrypoint with Vercel's own tracer
 * (@vercel/nft) and asserts the worker is in the output. It fails on the old
 * code and passes on the fix, which is what makes it worth keeping.
 *
 * Run: node tests/bundle.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');

let pass = 0;
const fails = [];
const check = (label, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}`);
  } catch (err) {
    fails.push(label);
    console.log(`  \u001b[31m✗\u001b[0m ${label}`);
    console.log(`    ${err.message}`);
  }
};

const trace = await nodeFileTrace([path.join(serverDir, 'api/index.js')], {
  base: serverDir,
  // Keep the trace honest: no readFile-backed guesses, exactly what Vercel does.
  processCwd: serverDir,
});
const traced = [...trace.fileList];
const has = (needle) => traced.some((f) => f.split(path.sep).join('/').includes(needle));

check('the serverless entrypoint traces without errors', () => {
  assert.equal(trace.esmFileList.size >= 0, true);
  assert.ok(traced.length > 100, `only ${traced.length} files traced — the entrypoint is not being followed`);
});

check('pdfjs itself is traced', () => {
  assert.ok(has('pdfjs-dist/legacy/build/pdf.mjs'), 'pdf.mjs is missing from the bundle');
});

// The actual regression.
check('the pdfjs worker module is traced into the bundle', () => {
  assert.ok(
    has('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    'pdf.worker.mjs is NOT traced. PDF uploads will fail in production with ' +
      '"Setting up fake worker failed". Load it with a literal specifier — see src/modules/syllabus/pdf-engine.js.',
  );
});

check('the syllabus extraction module is traced', () => {
  assert.ok(has('src/modules/syllabus/extract.js'), 'the syllabus module is missing');
  assert.ok(has('src/modules/syllabus/pdf-engine.js'), 'the pdf engine module is missing');
});

check('document parsing dependencies are traced', () => {
  assert.ok(has('node_modules/mammoth/'), 'mammoth (DOCX) is missing from the bundle');
  assert.ok(has('node_modules/jszip/'), 'jszip (DOCX/PPTX) is missing from the bundle');
});

check('vercel.json pins the worker so a future refactor cannot silently drop it', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(serverDir, 'vercel.json'), 'utf8'));
  const include = cfg.functions?.['api/index.js']?.includeFiles || '';
  assert.match(include, /pdf\.worker\.mjs/, 'includeFiles must pin pdf.worker.mjs');
});

check('the engine never loads the worker through a variable', () => {
  const src = fs.readFileSync(path.join(serverDir, 'src/modules/syllabus/pdf-engine.js'), 'utf8');
  // A literal specifier is traceable; a variable is not. Guard the fix itself.
  assert.match(
    src,
    /import\(\s*['"]pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs['"]\s*\)/,
    'the worker must be imported with a literal string',
  );
});

// The Python interpreter is a deploy-time asset the same way the pdfjs worker
// is: a 9 MB wasm binary and a 2.5 MB stdlib zip that a bundler will not trace
// from `import 'pyodide'`. If they are missing at runtime, every Python
// submission quietly falls back to "could not be run" — the bug this whole
// change exists to fix, restored by a deploy detail.
check('the Python runtime is a declared dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies?.pyodide, 'pyodide must be a runtime dependency, not a devDependency');
});

check('vercel.json ships the interpreter wasm and stdlib', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(serverDir, 'vercel.json'), 'utf8'));
  const include = cfg.functions?.['api/index.js']?.includeFiles || '';
  assert.match(include, /node_modules\/pyodide/, 'includeFiles must pin node_modules/pyodide/**');
});

check('the worker loads the interpreter through a literal specifier', () => {
  const src = fs.readFileSync(path.join(serverDir, 'src/utils/python-worker.js'), 'utf8');
  // Same rule as the pdfjs worker: a variable specifier cannot be traced.
  assert.match(src, /from\s+['"]pyodide['"]/, 'pyodide must be imported by literal name');
});

check('the worker module exists where the parent expects it', () => {
  assert.ok(
    fs.existsSync(path.join(serverDir, 'src/utils/python-worker.js')),
    'python-interpreter.js resolves ./python-worker.js — it must exist',
  );
});

console.log(`\n${pass} passed, ${fails.length} failed\n`);
if (fails.length) process.exitCode = 1;
