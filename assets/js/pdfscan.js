/**
 * KASOTI-Demo — the PDF check panel.
 *
 * THE CONTRACT, and the reason this file is shaped the way it is:
 * the chosen file is read once, into an ArrayBuffer, via `File.arrayBuffer()`
 * (with a FileReader fallback for very old engines). Those bytes go straight
 * into the in-page pdf.js worker and are dropped. There is no `fetch`, no
 * `FormData`, no `XMLHttpRequest`, no `sendBeacon` and no analytics call
 * anywhere in this module. The only network requests this page can ever make
 * are for the vendored pdf.js bundle and its worker script — and those carry no
 * part of the document. If you add anything here that puts document bytes on
 * the wire, you have broken the one promise this demo makes.
 *
 * Honesty rules baked into the render step, in priority order:
 *   1. No zone found            -> say so. Never invent or reconstruct one.
 *   2. Zone found but structure
 *      errors present           -> NO VERDICT (fail closed), not a pass.
 *   3. Some check digit failed  -> RED, naming the fields that failed.
 *   4. Scanned page, no text    -> say the OCR is unavailable and stop.
 *   5. Metadata is shown, and   -> labelled weak evidence, always, in both
 *      labelled as such           languages, because it is.
 *
 * Exports: initPdfPanel, rerenderPdfPanel, buildSpecimenPdf.
 * Nothing here touches `document` at module scope, so the file can be imported
 * by a Node test harness (which is how buildSpecimenPdf is verified).
 */

import { parse, allPassed, failedFields, findMrzCandidates } from './mrz.js';
import { t, applyStatic, getLang } from './i18n.js';

/* ==========================================================================
   1. Constants
   ========================================================================== */

const MAX_BYTES = 4 * 1024 * 1024;          // the 4 MB the dropzone legend promises
const SCANNED_ALNUM_FLOOR = 40;            // below this the page is a scan
const FILEROW_CAP = 10;                    // keep the demo list short
const A4 = [0, 0, 595, 842];

/** The specimen TD3 zone, already used elsewhere in this project. */
const SPECIMEN_L1 = 'AB12345671IND9006083M3106073AB1234567<<<<<16';
const SPECIMEN_L2 = 'SHARMA<<RAMESH<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<';

/** Bilingual strings that have no `pdf.*` key. Authored here, never in i18n.js. */
const S = {
  pass:      ['pass', 'उत्तीर्ण'],
  fail:      ['check digit failed', 'चेक डिजिट विफल'],
  unverified:['not verified', 'सत्यापित नहीं'],
  noverdict: ['no verdict', 'कोई निर्णय नहीं'],
  fields:    ['Extracted fields', 'निकाले गए फ़ील्ड'],
  checks:    ['Check digits', 'चेक डिजिट'],
  cfield:    ['field', 'फ़ील्ड'],
  cexpected: ['expected', 'अपेक्षित'],
  cobserved: ['observed', 'पाया गया'],
  cverdict:  ['verdict', 'निर्णय'],
  taprow:    ['Tap a row to show that file’s result.', 'किसी फ़ाइल का परिणाम दिखाने के लिए पंक्ति पर टैप करें।'],
  fdoc:      ['document number', 'दस्तावेज़ संख्या'],
  fsurname:  ['surname', 'उपनाम'],
  fgiven:    ['given names', 'दिए गए नाम'],
  fnat:      ['nationality', 'राष्ट्रीयता'],
  fdob:      ['date of birth', 'जन्म तिथि'],
  fsex:      ['sex', 'लिंग'],
  fexp:      ['date of expiry', 'समाप्ति तिथि'],
  fpers:     ['personal number', 'व्यक्तिगत संख्या'],
  fopt:      ['optional data', 'वैकल्पिक डेटा'],
  fissuer:   ['issuer', 'जारीकर्ता'],
  metaKey:   {
    Producer:     ['Producer', 'निर्माता'],
    Creator:      ['Creator', 'रचयिता'],
    CreationDate: ['Creation date (UTC)', 'निर्माण तिथि (UTC)'],
    ModDate:      ['Modified date (UTC)', 'संशोधन तिथि (UTC)'],
    Title:        ['Title', 'शीर्षक'],
  },
  metaCaveat: [
    'Metadata is what the producing software chose to write down. It is trivially edited, '
    + 'it is routinely wrong, and a mismatch is not evidence of forgery. Treat it as a lead, '
    + 'never as a verdict.',
    'मेटाडेटा वह है जो बनाने वाले सॉफ़्टवेयर ने लिखने की ठानी। इसे आसानी से बदला जा सकता है, '
    + 'यह अक्सर ग़लत होता है, और असमानता नकल का सबूत नहीं है। इसे सुराग मानें, निर्णय कभी नहीं।',
  ],
  legendOk:  ['covered by a check digit that agreed', 'सहमत चेक डिजिट द्वारा कवर'],
  legendBad: ['covered by a check digit that disagreed', 'असहमत चेक डिजिट द्वारा कवर'],
  legendNone:['not covered by any check digit', 'किसी चेक डिजिट द्वारा कवर नहीं'],
  structure: [
    'The zone has the right shape but not valid content, so we are refusing to grade it:',
    'क्षेत्र का आकार सही है पर सामग्री मान्य नहीं, इसलिए हम उसे अंक देने से मना करते हैं:',
  ],
  zone:      ['Machine-readable zone', 'मशीन-पठन क्षेत्र'],
  validSpec:  ['specimen, check digits intact', 'नमूना, चेक डिजिट सही'],
  alteredSpec:['specimen, one digit altered', 'नमूना, एक अंक बदला हुआ'],
  nofile:     ['That drop carried no file.', 'उस ड्रॉप में कोई फ़ाइल नहीं थी।'],
  notpdf:     ['Not a PDF — nothing was read.', 'PDF नहीं है — कुछ भी नहीं पढ़ा गया।'],
  toobig:     ['Over the 4 MB limit ({size}) — nothing was read.',
               '4 MB की सीमा से अधिक ({size}) — कुछ भी नहीं पढ़ा गया।'],
  locked:     ['Password protected — we did not ask, and we do not guess.',
               'पासवर सुरक्षित — हमने पूछा नहीं, और अनुमान भी नहीं लगाते।'],
  unopenable: ['Encrypted or damaged — the parser refused it.', 'एन्क्रिप्टेड या क्षतिग्रस्त — पार्सर ने मना कर दिया।'],
  enginefail: ['The in-page PDF engine failed to load.', 'पृष्ठ का PDF इंजन लोड नहीं हुआ।'],
  nopages:    ['The parser opened it but found no pages.', 'पार्सर ने इसे खोला पर कोई पृष्ठ नहीं मिला।'],
  loading:    ['loading the in-page engine', 'इन-पेज इंजन लोड हो रहा है'],
  marker:     ['showing', 'दिखा रहा है'],
  reading:    ['reading the file', 'फ़ाइल पढ़ी जा रही है'],
  readingNote: [
    'The bytes are in memory and being parsed on this page. No verdict is claimed '
    + 'until the parse finishes.',
    'बाइट्स मेमोरी में हैं और इसी पृष्ठ पर पार्स किए जा रहे हैं। पार्स पूरा होने तक कोई निर्णय दावा नहीं किया जाता।',
  ],
};

