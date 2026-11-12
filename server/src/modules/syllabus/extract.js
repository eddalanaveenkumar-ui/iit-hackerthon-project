import JSZip from 'jszip';
import mammoth from 'mammoth';

/**
 * Server-side document text extraction for syllabus uploads.
 * Files are processed in memory: nothing from the upload is ever executed, and
 * only extracted text is persisted. Size/type are validated by the route.
 */

function xmlToText(xml) {
  return String(xml)
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(buffer) {
  // mammoth gives faithful paragraph structure (headings, lists).
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    if (value && value.trim().length > 20) {
      return { text: value.replace(/\n{3,}/g, '\n\n').trim(), pages: null };
    }
  } catch {
    /* fall back to direct XML parsing below */
  }
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('DOCX file is missing word/document.xml');
  return { text: xmlToText(await doc.async('string')), pages: null };
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/)[1]);
      const nb = Number(b.match(/(\d+)\.xml$/)[1]);
      return na - nb;
    });
  if (!slides.length) throw new Error('No slides found in presentation');
  const parts = [];
  for (let i = 0; i < slides.length; i += 1) {
    const text = xmlToText(await zip.file(slides[i]).async('string'));
    if (text) parts.push(`--- Slide ${i + 1} ---\n${text}`);
  }
  return { text: parts.join('\n\n'), pages: slides.length };
}

async function extractPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: undefined,
  }).promise;
  const pages = [];
  const maxPages = Math.min(doc.numPages, 120);
  for (let p = 1; p <= maxPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((i) => i.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push(`--- Page ${p} ---\n${text}`);
    page.cleanup?.();
  }
  const text = pages.join('\n\n');
  if (!text.trim()) {
    throw new Error('This PDF has no extractable text layer (it may be a scanned image). Upload a text PDF or create the syllabus manually.');
  }
  return { text, pages: doc.numPages };
}

export async function extractDocument({ buffer, mimetype, originalname }) {
  const name = String(originalname || '').toLowerCase();
  if (buffer.length > 15 * 1024 * 1024) throw new Error('File exceeds the 15 MB limit');

  let result;
  if (name.endsWith('.pdf') || mimetype === 'application/pdf') {
    result = await extractPdf(buffer);
  } else if (name.endsWith('.docx') || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    result = await extractDocx(buffer);
  } else if (name.endsWith('.pptx') || mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    result = await extractPptx(buffer);
  } else if (name.endsWith('.txt') || name.endsWith('.md') || mimetype === 'text/plain') {
    result = { text: buffer.toString('utf8').slice(0, 200_000), pages: null };
  } else if (name.endsWith('.doc') || name.endsWith('.ppt')) {
    throw new Error('Legacy .doc/.ppt formats are not supported. Please re-save as .docx or .pptx.');
  } else {
    throw new Error('Unsupported file type. Upload a PDF, DOCX, PPTX, TXT or MD file.');
  }

  return {
    filename: originalname,
    mimetype,
    size: buffer.length,
    text: result.text,
    pages: result.pages,
    characters: result.text.length,
    words: result.text.split(/\s+/).filter(Boolean).length,
  };
}

/** Splits long material into overlapping retrieval chunks. */
export function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - overlap)) + '\n\n' + p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.slice(0, 400);
}