/**
 * The limit each refusal actually invoked, keyed by the reason that cited it.
 *
 * `t('pdf.max')` is the dropzone legend and bundles three separate promises
 * ("PDF only · 4 MB maximum · nothing is uploaded"), so pushing all of it on
 * every rejected row quoted a 4 MB limit at a 45-byte text file. Each half has
 * no `pdf.*` key of its own, so it is authored here, like the rest of `S`. A
 * reason that invoked no limit — locked, damaged, no pages — quotes none, rather
 * than borrowing a clause that does not apply to it.
 */
const LIMIT_CLAUSE = {
  notpdf: ['PDF only', 'केवल PDF'],
  toobig: ['4 MB maximum', 'अधिकतम 4 MB'],
};

/**
 * Per-check character coverage, in the exact order `mrz.js` emits `checks`.
 *
 * This mirrors `parseTd3`/`parseTd1` so the tape can be coloured per character.
 * It is NOT trusted: `annotate()` re-derives every span from `result.rawLines`
 * and compares it with the span the engine actually checked. If the engine ever
 * changes shape, the comparison fails and we fall back to a plain tape rather
 * than colouring characters we cannot justify. Correctness beats a highlight.
 *
 * Each entry: [fieldName, [[line, startInclusive, endExclusive], ...], [checkDigitLine, checkDigitIndex]]
 */
const CHECK_SPANS = {
  TD3: [
    ['DOCUMENT_NUMBER', [[0, 0, 9]],   [0, 9]],
    ['BIRTH_DATE',      [[0, 13, 19]], [0, 19]],
    ['EXPIRY_DATE',     [[0, 21, 27]], [0, 27]],
    ['PERSONAL_NUMBER', [[0, 28, 42]], [0, 42]],
    ['COMPOSITE',       [[0, 0, 10], [0, 13, 20], [0, 21, 43], [1, 0, 44]], [0, 43]],
  ],
  TD1: [
    ['DOCUMENT_NUMBER', [[0, 0, 9]],   [0, 9]],
    ['BIRTH_DATE',      [[0, 13, 19]], [0, 19]],
    ['OPTIONAL_DATA',   [[0, 21, 29]], [0, 29]],
    ['NAME',            [[1, 0, 29]],  [1, 29]],
    ['OPTIONAL_DATA',   [[2, 0, 6]],   [2, 6]],
    ['EXPIRY_DATE',     [[2, 7, 13]],  [2, 13]],
    ['PERSONAL_NUMBER', [[2, 14, 29]], [2, 29]],
  ],
};

/* ==========================================================================
   2. Small DOM helpers
   ========================================================================== */

/** Append a child, an array of children, or a raw string (as a text node). */
function add(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { child.forEach((c) => add(parent, c)); return; }
  parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
}

/**
 * h('div', {class: 'card'}, 'text', [nodes...])
 *
 * Special attribute forms:
 *   text: v  -> textContent (used for anything derived from a file: untrusted)
 *   bi:  [e,h] -> both languages, plus the current one as initial text
 */
function h(tag, attrs) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = String(v);
      else if (k === 'bi') {
        n.setAttribute('data-en', v[0]);
        n.setAttribute('data-hi', v[1]);
        n.textContent = getLang() === 'hi' ? v[1] : v[0];
      } else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, String(v));
    }
  }
  for (let i = 2; i < arguments.length; i++) add(n, arguments[i]);
  return n;
}

function pill(kind, biPair) { return h('span', { class: 'pill ' + kind, bi: biPair }); }

function fmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function alnumCount(text) { return (text.match(/[0-9A-Za-z]/g) || []).length; }

/* ==========================================================================
   3. The in-browser specimen PDF builder
   ========================================================================== */

/** Escape the three characters a PDF literal string cannot carry raw. */
function pdfString(s) {
  return String(s).replace(/[\\()]/g, (m) => '\\' + m);
}

/**
 * Hand-assemble an uncompressed single-page PDF carrying a real TD3 zone as its
 * text layer, as a Blob. No network, no template file, no dependency.
 *
 * Offsets in the xref table are computed from the actual encoded bytes, so a
 * multi-byte character anywhere in the document info still lands on the right
 * byte. Streams are never compressed, so `/Length` is the plain byte count.
 *
 * @param {{line1?: string, line2?: string, title?: string}} [opts]
 * @returns {Blob} application/pdf
 */
export function buildSpecimenPdf(opts = {}) {
  const line1 = opts.line1 || SPECIMEN_L1;
  const line2 = opts.line2 || SPECIMEN_L2;
  const title = opts.title || 'KASOTI specimen (synthetic)';
  const stamp = opts.stamp || 'D:20260101000000Z';

  // Deliberately terse visible text: every token here is far shorter than the
  // 40-character floor in findMrzCandidates(), so it can never be mistaken for
  // a second machine-readable zone.
  const heading = 'KASOTI SPECIMEN - NOT A REAL TRAVEL DOCUMENT';
  const stream = [
    'BT /F1 8 Tf 40 780 Td (' + pdfString(heading) + ') Tj ET',
    'BT /F1 10 Tf 40 730 Td 13 TL',
    '(' + pdfString(line1) + ') Tj T*',
    '(' + pdfString(line2) + ') Tj ET',
    'BT /F1 7 Tf 40 690 Td (ICAO 9303 part 4 TD3, two lines of 44 characters) Tj ET',
    '',
  ].join('\n');

  // 1 catalog, 2 pages, 3 page, 4 font, 5 contents, 6 info.
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${A4.join(' ')}] `
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    `<< /Length ${enc(stream).byteLength} >>\nstream\n${stream}endstream`,
    `<< /Title (${pdfString(title)})`
      + ' /Author (KASOTI demo)'
      + ' /Subject (Synthetic ICAO 9303 TD3 specimen)'
      + ' /Creator (KASOTI in-browser generator)'
      + ' /Producer (KASOTI in-browser generator)'
      + ` /CreationDate (${stamp}) /ModDate (${stamp}) >>`,
  ];

  // Byte-exact assembly: every offset is a count of encoded bytes, not of
  // JavaScript characters. `emit` returns the cursor *after* the chunk, so the
  // start of each object has to be read off before emitting it.
  const chunks = [];
  let cursor = 0;
  const emit = (s) => { const b = enc(s); chunks.push(b); cursor += b.byteLength; return cursor; };
  const offsets = [];

  emit('%PDF-1.4\n');
  bodies.forEach((body, i) => {
    offsets[i + 1] = cursor;
    emit(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefAt = cursor;
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= bodies.length; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  emit(xref);
  emit(`trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R /Info ${bodies.length} 0 R >>\n`);
  emit(`startxref\n${xrefAt}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

const enc = (s) => new TextEncoder().encode(s);

/* ==========================================================================
   4. pdf.js — loaded lazily, only once a file has actually been chosen
   ========================================================================== */

let pdfjsPromise = null;
let engineLoaded = false;
let workerPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    // Both paths are relative to assets/js/, i.e. assets/vendor/. Resolved with
    // `new URL(..., import.meta.url)` so this keeps working wherever the site
    // is mounted. This is a script fetch, not a document fetch.
    pdfjsPromise = import('../vendor/pdf.min.mjs').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc =
        new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      engineLoaded = true;
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * One `PDFWorker` for the whole page, built once and handed to every load.
 *
 * `loadPdfjs()` memoises the *module*, but the worker was left to pdf.js, which
 * spawns a fresh one per `getDocument` — measured over five documents as five
 * fetches of the 1.3 MB worker script and five worker targets, each one handed a
 * fresh copy of the document's bytes. `getDocument` accepts a `worker`, so we
 * build it here instead. The constructor takes no `workerSrc`: it reads the
 * `GlobalWorkerOptions.workerSrc` that `loadPdfjs()` has already set, so this
 * stays a same-origin, relative script fetch. A failed construction is not
 * cached, so a later file can retry rather than inherit a dead promise.
 */
function sharedWorker(pdfjs) {
  if (!workerPromise) {
    workerPromise = (async () => new pdfjs.PDFWorker())()
      .catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/* ==========================================================================
   5. Analysis
   ========================================================================== */

/**
 * Rebuild page text from pdf.js text items.
 *
 * `loose` is the space-join the spec asks for and is what the MRZ scanner sees.
 * `tight` respects each item's `hasEOL` flag and is what a whole-block
 * `parse()` needs, because a 2x44 zone is two *lines*, not one long one.
 */
function itemsToText(items) {
  let loose = '';
  const tightLines = [];
  let cur = '';
  for (const item of items) {
    const s = typeof item.str === 'string' ? item.str : '';
    if (s) { loose += (loose ? ' ' : '') + s; cur += s; }
    if (item.hasEOL) { tightLines.push(cur); cur = ''; }
  }
  if (cur) tightLines.push(cur);
  if (!tightLines.length) tightLines.push(loose);
  return { loose, tight: tightLines.join('\n') };
}

/**
 * Prefer whichever reading yields a recognised layout. A TD3 pair found by the
 * scanner is the reliable path; the whole-text readings are a fallback for a
 * zone that arrives already formatted as a clean block. Returns null when
 * nothing is recognised — we do not hand a half-zone to the renderer.
 */
function pickMrz(loose, tight) {
  const attempts = [];
  const cands = findMrzCandidates(loose);
  if (cands.pairs.length) attempts.push(cands.pairs[0].join('\n'));
  attempts.push(tight, loose);
  for (const attempt of attempts) {
    const r = parse(attempt);
    if (r.format !== 'UNKNOWN') return r;
  }
  return null;
}

function normaliseMeta(metadata) {
  const info = (metadata && metadata.info) || {};
  const out = [];
  const addRow = (key, raw) => {
    if (raw === null || raw === undefined) return;
    const v = raw instanceof Date
      ? (Number.isNaN(raw.getTime()) ? null : raw.toISOString())
      : String(raw).trim();
    if (v) out.push([key, v]);
  };
  addRow('Producer', info.Producer);
  addRow('Creator', info.Creator);
  addRow('CreationDate', info.CreationDate);
  addRow('ModDate', info.ModDate);
  addRow('Title', info.Title);
  return out;
}

/**
 * Read a PDF out of an ArrayBuffer. Never sees a URL, so there is nothing here
 * that could ever turn into a request for someone else's file.
 */
async function analyseBuffer(arrayBuffer) {
  const pdfjs = await loadPdfjs();
  const worker = await sharedWorker(pdfjs);
  const doc = await pdfjs.getDocument({
    data: arrayBuffer,
    worker,
    isEvalSupported: false,     // no new Function on a hostile document
    disableFontFace: true,      // never inject font faces into the page
    verbosity: 0,
  }).promise;

  try {
    const pageCount = doc.numPages;
    let loose = '';
    const tightPages = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = Array.isArray(content.items) ? content.items : [];
      const { loose: pageLoose, tight } = itemsToText(items);
      if (loose) loose += '\n';
      loose += pageLoose;
      tightPages.push(tight);
      page.cleanup();
    }

    let meta = [];
    try {
      meta = normaliseMeta(await doc.getMetadata());
    } catch (e) {
      meta = [];        // metadata is a bonus, never a reason to fail the read
    }

    const tight = tightPages.join('\n');
    return {
      pageCount,
      charCount: alnumCount(loose),
      result: pickMrz(loose, tight),
      meta,
    };
  } finally {
    // `doc.cleanup()`, deliberately not `doc.destroy()`. destroy() reaches the
    // transport, whose destroy sends "Terminate" — and the worker treats that as
    // a one-way latch: it tears down its message handler and stays terminated for
    // the life of the port, so the shared worker could never load a second
    // document. cleanup() releases this document's parsed state and page caches
    // and leaves the worker usable for the next file. Nothing is left reading
    // the bytes: we passed a buffer, so there is no stream to cancel either.
    await doc.cleanup().catch(() => {});
  }
}

function readArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsArrayBuffer(file);
  });
}

/* ==========================================================================
   6. Tape annotation
   ========================================================================== */

/**
 * Map each check digit to the characters it covers, verifying every span
 * against what the engine actually checked. Returns null on any mismatch, which
 * downgrades the render to plain tape lines rather than lying with colour.
 *
 * Exported so the main MRZ lab colours its tape from the same span table. Two
 * copies of the ICAO column layout would be two chances to be wrong.
 */
export function annotate(result) {
  const table = CHECK_SPANS[result.format];
  if (!table || table.length !== result.checks.length) return null;
  const lines = result.rawLines;

  const cells = [];
  for (let i = 0; i < table.length; i++) {
    const [field, segs, digit] = table[i];
    const check = result.checks[i];
    if (check.field !== field) return null;

    for (const [ln, from, to] of segs) {
      const line = lines[ln];
      if (typeof line !== 'string' || to > line.length) return null;
    }
    // The engine checks one concatenated string; for TD3 COMPOSITE that string
    // is the join of its parts, for everything else it is a single slice.
    const joined = segs.map(([ln, from, to]) => lines[ln].slice(from, to)).join('');
    if (joined !== check.span) return null;

    const digitLine = lines[digit[0]];
    if (typeof digitLine !== 'string' || digit[1] >= digitLine.length) return null;

    cells.push({ field, segs, digit, passed: check.passed, observed: check.observed });
  }
  return cells;
}

/** Per-line arrays of `data-cd` values, 'none' where no check digit reaches. */
export function cdMaps(result, cells) {
  const maps = result.rawLines.map((l) => new Array(l.length).fill('none'));
  if (!cells) return maps;
  for (const cell of cells) {
    const cd = cell.passed ? 'ok' : 'bad';
    for (const [ln, from, to] of cell.segs) {
      for (let i = from; i < to; i++) maps[ln][i] = cd;
    }
    maps[cell.digit[0]][cell.digit[1]] = cd;
  }
  return maps;
}

/* ==========================================================================
   7. Render
   ========================================================================== */

const state = {
  wired: false,
  entries: [],          // plain data only, so a re-render never depends on the DOM
  activeId: null,
};

let nextId = 1;
let queue = Promise.resolve();

function activeEntry() {
  return state.entries.find((e) => e.id === state.activeId) || null;
}

/**
 * The dim `.mt` line under a file name: size, page count once it is known, and
 * the limit the reason actually invoked.
 *
 * The limit clause has to stay bilingual, so it goes in as a `data-en`/`data-hi`
 * node and the middots are neutral text nodes — one language toggle covers it,
 * with no new key in i18n.js. Returns null when there is nothing to say.
 */
function metaBits(entry) {
  const bits = [];
  if (entry.size !== null) bits.push(fmtSize(entry.size));
  if (entry.analysis) bits.push(`${entry.analysis.pageCount} ${t('pdf.pages')}`);
  const limit = LIMIT_CLAUSE[entry.reasonKey];
  if (limit) bits.push(h('span', { bi: limit }));
  if (!bits.length) return null;

  const meta = h('span', { class: 'mt' });
  bits.forEach((b, i) => {
    if (i) meta.appendChild(document.createTextNode(' · '));
    add(meta, b);
  });
  return meta;
}

function fileRow(entry, isActive) {
  const kids = [];

  if (entry.busy) {
    kids.push(pill('NONE', S.loading));
  } else if (entry.kind === 'reject') {
    kids.push(pill('FAIL', S.fail));
  } else if (entry.analysis && entry.analysis.result) {
    const v = verdictOf(entry.analysis.result);
    kids.push(pill(v.pill, v.pair));
  } else {
    kids.push(pill('NONE', S.noverdict));
  }

  kids.push(h('span', { class: 'nm', text: entry.name }));
  if (entry.tag) kids.push(h('span', { bi: entry.tag }));
  if (entry.kind === 'reject') kids.push(h('span', { bi: reasonFor(entry) }));

  const meta = metaBits(entry);
  if (meta) kids.push(meta);

  const row = h('div', { class: 'filerow' }, kids);

  if (entry.analysis) {
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    if (isActive) {
      row.setAttribute('aria-current', 'true');
      row.appendChild(pill('INFO', S.marker));
    }
    const show = () => { state.activeId = entry.id; render(); };
    row.addEventListener('click', show);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); show(); }
    });
  }
  return row;
}

function verdictOf(result) {
  if (result.structuralErrors.length) return { pill: 'NONE', pair: S.unverified };
  if (allPassed(result)) return { pill: 'PASS', pair: S.pass };
  return { pill: 'FAIL', pair: S.fail };
}

function fieldRows(result) {
  const n = result.name || {};
  const rows = [
    [S.fdoc, result.documentNumber],
    [S.fsurname, n.surname],
    [S.fgiven, n.givenNames],
    [S.fnat, result.nationality],
    [S.fdob, result.birthDate],
    [S.fsex, result.sex],
    [S.fexp, result.expiryDate],
    [S.fpers, result.personalNumber],
    [S.fopt, result.optionalData],
    [S.fissuer, result.issuer],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => h('div', { class: 'frow' },
      h('span', { class: 'k', bi: k }),
      h('span', { class: 'v', text: String(v) })));
}

function checksTable(result, cells) {
  const head = h('thead', null, h('tr', null,
    h('th', { bi: S.cfield }),
    h('th', { bi: S.cexpected }),
    h('th', { bi: S.cobserved }),
    h('th', { bi: S.cverdict })));

  const body = h('tbody');
  result.checks.forEach((c, i) => {
    // `observed` is nulled by the engine when the character was the `<` filler.
    // We have the raw zone, so show the character that was actually there — "<"
    // reads as filler, "—" would hide a real byte.
    let observed = c.observed;
    const cell = cells && cells[i];
    if (cell) {
      const [ln, at] = cell.digit;
      const raw = result.rawLines[ln] ? result.rawLines[ln].charAt(at) : '';
      if (raw) observed = raw;
    }
    body.appendChild(h('tr', null,
      h('td', { text: c.field.replace(/_/g, ' ') }),
      h('td', { text: c.expected === null ? '—' : c.expected }),
      h('td', { text: observed === null ? '—' : observed }),
      h('td', null, pill(c.passed ? 'PASS' : 'FAIL', c.passed ? S.pass : S.fail))));
  });

  return h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' }, head, body));
}

function tapeBlock(result, cells) {
  const maps = cdMaps(result, cells);
  const tape = h('div', { class: 'tape' });
  result.rawLines.forEach((line, i) => {
    const lineEl = h('div', { class: 'tape-line' }, h('span', { class: 'ln', text: String(i + 1) }));
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ' ') {
        lineEl.appendChild(document.createTextNode(' '));
        continue;
      }
      const span = h('span', { class: 'f', text: ch });
      const cd = maps[i] && maps[i][c] ? maps[i][c] : 'none';
      span.setAttribute('data-cd', cd);
      lineEl.appendChild(span);
    }
    tape.appendChild(lineEl);
  });
  return tape;
}

function legendBlock() {
  const line = (cd, pair) => h('div', { class: 'frow' },
    h('span', { class: 'k', bi: pair }),
    h('span', { class: 'v' }, h('span', { class: 'f', 'data-cd': cd, text: 'AB1234567' })));
  return h('div', { class: 'fields' },
    line('ok', S.legendOk),
    line('bad', S.legendBad),
    line('none', S.legendNone));
}

const NO_METADATA = [
  'the file carries no document information dictionary, so there is nothing here to read',
  'इस फ़ाइल में कोई दस्तावेज़ सूचना शब्दकोश नहीं है, इसलिए यहाँ पढ़ने के लिए कुछ नहीं है',
];
const NO_COLOUR = [
  'Per-character colouring is off: we could not map these check spans onto the zone with confidence.',
  'प्रति-अक्षर रंगन बंद है: हम इन चेक स्पैन को क्षेत्र पर भरोसे से नहीं मैप कर सके।',
];
const DIM = 'color:var(--ink-3);font-size:.78rem';
const lang = (pair) => (getLang() === 'hi' ? pair[1] : pair[0]);

function metaBlock(meta) {
  const caveat = h('p', { class: 'mono', style: DIM, bi: S.metaCaveat, text: lang(S.metaCaveat) });

  if (!meta.length) {
    return h('div', null,
      h('h4', { class: 'mt', text: t('pdf.meta') }),
      caveat,
      h('p', { class: 'mono mb0', style: DIM, bi: NO_METADATA, text: lang(NO_METADATA) }));
  }

  const body = h('tbody');
  meta.forEach(([key, value]) => {
    const pair = S.metaKey[key] || [key, key];
    body.appendChild(h('tr', null,
      h('td', { class: 'lbl', bi: pair }),
      h('td', { text: value })));   // untrusted: textContent only
  });
  return h('div', null,
    h('h4', { class: 'mt', text: t('pdf.meta') }),
    caveat,
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'data' }, body)));
}

function resultsPanel(entry) {
  const a = entry.analysis;
  const result = a.result;
  const scanned = a.pageCount > 0 && a.charCount < SCANNED_ALNUM_FLOOR;
  const cells = result ? annotate(result) : null;
  const v = result ? verdictOf(result) : { pill: 'NONE', pair: S.noverdict };

  const card = h('div', { class: 'card' });

  card.appendChild(h('div', { class: 'bigverdict' },
    h('span', { class: 'lbl', bi: S.zone }),
    pill(v.pill, v.pair)));

  card.appendChild(h('div', { class: 'mb0' }, h('span', { class: 'pill PASS', text: t('pdf.privacy') })));

  card.appendChild(h('div', { class: 'mt' },
    h('div', { class: 'filerow' },
      h('span', { class: 'nm', text: entry.name }),
      h('span', { class: 'mt', text: `${fmtSize(entry.size)} · ${a.pageCount} ${t('pdf.pages')}` }))));

  if (scanned) {
    card.appendChild(h('div', { class: 'notice mt', text: t('pdf.scanned') }));
  }

  if (result) {
    card.appendChild(h('h4', { class: 'mt', bi: S.fields }));
    card.appendChild(h('div', { class: 'fields' }, fieldRows(result)));
    card.appendChild(tapeBlock(result, cells));
    card.appendChild(h('h4', { bi: S.checks }));
    card.appendChild(checksTable(result, cells));
    if (cells) {
      card.appendChild(h('div', { class: 'mt' }, legendBlock()));
    } else {
      // We could not justify which characters belong to which check digit, so we
      // say so instead of colouring characters we cannot stand behind.
      card.appendChild(h('p', { class: 'mono mb0', style: DIM, bi: NO_COLOUR, text: lang(NO_COLOUR) }));
    }

    if (result.structuralErrors.length) {
      card.appendChild(h('div', { class: 'notice mt' },
        h('div', { bi: S.structure }),
        h('ul', null, result.structuralErrors.map((m) => h('li', { class: 'mono', text: m })))));
    } else {
      const failed = failedFields(result);
      if (failed.length) {
        card.appendChild(h('div', { class: 'notice mt' },
          h('b', { bi: S.fail }),
          h('span', { class: 'mono', text: failed.map((f) => f.replace(/_/g, ' ')).join(' · ') })));
      }
    }
  } else if (!scanned) {
    card.appendChild(h('div', { class: 'notice plain mt', text: t('pdf.nomrz') }));
  }

  card.appendChild(metaBlock(a.meta));
  return card;
}

/**
 * The panel for a file we refused to read. The previous good result is not left
 * on screen: a panel showing specimen-valid.pdf while the user is looking at
 * locked.pdf would be a claim about the wrong document.
 */
function rejectionPanel(entry) {
  const card = h('div', { class: 'card' });
  card.appendChild(h('div', { class: 'bigverdict' },
    h('span', { class: 'lbl', bi: S.zone }),
    pill('NONE', S.noverdict)));
  card.appendChild(h('div', { class: 'mb0' },
    h('span', { class: 'pill PASS', text: t('pdf.privacy') })));
  card.appendChild(h('div', { class: 'mt' },
    h('div', { class: 'filerow' },
      h('span', { class: 'nm', text: entry.name }),
      metaBits(entry))));
  card.appendChild(h('div', { class: 'notice plain mt', bi: reasonFor(entry) }));
  return card;
}

/** The bilingual reason text for a refused file, with {size} filled in. */
function reasonFor(entry) {
  const pair = S[entry.reasonKey] || [entry.reasonKey, entry.reasonKey];
  return pair.map((s) => s.replace('{size}', fmtSize(entry.size === null ? 0 : entry.size)));
}

/**
 * The panel while the bytes are still being read.
 *
 * A busy entry has `analysis === null`, so without this it fell through to the
 * hidden branch: the previous document's verdict vanished for the length of the
 * parse and then came back, which reads as the panel glitching. Worse, a blank
 * panel next to a file row showing a verdict is a claim the panel is not
 * finished with. Naming the file and saying we are reading it is the honest
 * state, and it is the same state the tape row is already in.
 */
function pendingPanel(entry) {
  const card = h('div', { class: 'card' });
  card.appendChild(h('div', { class: 'bigverdict' },
    h('span', { class: 'lbl', bi: S.zone }),
    pill('NONE', S.reading)));
  card.appendChild(h('div', { class: 'mb0' },
    h('span', { class: 'pill PASS', text: t('pdf.privacy') })));
  card.appendChild(h('div', { class: 'mt' },
    h('div', { class: 'filerow' },
      h('span', { class: 'nm', text: entry.name }),
      metaBits(entry))));
  card.appendChild(h('div', { class: 'notice plain mt', bi: S.readingNote }));
  return card;
}

function render() {
  const filelist = document.getElementById('filelist');
  const results = document.getElementById('pdf-results');
  const drop = document.getElementById('drop');
  if (drop) drop.setAttribute('aria-label', t('pdf.pick'));

  if (filelist) {
    filelist.textContent = '';
    state.entries.forEach((e) => filelist.appendChild(fileRow(e, e.id === state.activeId)));
    if (state.entries.some((e) => e.analysis)) {
      filelist.appendChild(h('p', { class: 'mono mb0', style: DIM, bi: S.taprow }));
    }
    applyStatic(filelist);
  }

  if (results) {
    const entry = activeEntry();
    results.textContent = '';
    if (entry && entry.analysis) {
      results.classList.remove('hidden');
      results.appendChild(resultsPanel(entry));
    } else if (entry && entry.kind === 'reject') {
      results.classList.remove('hidden');
      results.appendChild(rejectionPanel(entry));
    } else if (entry && entry.busy) {
      results.classList.remove('hidden');
      results.appendChild(pendingPanel(entry));
    } else {
      results.classList.add('hidden');
    }
    applyStatic(results);
  }
}

/* ==========================================================================
   8. Intake
   ========================================================================== */

function addEntry(entry) {
  const e = Object.assign({ id: nextId++, kind: 'file', name: '(unnamed)', size: null, analysis: null, busy: false }, entry);
  state.entries.push(e);
  while (state.entries.length > FILEROW_CAP) state.entries.shift();
  return e;
}

function reject(name, size, reasonKey) {
  // Same rule as intake(): refusing a file is a new user action, so the refusal
  // is what the panel must show. Without this the previous document's verdict
  // stayed on screen — a claim about a document the visitor is no longer
  // holding — and rejectionPanel() was unreachable for every synchronous
  // rejection path.
  const entry = addEntry({ kind: 'reject', name, size, reasonKey });
  state.activeId = entry.id;
  render();
}

/**
 * A new file is a new user action, so its result is what the panel shows. The
 * specimen button queues two, and this way the intact one — queued second —
 * is what a judge sees first, with the altered one a click away.
 */
function intake(name, size, tag) {
  const entry = addEntry({ name, size, tag: tag || null });
  entry.busy = true;
  state.activeId = entry.id;
  render();
  return entry;
}

/**
 * Run analyses one at a time. Returns *this call's own* promise, so its errors
 * are reported against its own row; `queue` itself is kept non-rejecting so one
 * bad document cannot stall the documents behind it.
 */
function serialise(task) {
  const run = queue.then(() => task());
  queue = run.catch(() => {});
  return run;
}

function finish(entry, analysis) {
  entry.analysis = analysis;
  entry.busy = false;
  render();
}

function handleBuffer(entry, readBuffer) {
  return serialise(async () => {
    const buffer = await readBuffer();
    const analysis = await analyseBuffer(buffer);
    if (analysis.pageCount === 0) {
      entry.kind = 'reject';
      entry.reasonKey = 'nopages';
      entry.busy = false;
      render();
      return;
    }
    finish(entry, analysis);
  })
    .catch((err) => {
      // Fail closed and say why. Anything the parser throws at us — encryption,
      // a truncated xref, a hostile object — lands here as "we could not read
      // it", never as a pass. A failure to load the engine itself is reported as
      // our problem rather than blamed on the document.
      entry.busy = false;
      entry.kind = 'reject';
      entry.reasonKey = !engineLoaded ? 'enginefail'
        : (err && err.name === 'PasswordException' ? 'locked' : 'unopenable');
      render();
    });
}

function handleFile(file) {
  const name = file.name || '(unnamed)';
  const size = file.size;
  const isPdf = /^(application\/pdf|application\/x-pdf)$/i.test(file.type) || /\.pdf$/i.test(name);
  if (!isPdf) { reject(name, size, 'notpdf'); return; }
  if (size > MAX_BYTES) { reject(name, size, 'toobig'); return; }
  handleBuffer(intake(name, size), () => readArrayBuffer(file));
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) { reject('—', null, 'nofile'); return; }
  files.forEach(handleFile);
}

/* ==========================================================================
   9. Specimens
   ========================================================================== */

/** Flip position 9 of line 1 (the document-number check digit) to the other bit. */
function alteredSpecimen() {
  const at = 9;
  const original = SPECIMEN_L1.charAt(at);
  const flipped = original === '0' ? '1' : '0';
  return SPECIMEN_L1.slice(0, at) + flipped + SPECIMEN_L1.slice(at + 1);
}

/* ==========================================================================
   10. Wiring
   ========================================================================== */

export function initPdfPanel() {
  const drop = document.getElementById('drop');
  const input = document.getElementById('file-input');
  const sample = document.getElementById('pdf-sample');

  if (state.wired) { render(); return; }   // main.js may call this more than once
  state.wired = true;

  if (drop) {
    // A drag that starts over the dropzone fires dragenter/dragleave for every
    // child element it crosses, so the highlight is driven by a depth counter
    // rather than by the last event.
    let depth = 0;
    const off = () => { depth = 0; drop.classList.remove('over'); };

    drop.addEventListener('click', () => { if (input) input.click(); });
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (input) input.click();
      }
    });
    drop.addEventListener('dragenter', (e) => {
      e.preventDefault();
      depth += 1;
      drop.classList.add('over');
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();                 // without this the browser opens the file
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    drop.addEventListener('dragleave', (e) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (!depth) drop.classList.remove('over');
    });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      off();
      handleFiles(e.dataTransfer && e.dataTransfer.files);
    });

    // A drop that misses the dropzone would otherwise replace the whole page
    // with the document. Neutralise it page-wide: we never read it, we simply
    // refuse to navigate. Nothing is transmitted by cancelling a drop.
    const swallow = (e) => { e.preventDefault(); off(); };
    window.addEventListener('dragend', off);
    window.addEventListener('drop', swallow);
    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    });
  }

  if (input) {
    input.addEventListener('change', () => {
      // Snapshot first. `input.files` returns the *same* live FileList object on
      // every access, so `input.value = ''` below empties the very list we just
      // handed over (measured: length 1 -> 0) and `handleFiles` then took its
      // "no file" branch — the primary call to action analysed nothing at all.
      // The copy is what survives the reset; the reset is what makes re-picking
      // the same file fire `change` again.
      const files = Array.from(input.files || []);
      input.value = '';
      handleFiles(files);
    });
  }

  if (sample) {
    sample.addEventListener('click', () => {
      // Two blobs, two full analyses, no fetch. Altered is queued first and
      // intact second, so the panel lands on green and a judge can click the
      // red row to see the catch.
      const altered = buildSpecimenPdf({
        line1: alteredSpecimen(),
        title: 'KASOTI specimen (check digit altered)',
      });
      handleBuffer(intake('specimen-altered.pdf', altered.size, S.alteredSpec),
        () => altered.arrayBuffer());

      const valid = buildSpecimenPdf({ title: 'KASOTI specimen (valid)' });
      handleBuffer(intake('specimen-valid.pdf', valid.size, S.validSpec),
        () => valid.arrayBuffer());
    });
  }

  render();
}

/**
 * Re-render everything this module owns in the current language. main.js calls
 * this on the language toggle. Safe to call before init: with no state there is
 * simply nothing to draw.
 */
export function rerenderPdfPanel() {
  render();
}
