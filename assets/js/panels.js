/**
 * Docuscan — the replay panels: verdicts, the measurement record, the limits, the footer.
 *
 * Three rules govern this file, and they matter more than the layout:
 *
 *  1. Nothing here computes a verdict or a metric. This is a replay surface. The verdict
 *     panels carry the engine's own console transcripts verbatim, and the measurement
 *     panel carries the harness's own record. If a number is not in the JSON, it is
 *     rendered as an em-dash — never as a plausible guess.
 *  2. No measurement figure appears as a literal in this file. Every number in the
 *     measurement panel is read at render time from `data/evalrun.json`, and every count
 *     in the limits panel and in the verdict section — scenarios, findings, shared layer
 *     rows, differing layer rows — is counted out of `data/scenarios.json` rather than
 *     typed in. The only numbers written here are display precision (decimal places), the
 *     0–100 bar clamp, and the four-word cap on an index chip's label.
 *  3. Failure is rendered, not swallowed. A blank panel reads as "no results", which for a
 *     project whose whole claim is fail-closed would be a lie in the other direction. A
 *     failed fetch produces a visible error block.
 *
 * Re-rendering: fetched JSON and transcript text are held in module state, so a language
 * toggle re-renders from memory. Every panel clears its container before it fills it, so
 * re-rendering is idempotent and concurrent renders cannot duplicate content.
 */

import { t, getLang } from './i18n.js';

const SCENARIOS_URL = 'data/scenarios.json';
const EVALRUN_URL = 'data/evalrun.json';
const EM = '—';

/* ------------------------------------------------------------------ state -- */

let scenData = null;
let evalData = null;
let scenPromise = null;
let evalPromise = null;
let limitsLoadFailed = false;   // keeps a failed record from retrying on every toggle
const transcriptCache = new Map();   // path -> { text } | { error }
const transcriptPromise = new Map();

/* --------------------------------------------------------------- utilities -- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  node.__node = true;
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

function isNode(v) { return v != null && typeof v === 'object' && v.__node === true; }

/** Element whose text follows the UI language, carrying both forms for applyStatic(). */
function bi(tag, cls, en, hi) {
  const node = el(tag, cls);
  node.setAttribute('data-en', en);
  node.setAttribute('data-hi', hi);
  node.textContent = getLang() === 'hi' ? hi : en;
  return node;
}

function isHindi() { return getLang() === 'hi'; }

function fill(host, ...nodes) {
  host.replaceChildren(...nodes.filter(Boolean));
}

/** A missing value is an em-dash. It is never zero and never omitted. */
function em(v) {
  if (v == null || v === '') return EM;
  return String(v);
}

function group(v) {
  if (typeof v !== 'number') return em(v);
  return v.toLocaleString('en-US');
}

/** Percentages in `buckets` are 0–100; that is where this is used. */
function pct(v, digits = 2) {
  if (typeof v !== 'number') return em(v);
  return `${Number(v.toFixed(digits))}%`;
}

function ms(v) {
  if (typeof v !== 'number') return em(v);
  return String(Number(v.toFixed(4)));
}

function pill(cls, text) {
  return el('span', `pill ${cls}`, text);
}

function bar(percent) {
  const track = el('div', typeof percent === 'number' && percent < 100 ? 'bar warn' : 'bar');
  const fillBar = el('i');
  const w = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0;
  fillBar.style.width = `${w}%`;
  track.appendChild(fillBar);
  return track;
}

/* ------------------------------------------------------------------ fetch -- */

async function loadJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`network: ${e && e.message ? e.message : e}`);
  }
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

function loadScenarios() {
  if (scenPromise) return scenPromise;
  scenPromise = (async () => {
    try {
      scenData = await loadJson(SCENARIOS_URL);
      return scenData;
    } catch (err) {
      scenData = null;
      scenPromise = null;          // a later call may retry
      throw err;
    }
  })();
  return scenPromise;
}

function loadEvalRun() {
  if (evalPromise) return evalPromise;
  evalPromise = (async () => {
    try {
      evalData = await loadJson(EVALRUN_URL);
      return evalData;
    } catch (err) {
      evalData = null;
      evalPromise = null;
      throw err;
    }
  })();
  return evalPromise;
}

async function loadTranscript(path) {
  if (transcriptCache.has(path)) return transcriptCache.get(path);
  if (transcriptPromise.has(path)) return transcriptPromise.get(path);
  const p = (async () => {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path} responded ${res.status}`);
      const text = await res.text();
      const out = { text };
      transcriptCache.set(path, out);
      return out;
    } catch (err) {
      const out = { error: err && err.message ? err.message : String(err) };
      transcriptCache.set(path, out);
      return out;
    } finally {
      transcriptPromise.delete(path);
    }
  })();
  transcriptPromise.set(path, p);
  return p;
}

/* --------------------------------------------------------- error / loading -- */

function errorBlock(host, whatEn, whatHi) {
  const box = el('div', 'notice');
  box.appendChild(bi('h4', null, `${whatEn} could not be loaded`, `${whatHi} लोड नहीं हो सका`));
  box.appendChild(bi('p', 'mb0',
    'This panel would be showing you nothing. It is showing you this instead, rather than a blank space that would read as "no results".',
    'यह पैनल आपको कुछ नहीं दिखा रहा था। इसके बजाय यह दिखा रहा है — खाली जगह छोड़ने से लगता कि "कोई परिणाम नहीं"।'));
  host.replaceChildren(box);
}

function loadingBlock(host, en, hi) {
  host.replaceChildren(el('div', 'notice plain', isHindi() ? hi : en));
}

/* ---------------------------------------------------------------- helpers -- */

/** table.data inside a .tbl-scroll. cols: { en, hi, cls, num }. */
function dataTable(cols, rows) {
  const wrap = el('div', 'tbl-scroll');
  const table = el('table', 'data');
  const thead = el('thead');
  const htr = el('tr');
  for (const c of cols) htr.appendChild(bi('th', c.cls || null, c.en, c.hi));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((cell, i) => {
      const c = cols[i] || {};
      const td = el('td', c.num ? 'n' : null);
      if (cell == null) td.textContent = EM;
      else if (isNode(cell)) td.appendChild(cell);
      else if (Array.isArray(cell)) cell.forEach((n) => td.appendChild(n));
      else td.textContent = String(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function statTile(cls, value, enLabel, hiLabel) {
  const tile = el('div', cls ? `stat ${cls}` : 'stat');
  tile.appendChild(el('b', null, value));
  tile.appendChild(bi('i', null, enLabel, hiLabel));
  return tile;
}

function statgrid(tiles) {
  const grid = el('div', 'statgrid');
  for (const t of tiles) grid.appendChild(t);
  return grid;
}

/** Distinct first path segments of a flat "ARM/SUBKEY" bucket table, in file order. */
function armsOf(table) {
  const seen = [];
  for (const key of Object.keys(table || {})) {
    const arm = key.slice(0, key.indexOf('/'));
    if (!seen.includes(arm)) seen.push(arm);
  }
  return seen;
}

function cell(table, arm, sub) {
  const k = `${arm}/${sub}`;
  return table && k in table ? table[k] : undefined;
}

function sumArms(table, sub) {
  let total = 0;
  let any = false;
  for (const arm of armsOf(table)) {
    const v = cell(table, arm, sub);
    if (typeof v === 'number') { total += v; any = true; }
  }
  return any ? total : undefined;
}

/* ------------------------------------------------- facts counted, not typed -- */

/** The run record's own note for one suite. Each suite names its own notes, so the
 *  suite is asked for its caveats rather than the text being keyword-matched here. */
function suiteNotes(ev, suite) {
  const suites = ((ev || {}).governance || {}).suites || [];
  const row = Array.isArray(suites) ? suites.find((s) => s && s.suite === suite) : null;
  const notes = row && Array.isArray(row.notes) ? row.notes : [];
  return notes.filter((n) => typeof n === 'string' && n.length);
}

/** Suites that get a table of their own below. The rest are carried by gatesCard. */
const SUITES_WITH_TABLE = ['mrz', 'qr', 'diary', 'latency'];

/** How each threshold in the run was given its value, split by the record's own field.
 *  `selectedOnSplit === 'untuned'` means a human typed the number; anything else means a
 *  decision was recorded. So "every threshold is untuned" is not available to be claimed
 *  here — it is either true for this run or the sentence is not printed at all. */
function thresholdFacts(ev) {
  const gov = (ev || {}).governance || {};
  const ops = Array.isArray(gov.operatingPoints) ? gov.operatingPoints.filter(Boolean) : [];
  const sd = gov.splitDiscipline || {};
  const untuned = ops.filter((o) => o.selectedOnSplit === 'untuned');
  const decided = ops.filter((o) => o.selectedOnSplit !== 'untuned');
  const sdUntuned = Array.isArray(sd.untuned) ? sd.untuned.length : undefined;
  return {
    ok: ops.length > 0,
    // undefined rather than 0 when the record says nothing: a missing count is an
    // em-dash, never a zero that reads as a measurement.
    checked: ops.length || undefined,
    untuned: ops.length ? untuned.length : undefined,
    decidedNames: decided.map((o) => o.threshold).filter(Boolean),
    agreement: sdUntuned == null || untuned.length === sdUntuned,
    sdUntuned,
  };
}

/** Regex match against an already-fetched transcript, or null. The raw <details> block
 *  keeps the transcript byte-verbatim; this is how a line the capture script does not
 *  parse is lifted out of it and shown in the visible part of a card. */
function transcriptMatch(path, re) {
  const cached = transcriptCache.get(path);
  const text = cached && typeof cached.text === 'string' ? cached.text : null;
  return text ? text.match(re) : null;
}

const RE_DEMO_RUN = /^[^\S\n]*·[^\S\n]*DEMO RUN[^\n]*/m;
const RE_SYNTHETIC_MACRO = /^[^\S\n]*·[^\S\n]*SYNTHETIC MACRO MODEL[^\n]*/m;
const RE_IMAGE_NAME = /^[^\S\n]*image[^\S\n]+([^\s]+)[^\S\n]*$/m;

/** A finding the engine itself attributes to the macro (print-process) layer. The
 *  evidence ref is the engine's own attribution, so this needs no list of known codes
 *  and cannot drift when the engine grows a new one. */
function macroFindingCodes(s) {
  return ((s || {}).findings || [])
    .filter((f) => f && typeof f.evidence === 'string' && f.evidence.startsWith('macro/'))
    .map((f) => em(f.code));
}

function small(en, hi) { return bi('small', null, en, hi); }

function para(en, hi) { return bi('p', null, en, hi); }

function h4(en, hi) { return bi('h4', null, en, hi); }

function cardTight(...nodes) {
  const c = el('div', 'card tight');
  for (const n of nodes) if (n) c.appendChild(n);
  return c;
}

function card(...nodes) {
  const c = el('div', 'card mt');
  for (const n of nodes) if (n) c.appendChild(n);
  return c;
}

/** A prominent box. `verbatim` is one of the engine's own lines, quoted without edits
 *  — the record is English-only, so the framing around it is bilingual and the quote
 *  is not, and an element carrying no data-en/data-hi is left alone by applyStatic().
 *  `cls` lets the section-level boxes drop the stacked-card margin they do not need. */
function caveatBox(headEn, headHi, lines, quoteLabel, verbatim, cls) {
  const box = el('div', cls || 'notice mt');
  box.appendChild(bi('h4', null, headEn, headHi));
  for (const [en, hi] of lines) box.appendChild(bi('p', 'mb0', en, hi));
  if (verbatim) {
    box.appendChild(small(quoteLabel.en, quoteLabel.hi));
    box.appendChild(el('b', null, verbatim));
  }
  return box;
}

/** The run record's own notes for a suite, word for word. */
function suiteNotesBlock(ev, suite) {
  const notes = suiteNotes(ev, suite);
  if (!notes.length) return null;
  const box = el('div');
  box.appendChild(h4(
    'What this suite’s own record says',
    'यह सूट का अपना रिकॉर्ड क्या कहता है'));
  const list = el('ul');
  for (const n of notes) list.appendChild(el('li', null, n));
  box.appendChild(list);
  box.appendChild(small(
    'Copied word for word out of the run record. The record is written in English; the reading of it is ours.',
    'रन रिकॉर्ड से शब्दशः लिया गया। रिकॉर्ड अंग्रेज़ी में लिखा है; इसकी व्याख्या हमारी है।'));
  return box;
}

/* ================================================================ verdicts == */

const VERDICT_PILL = { GREEN: 'GREEN', RED: 'RED', AMBER: 'AMBER', GREY: 'GREY' };

const KNOWN_LAYER_STATES = ['RAN', 'SKIPPED', 'UNAVAILABLE'];
const KNOWN_SEVERITIES = ['RED', 'AMBER', 'GREY', 'GREEN', 'INFO'];

function layerStateClass(state) {
  const up = String(state || '').toUpperCase();
  return KNOWN_LAYER_STATES.includes(up) ? up : 'MISSING';
}

function severityClass(sev) {
  const up = String(sev || '').toUpperCase();
  return KNOWN_SEVERITIES.includes(up) ? up : null;
}

const FINDING_HEADS = [['Severity', 'गंभीरता'], ['Code', 'कोड'], ['Evidence', 'साक्ष्य'], ['Detail', 'विवरण']];

/** The engine stamps every decision in this build as a demo, and prints why. It says so
 *  on all five runs, so it is stated once for the section rather than five times: the
 *  capture script parses only LAYERS/FINDINGS/WARNINGS/POLICY, so that line never
 *  reaches scenarios.json — it is lifted out of the transcript here and shown, not left
 *  inside the collapsed raw block. Each card still carries a one-line marker of its own,
 *  so a judge who scrolls to the fifth card has not lost the disclosure.
 *
 *  The only wording that moves is the deictic "this card": at section level there is no
 *  card, so it names the count instead. The claim itself is unchanged. */
function demoRunNotice(list) {
  const first = list[0];
  const m = first ? transcriptMatch(first.transcript, RE_DEMO_RUN) : null;
  return caveatBox(
    'This is a demo run — the decision below is not evidence',
    'यह डेमो रन है — नीचे का निर्णय साक्ष्य नहीं है',
    [[
      `The engine marks every verdict it produces in this build as a demo, and it says so itself. Nothing on any of the ${group(list.length)} cards below is a finding about a real document, and nothing here should be quoted as one.`,
      `इंजन इस बिल्ड में बनाए हर निर्णय को डेमो के रूप में चिह्नित करता है, और वह ख़ुद भी यह बताता है। नीचे दिए ${group(list.length)} कार्डों में से किसी एक पर भी असली दस्तावेज़ के बारे में कोई निष्कर्ष नहीं है, और यहाँ से कुछ भी ऐसे रूप में नहीं कहा जाना चाहिए।`,
    ]],
    { en: 'The engine’s own line, from the first transcript below:', hi: 'इंजन की अपनी पंक्ति, नीचे दिए पहले ट्रांसक्रिप्ट से:' },
    m ? m[0].trim() : null,
    'notice',
  );
}

/** What stays on every card, so the disclosure is not only somewhere above the set. It
 *  carries the engine's own token for the stamp — the word the transcript itself uses —
 *  and is plain header text, not a tooltip and not a collapsed block. */
function demoRunMarker() {
  return bi('small', null, 'demoMode · not evidence', 'demoMode · साक्ष्य नहीं');
}

/** Only for a card whose findings the engine attributes to the macro layer, so the
 *  disclosure names the codes at issue rather than casting suspicion on all five. */
function syntheticMacroNotice(s, codes) {
  const m = transcriptMatch(s.transcript, RE_SYNTHETIC_MACRO);
  const named = codes.join(', ');
  return caveatBox(
    'Part of this verdict rests on a model trained on generated textures',
    'इस निर्णय का एक हिस्सा कृत्रिम टेक्स्चर पर प्रशिक्षित मॉडल पर टिका है',
    [[
      `The findings ${named} on this card were produced by the synthetic macro classifier, which was fitted only on generated textures. On this card the verdict shows that the fusion rules fire; it is not a claim that this document is a screen print, and the classifier's own score is not evidence about any print process.`,
      `इस कार्ड पर ${named} निष्कर्ष कृत्रिम मैक्रो क्लासिफ़ायर से आए हैं, जो केवल कृत्रिम बनाए टेक्स्चर पर फिट किया गया था। इस कार्ड पर निर्णय यह दिखाता है कि फ्यूज़न नियम चलते हैं; यह दावा नहीं करता कि यह दस्तावेज़ स्क्रीन-प्रिंट है, और क्लासिफ़ायर का अपना स्कोर किसी प्रिंट प्रोसेस के बारे में साक्ष्य नहीं है।`,
    ]],
    { en: 'The engine’s own line, from the transcript below:', hi: 'इंजन की अपनी पंक्ति, नीचे दी ट्रांसक्रिप्ट से:' },
    m ? m[0].trim() : null,
  );
}

/** Scope of the whole set, stated before any of the five cards: one generated image,
 *  never a real document, and how many of the verdicts lean on the synthetic classifier. */
function scenariosScopeNotice(list) {
  const names = [...new Set(list.map((s) => {
    const m = transcriptMatch(s.transcript, RE_IMAGE_NAME);
    return m ? m[1] : null;
  }).filter(Boolean))];
  let geom = null;
  for (const s of list) {
    const layer = (s.layers || []).find((l) => l && l.layer === 'image');
    if (layer && layer.detail) { geom = layer.detail; break; }
  }
  const macroCards = list.filter((s) => macroFindingCodes(s).length);

  return caveatBox(
    'What all of these were run on',
    'इन सब पर क्या चलाया गया',
    [
      [
        `All ${group(list.length)} scenarios below were screened against one generated image — ${em(names.join(', '))} — which the image layer records as ${em(geom)}. It is a synthetic specimen, not a scanned travel document. No real document has been screened through this page.`,
        `नीचे के सभी ${group(list.length)} परिदृश्य एक ही बनाई गई छवि पर जाँचे गए — ${em(names.join(', '))} — जिसे इमेज परत ${em(geom)} के रूप में दर्ज करती है। यह एक कृत्रिम नमूना है, किसी स्कैन किए गए यात्रा दस्तावेज़ नहीं। इस पृष्ठ से कोई असली दस्तावेज़ नहीं जाँचा गया।`,
      ],
      [
        `${group(macroCards.length)} of these ${group(list.length)} verdicts carry findings produced by the synthetic macro classifier, and those cards say so on the card itself. The fusion coverage rules and the track matrix have also never been exercised against the real SPECIMEN tracks, because that artwork does not exist yet — the source project tracks this as risk R-L.`,
        `इन ${group(list.length)} निर्णयों में से ${group(macroCards.length)} में कृत्रिम मैक्रो क्लासिफ़ायर से आए निष्कर्ष हैं, और वे कार्ड स्वयं यह अपने भीतर बताते हैं। फ्यूज़न कवरेज नियम और ट्रैक मैट्रिक्स को असली SPECIMEN ट्रैकों पर कभी परखा नहीं गया, क्योंकि वह कलाकृति अभी मौजूद ही नहीं है — स्रोत परियोजना इसे जोखिम R-L के रूप में दर्ज करती है।`,
      ],
    ],
    null,
    null,
    'notice',
  );
}

function findingsTable(findings) {
  const wrap = el('div', 'tbl-scroll');
  const table = el('table', 'finds');
  const thead = el('thead');
  const htr = el('tr');
  for (const [en, hi] of FINDING_HEADS) htr.appendChild(bi('th', null, en, hi));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = el('tbody');
  if (!findings.length) {
    const tr = el('tr');
    const td = bi('td', null,
      'The engine returned no findings for this document. That is what it returned — it is not a statement that the document is clean.',
      'इस दस्तावेज़ के लिए इंजन ने कोई निष्कर्ष नहीं लौटाया। यही उसका उत्तर है — यह यह नहीं कहता कि दस्तावेज़ साफ़ है।');
    td.colSpan = FINDING_HEADS.length;
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const f of findings) {
      const tr = el('tr');
      const sev = el('td', null, em(f.severity));
      const cls = severityClass(f.severity);
      if (cls) sev.className = `sev ${cls}`;   // unrecognised severity stays uncoloured
      tr.appendChild(sev);
      tr.appendChild(el('td', null, em(f.code)));
      tr.appendChild(el('td', null, em(f.evidence)));
      tr.appendChild(el('td', null, em(f.detail)));
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* -------------------------------------------------------------- anchors -- */

/** Anchor id for one card. Deterministic from the scenario id, so a deep link keeps
 *  resolving after a re-render and after the data file is regenerated. A duplicate id in
 *  the record would put two cards behind one link, so it is disambiguated by position
 *  here rather than quietly shipping a broken anchor. */
function anchorId(s, index, seen) {
  const base = `scenario-${slug(s && s.id) || `card-${index + 1}`}`;
  let id = base;
  let n = 2;
  while (seen.has(id)) { id = `${base}-${n}`; n += 1; }
  seen.add(id);
  return id;
}

function slug(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* The index chip label is cut out of the recorded title, never written here: stop at the
   first comma or dash, then at four words, then drop a leading article and any trailing
   function word so the chip does not end on "THE". The full title rides along as the
   link's own title attribute, so nothing is lost by the shortening. */
const LABEL_EDGES = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'and', 'or', 'but', 'we', 'is', 'was', 'are', 'that', 'as', 'by', 'from',
  'without', 'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'between',
  'than', 'when', 'while', 'which', 'not', 'no', 'nor', 'so']);

function shortLabel(title) {
  const first = String(title == null ? '' : title).split(/[,;]|[—–]/)[0].trim();
  let words = first.split(/\s+/).filter(Boolean);
  if (!words.length) return EM;
  if (words.length > 4) {
    words = words.slice(0, 4);
    while (words.length > 2 && LABEL_EDGES.has(words[words.length - 1].toLowerCase())) words.pop();
  }
  if (words.length > 2 && LABEL_EDGES.has(words[0].toLowerCase())) words = words.slice(1);
  return words.join(' ');
}

/** One chip per card: the verdict in its own colour, the title as a short label, the
 *  whole title on hover. Plain anchors, so a deep link is copyable and works with the
 *  browser's own scrolling rather than a click handler. */
function scenarioIndex(list, ids) {
  const strip = el('div', 'samples');
  list.forEach((s, i) => {
    const verdict = String(s.verdict || '').toUpperCase();
    const title = isHindi() ? s.titleHi : s.title;
    const a = el('a', `pill ${VERDICT_PILL[verdict] || 'NONE'}`);
    a.setAttribute('href', `#${ids[i]}`);
    a.setAttribute('title', em(title));
    a.appendChild(el('span', null, em(s.verdict)));
    a.appendChild(document.createTextNode(' · '));
    a.appendChild(el('span', null, shortLabel(title)));
    strip.appendChild(a);
  });
  return strip;
}

/* -------------------------------------------------------------- layers -- */

/* All five cards recorded the same eight layers, and six of those rows read identically
   on all five. Printing them five times meant the one or two rows that actually differ
   were impossible to see, so the invariant rows are lifted once into the ledger below
   and each card keeps the rows that differ. Nothing is dropped: the card names every
   row it is not repeating, and the ledger carries its name, state and detail. */

function layerKey(l) {
  return JSON.stringify([em(l.state), em(l.detail)]);
}

/** Layer name -> the layer row, for every row that reads the same on every card.
 *  With one card "identical on all cards" is true of everything and says nothing, so
 *  nothing is treated as shared and the card keeps all of its rows. */
function commonLayerRows(list) {
  const common = new Map();
  if (list.length < 2) return common;
  const byLayer = new Map();
  for (const s of list) {
    for (const l of (s && s.layers) || []) {
      if (!l || !l.layer) continue;
      if (!byLayer.has(l.layer)) byLayer.set(l.layer, new Map());
      const seen = byLayer.get(l.layer);
      const key = layerKey(l);
      if (seen.has(key)) seen.get(key).n += 1;
      else seen.set(key, { layer: l, n: 1 });
    }
  }
  for (const [name, seen] of byLayer) {
    if (seen.size !== 1) continue;
    const only = [...seen.values()][0];
    if (only.n === list.length) common.set(name, only.layer);
  }
  return common;
}

function distinctLayerCount(list) {
  const names = new Set();
  for (const s of list) for (const l of (s && s.layers) || []) if (l && l.layer) names.add(l.layer);
  return names.size;
}

/** The shared rows, printed once. A layer state a judge could draw a conclusion from is
 *  never in here alone: name, state and engine detail all appear, side by side. */
function commonLayersNotice(list, common) {
  if (!common.size) return null;
  const total = distinctLayerCount(list);
  const box = el('div', 'notice plain');
  box.appendChild(bi('h4', null,
    'The layers every scenario read the same',
    'जिन परतों का हर परिदृश्य में एक जैसा पाठ है'));
  box.appendChild(bi('p', 'mb0',
    `${group(common.size)} of the ${group(total)} layer rows read identically on all ${group(list.length)} cards below, so they are recorded once here instead of five times. Each card carries only the rows that differ from these.`,
    `नीचे दिए सभी ${group(list.length)} कार्डों पर ${group(total)} परत-पंक्तियों में से ${group(common.size)} बिल्कुल एक जैसी हैं, इसलिए वे यहाँ एक बार दर्ज हैं, पाँच बार नहीं। हर कार्ड में इनसे अलग पंक्तियाँ ही रखी गई हैं।`));
  const grid = el('div', 'fields');
  for (const [name, l] of common) {
    const row = el('div', 'frow');
    row.appendChild(el('div', 'k', `${em(name)} · ${em(l.state)}`));
    row.appendChild(el('div', 'v', em(l.detail)));
    grid.appendChild(row);
  }
  box.appendChild(grid);
  return box;
}

function scenarioCard(s, index, ctx) {
  const cardEl = el('article', 'scen-card');
  cardEl.id = ctx.ids[index];

  const findings = Array.isArray(s.findings) ? s.findings : [];
  // undefined rather than 0 when the record says nothing: a missing count is an
  // em-dash, never a zero that reads as a measurement.
  const foundCount = Array.isArray(s.findings) ? findings.length : undefined;

  const head = el('div', 'scen-head');
  head.appendChild(pill(VERDICT_PILL[String(s.verdict || '').toUpperCase()] || 'NONE', em(s.verdict)));
  const textBlock = el('div', 't');
  textBlock.appendChild(el('h3', null, isHindi() ? em(s.titleHi) : em(s.title)));
  textBlock.appendChild(el('p', null, isHindi() ? em(s.blurbHi) : em(s.blurb)));
  // Verdict, track and how many findings support the decision all sit in the header, so
  // the shape of the verdict is readable without scrolling into the card.
  textBlock.appendChild(el('div', 'scen-tag',
    `${t('v.track')} ${em(s.track)} · ${t('v.findings')} ${group(foundCount)} · ${em(s.fusionRuleVersion)} · ${em(s.thresholdVersion)}`));
  // The blanket demo disclaimer, on every card, in one line, beside the verdict it
  // qualifies. The full statement is printed once at the top of this section; this is
  // what stops a reader who scrolled straight to card four from not seeing it at all.
  textBlock.appendChild(demoRunMarker());
  head.appendChild(textBlock);
  cardEl.appendChild(head);

  const body = el('div', 'scen-body');

  // 0 — the decision itself, first. Nothing between the reader and the finding.
  const vb = el('div', 'verdictbox');
  const actionRow = el('div', 'row');
  actionRow.appendChild(el('span', 'k', t('v.action')));
  actionRow.appendChild(el('span', 'v', em(s.action)));
  vb.appendChild(actionRow);
  const enRow = el('div', 'row');
  enRow.appendChild(el('span', 'k', t('v.en')));
  enRow.appendChild(el('span', 'v', em(s.en)));
  vb.appendChild(enRow);
  const hiRow = el('div', 'row');
  hiRow.appendChild(el('span', 'k', t('v.hi')));
  hiRow.appendChild(el('span', 'v hi', em(s.hi)));
  vb.appendChild(hiRow);
  body.appendChild(vb);

  // 1 — the disclosure that is specific to THIS card: the engine attributes findings on
  //     it to the synthetic macro classifier, so it says so here and names the codes at
  //     issue. It sits directly under the verdict it qualifies. The two blanket
  //     disclosures are printed once at the top of the section instead of on all five
  //     cards: repeating identical warnings five times buried the actual finding, which
  //     is the opposite of what a disclosure is for.
  const macroCodes = macroFindingCodes(s);
  if (macroCodes.length) body.appendChild(syntheticMacroNotice(s, macroCodes));

  // 2 — layers. Only the rows that differ on this card; the invariant ones are printed
  //     once in the ledger at the top of the section, and the line below names every row
  //     left out of this card so a reader knows what is not in the table.
  const layerBlock = el('div');
  layerBlock.appendChild(h4(t('v.layers'), t('v.layers')));
  const rows = Array.isArray(s.layers) ? s.layers : [];
  const diffRows = rows.filter((l) => l && !ctx.common.has(l.layer));
  const sameCount = rows.length - diffRows.length;
  if (!rows.length) {
    // A heading with nothing under it reads as "the layers ran and said nothing", which
    // this build cannot mean. Say what the record actually holds.
    layerBlock.appendChild(small(
      'The record for this scenario carries no layer rows. That is what the file holds — it is not a statement that the layers passed.',
      'इस परिदृश्य का रिकॉर्ड में कोई परत-पंक्ति नहीं है। फ़ाइल में यही है — यह यह नहीं कहता कि परतें पास हो गईं।'));
  }
  if (sameCount > 0) {
    const names = rows.filter((l) => l && ctx.common.has(l.layer)).map((l) => em(l.layer)).join(', ');
    layerBlock.appendChild(small(
      `${group(sameCount)} of the ${group(rows.length)} layer rows on this card — ${names} — read the same on all ${group(ctx.count)} cards and are printed once at the top of this section. ${diffRows.length ? `The table below holds the ${group(diffRows.length)} that differ.` : 'No row on this card differs from the others.'}`,
      `इस कार्ड की ${group(rows.length)} परत-पंक्तियों में से ${group(sameCount)} — ${names} — सभी ${group(ctx.count)} कार्डों पर एक जैसी हैं और इस खंड की शुरुआत में एक बार छपी हैं। ${diffRows.length ? `नीचे की तालिका में जो पंक्तियाँ अलग हैं, वे हैं — ${group(diffRows.length)}।` : 'इस कार्ड की कोई पंक्ति दूसरों से अलग नहीं है।'}`));
  }
  if (diffRows.length) {
    const layerTable = dataTable(
      [
        { en: 'Layer', hi: 'परत' },
        { en: 'State', hi: 'स्थिति' },
        { en: 'Detail', hi: 'विवरण' },
      ],
      diffRows.map((l) => [em(l.layer), layerStateClass(l.state), em(l.detail)]),
    );
    const layerEl = layerTable.querySelector('table');
    layerEl.className = 'layers';
    // Give the state cell the `st` hook app.css already styles, so RAN reads green,
    // SKIPPED quiet and UNAVAILABLE amber. The cell text is untouched — it is the
    // engine's own word, with MISSING standing in for a state this build does not know.
    [...layerEl.querySelectorAll('tbody tr')].forEach((tr, i) => {
      const cell = tr.children[1];
      if (cell) cell.className = `st ${layerStateClass(diffRows[i].state)}`;
    });
    layerBlock.appendChild(layerTable);
  }
  body.appendChild(layerBlock);

  // 3 — findings
  const findBlock = el('div');
  findBlock.appendChild(h4(t('v.findings'), t('v.findings')));
  findBlock.appendChild(findingsTable(findings));
  body.appendChild(findBlock);

  // 4 — the engine's own warnings, verbatim. Never paraphrased, never re-ordered.
  const warnBlock = el('div');
  warnBlock.appendChild(h4(t('v.rationale'), t('v.rationale')));
  const warnings = s.warnings || [];
  const pre = el('pre', 'console');
  pre.textContent = warnings.length
    ? warnings.join('\n')
    : (isHindi()
      ? '(इंजन ने कोई चेतावनी नहीं लौटाई।)'
      : '(the engine returned no warnings)');
  warnBlock.appendChild(pre);
  body.appendChild(warnBlock);

  // 5 — the audit chain tip. This is a real hash chain, so say what it is.
  const hashLine = el('div', 'hash');
  hashLine.appendChild(bi('span', null, 'audit chain tip ', 'ऑडिट श्रृंखला की टिप '));
  hashLine.appendChild(document.createTextNode(em(s.auditTip)));
  hashLine.appendChild(bi('span', null,
    ' — every finding above is chained into it, so removing or editing a finding changes the tip.',
    ' — ऊपर का हर निष्कर्ष इसी में जुड़ा है, इसलिए कोई निष्कर्ष हटाने या बदलने पर टिप बदल जाएगी।'));
  body.appendChild(hashLine);

  // 6 — the raw transcript, as text.
  const raw = el('details', 'raw');
  raw.appendChild(el('summary', null, t('v.raw')));
  const rawPre = el('pre', 'console');
  const cached = transcriptCache.get(s.transcript);
  if (cached && typeof cached.text === 'string') rawPre.textContent = cached.text;
  else if (cached && cached.error) rawPre.textContent = `transcript unavailable: ${cached.error}`;
  else rawPre.textContent = isHindi() ? '(लोड हो रहा है…)' : '(loading…)';
  raw.appendChild(rawPre);
  body.appendChild(raw);

  cardEl.appendChild(body);
  return cardEl;
}

function greenNote() {
  const box = el('div');
  box.appendChild(bi('h4', null, 'Why there is no GREEN here', 'यहाँ GREEN क्यों नहीं है'));
  box.appendChild(el('p', 'mb0', t('v.green')));
  return box;
}

export async function renderScenarios() {
  const host = document.getElementById('scenarios');
  const noteHost = document.getElementById('green-note');

  let data;
  try {
    data = await loadScenarios();
  } catch (err) {
    if (host) errorBlock(host, 'The verdict scenarios', 'निर्णय परिदृश्य');
    if (noteHost) fill(noteHost, greenNote());
    return;
  }
  if (!host) return;

  const list = data.scenarios || [];
  await Promise.all(list.map((s) => loadTranscript(s.transcript).catch(() => null)));

  // Anchor ids first: the index strip links to them, so they are decided before any card
  // is built and are the same on every render.
  const ids = [];
  const seen = new Set();
  list.forEach((s, i) => ids.push(anchorId(s, i, seen)));

  // Which layer rows read the same on every card. Counted here, once, so the section
  // header and the five cards cannot disagree about what is shared.
  const common = commonLayerRows(list);
  const ctx = { ids, common, count: list.length };

  // Built after the awaits, so the language in force at build time is the one that wins.
  const cards = list.map((s, i) => scenarioCard(s, i, ctx));

  // Section order: what all of these were run on, then the blanket demo disclaimer,
  // then the shared layer ledger, then the index, then the cards. Every disclosure that
  // applies to all five is above and visible; only what is true of a single card is
  // repeated on that card.
  fill(host,
    list.length ? scenariosScopeNotice(list) : null,
    list.length ? demoRunNotice(list) : null,
    commonLayersNotice(list, common),
    list.length ? scenarioIndex(list, ids) : null,
    ...cards,
  );
  if (!cards.length) {
    fill(host, el('div', 'notice plain', isHindi()
      ? 'इस फ़ाइल में कोई परिदृश्य नहीं है।'
      : 'This file contains no scenarios.'));
  }

  if (noteHost) fill(noteHost, greenNote());
}

/* =============================================================== measured == */

function statusPillClass(status) {
  const up = String(status || '').toUpperCase();
  if (/INVALID/.test(up)) return 'RED';
  if (/FAIL/.test(up)) return 'FAIL';
  if (/INCOMPLETE|PARTIAL|SKIPPED/.test(up)) return 'AMBER';
  if (/PASS|OK|COMPLETE/.test(up)) return 'PASS';
  if (!up) return 'NONE';
  return 'INFO';
}

function runHeaderBox(ev) {
  const gov = ev.governance || {};
  const box = el('div', 'verdictbox');
  const row = (keyLabel, valueNode) => {
    const r = el('div', 'row');
    r.appendChild(el('span', 'k', keyLabel));
    r.appendChild(valueNode);
    box.appendChild(r);
    return r;
  };
  const mono = (s) => el('span', 'v mono', em(s));

  row(t('m.run'), mono(ev.runId));
  row(isHindi() ? 'सूट' : 'Suite', mono(ev.suite));
  row(t('m.commit'), mono(ev.commit));
  row(isHindi() ? 'शुरू (UTC)' : 'Started (UTC)', mono(ev.startedAtUtc));
  row(isHindi() ? 'समाप्त (UTC)' : 'Finished (UTC)', mono(ev.finishedAtUtc));

  row(t('m.split'), mono(ev.split));

  const statusWrap = el('span', 'v');
  statusWrap.appendChild(pill(statusPillClass(gov.status), em(gov.status)));
  statusWrap.appendChild(document.createTextNode(
    isHindi() ? `  ·  एग्ज़िट कोड ${em(gov.exitCode)}` : `  ·  exit code ${em(gov.exitCode)}`));
  row(t('m.status'), statusWrap);

  return box;
}

function splitDisciplineCard(gov) {
  const sd = gov.splitDiscipline || {};
  const checked = Array.isArray(sd.checked) ? sd.checked : [];
  const untuned = Array.isArray(sd.untuned) ? sd.untuned : [];

  const grid = statgrid([
    statTile('note', group(checked.length),
      'thresholds checked', 'जाँचे गए थ्रेशहोल्ड'),
    statTile('warn', group(untuned.length),
      'still at untuned default', 'अब भी अन-ट्यून्ड डिफ़ॉल्ट पर'),
  ]);

  const list = el('ul');
  if (untuned.length) {
    for (const u of untuned) list.appendChild(el('li', null, String(u)));
  } else {
    list.appendChild(el('li', null, isHindi()
      ? 'इस रन में कोई अन-ट्यून्ड थ्रेशहोल्ड नहीं सूचीबद्ध है।'
      : 'No untuned threshold is listed for this run.'));
  }

  return card(
    h4('Split discipline', 'स्प्लिट अनुशासन'),
    grid,
    el('p', 'mono', em(sd.summary)),
    h4(t('m.untuned'), t('m.untuned')),
    list,
  );
}

function calibrationNotice(gov) {
  const cal = gov.calibration || {};
  const box = el('div', 'notice mt');
  box.appendChild(bi('h4', null,
    `Device calibration: ${cal.present ? 'present' : 'absent'} — macro and face numbers do not count yet`,
    `डिवाइस कैलिब्रेशन: ${cal.present ? 'मौजूद' : 'अनुपस्थित'} — मैक्रो और फेस आँकड़े अभी मान्य नहीं`));
  box.appendChild(el('p', 'mb0', em(cal.reason)));
  box.appendChild(small(
    `deviceId ${em(cal.deviceId)} · accepted ${em(cal.accepted)} · ageDays ${em(cal.ageDays)}`,
    `deviceId ${em(cal.deviceId)} · स्वीकृत ${em(cal.accepted)} · आयु (दिन) ${em(cal.ageDays)}`));
  return box;
}

function mrzCard(ev) {
  const c = ev.counters || {};
  const m = ev.measures || {};
  const byMut = (ev.buckets || {})['MRZ catch rate by mutation'] || {};
  const byField = (ev.buckets || {})['MRZ catch rate by expected field'] || {};
  const byReason = (ev.buckets || {})['MRZ structurally blind rows by reason'] || {};

  const grid = statgrid([
    statTile(null, group(c['mrz.corpus.rows']), 'corpus rows', 'कॉर्पस पंक्तियाँ'),
    statTile('good', group(c['mrz.valid.rows']), 'unmutated control rows', 'अपरिवर्तित नियंत्रण पंक्तियाँ'),
    statTile('note', group(c['mrz.mutate_catch.detectable_total']), 'detectable mutants', 'पहचान योग्य उत्परिवर्तन'),
    statTile('good', group(c['mrz.mutate_catch.detectable_caught']), 'caught', 'पकड़े गए'),
    statTile('warn', group(c['mrz.mutate_catch.structurally_blind']),
      'structurally blind — counted neither way', 'संरचनात्मक अंधापन — दोनों तरफ़ नहीं गिना'),
    statTile('good', pct(m['mrz.valid.false_positive_pct']),
      'false-positive rate on valid rows', 'वैध पंक्तियों पर फ़ॉल्स-पॉज़िटिव दर'),
  ]);

  // mutation table
  const mutArms = armsOf(byMut);
  const mutRows = mutArms.map((arm) => {
    const rows = cell(byMut, arm, 'rows');
    const detectable = cell(byMut, arm, 'detectable');
    const caught = cell(byMut, arm, 'caught');
    const blind = cell(byMut, arm, 'blind rows');
    const undefinedRatio = detectable === 0;   // 0/0 is not zero; it is undefined
    return [
      arm,
      group(rows),
      group(detectable),
      undefinedRatio ? EM : group(caught),
      undefinedRatio ? EM : pct(cell(byMut, arm, 'catch %')),
      group(blind),
    ];
  });
  const mutTable = dataTable(
    [
      { en: 'Mutation', hi: 'उत्परिवर्तन' },
      { en: 'Rows', hi: 'पंक्तियाँ', num: true },
      { en: 'Detectable', hi: 'पहचान योग्य', num: true },
      { en: 'Caught', hi: 'पकड़े गए', num: true },
      { en: 'Catch %', hi: 'पकड़ %', num: true },
      { en: 'Blind rows', hi: 'अंधी पंक्तियाँ', num: true },
    ],
    mutRows,
  );

  const mutNotes = [];
  if (byMut['NONE/rows'] != null) {
    mutNotes.push(small(
      `The ${byMut['NONE/rows']} NONE rows are the unmutated control set. Nothing there needs catching, so "detectable" is ${byMut['NONE/detectable']} and a catch rate would be 0/0 — undefined, not zero. It is shown as ${EM}.`,
      `${byMut['NONE/rows']} NONE पंक्तियाँ अपरिवर्तित नियंत्रण सेट हैं। वहाँ पकड़ने को कुछ है ही नहीं, इसलिए "पहचान योग्य" ${byMut['NONE/detectable']} है और पकड़ दर 0/0 होगी — अपरिभाषित, शून्य नहीं। वह ${EM} दिखाया गया है।`));
  }
  const mutTotal = sumArms(byMut, 'rows');
  if (mutTotal != null && c['mrz.corpus.rows'] != null) {
    mutNotes.push(small(
      `Rows across every arm: ${group(mutTotal)} · corpus rows: ${group(c['mrz.corpus.rows'])} · ${mutTotal === c['mrz.corpus.rows'] ? 'these agree' : 'these DO NOT agree'}.`,
      `हर आर्म की पंक्तियाँ: ${group(mutTotal)} · कॉर्पस पंक्तियाँ: ${group(c['mrz.corpus.rows'])} · ${mutTotal === c['mrz.corpus.rows'] ? 'दोनों मेल खाते हैं' : 'दोनों मेल नहीं खाते'}।`));
  }

  // expected-field table
  const fieldArms = armsOf(byField);
  const fieldRows = fieldArms.map((arm) => {
    const detectable = cell(byField, arm, 'detectable rows');
    return [
      arm,
      group(detectable),
      group(cell(byField, arm, 'caught')),
      detectable === 0 ? EM : pct(cell(byField, arm, 'catch %')),
    ];
  });
  const fieldTable = dataTable(
    [
      { en: 'Expected field', hi: 'अपेक्षित फ़ील्ड' },
      { en: 'Detectable rows', hi: 'पहचान योग्य पंक्तियाँ', num: true },
      { en: 'Caught', hi: 'पकड़े गए', num: true },
      { en: 'Catch %', hi: 'पकड़ %', num: true },
    ],
    fieldRows,
  );

  // blind-rows-by-reason
  const reasonKeys = Object.keys(byReason);
  const reasonList = el('ul');
  for (const key of reasonKeys) {
    const reason = key.replace(/\/rows$/, '');
    const li = el('li');
    li.appendChild(el('b', 'num', group(byReason[key])));
    li.appendChild(document.createTextNode(` rows — ${reason}`));
    reasonList.appendChild(li);
  }
  if (!reasonKeys.length) {
    reasonList.appendChild(el('li', null, isHindi()
      ? 'कोई अंधी पंक्ति दर्ज नहीं है।'
      : 'No blind row is recorded.'));
  }
  const reasonTotal = reasonKeys.reduce((a, k) => a + (byReason[k] || 0), 0);
  const blindCounter = c['mrz.mutate_catch.structurally_blind'];
  const reasonNote = blindCounter == null ? null : small(
    `Rows explained: ${group(reasonTotal)} · structurally blind counter: ${group(blindCounter)} · ${reasonTotal === blindCounter ? 'these agree' : 'these DO NOT agree'}.`,
    `स्पष्ट की गई पंक्तियाँ: ${group(reasonTotal)} · संरचनात्मक अंधापन काउंटर: ${group(blindCounter)} · ${reasonTotal === blindCounter ? 'दोनों मेल खाते हैं' : 'दोनों मेल नहीं खाते'}।`);

  return card(
    h4('MRZ — check-digit mutation corpus', 'MRZ — चेक-डिजिट उत्परिवर्तन कॉर्पस'),
    grid,
    h4('Catch rate by mutation', 'उत्परिवर्तन अनुसार पकड़ दर'),
    mutTable,
    ...mutNotes,
    h4('Catch rate by expected field', 'अपेक्षित फ़ील्ड अनुसार पकड़ दर'),
    fieldTable,
    h4('Why the blind rows are blind', 'अंधी पंक्तियाँ अंधी क्यों हैं'),
    cardTight(reasonList, reasonNote),
    suiteNotesBlock(ev, 'mrz'),
  );
}

function qrCaveatNotice(tbl, arms) {
  // "full marks" is the unit's maximum, the same predicate the bar width already uses;
  // the counts are read out of the table, so the sentence cannot claim more than it has.
  const full = arms.filter((a) => cell(tbl, a, '%') === 100).length;
  const shape = full === arms.length
    ? `All ${group(arms.length)} arms read full marks.`
    : `${group(full)} of ${group(arms.length)} arms read full marks.`;
  return caveatBox(
    'What this table does not prove',
    'यह तालिका क्या सिद्ध नहीं करती',
    [
      [
        `${shape} That is the number to be careful with, because the signatures in this suite are not real ones. They are produced at run time by a harness stub verifier over a per-JVM RSA key pair, so the verifier is agreeing with its own signer. The real key ring has never been obtained, which means the production verification path was not exercised by this run at all — the source project tracks that as risk R-B. What these numbers do certify is :core's key selection and its tamper detection. That is real work, and it is a smaller claim than "the signed-QR layer works": only the smaller one is proven.`,
        `${shape} यही वह संख्या है जिसमें सावधानी रखनी चाहिए, क्योंकि इस सूट में हस्ताक्षर असली नहीं हैं। वे रन-टाइम पर एक हार्नेस स्टब सत्यापक द्वारा, प्रति-JVM RSA कुंजी-युग्म पर, बनाए जाते हैं — यानी सत्यापक अपने ही हस्ताक्षरकर्ता से सहमत है। असली कुंजी-वलय कभी प्राप्त नहीं हुआ, यानी इस रन ने उत्पादन सत्यापन पथ को बिल्कुल नहीं छुआ — स्रोत परियोजना इसे जोखिम R-B के रूप में दर्ज करती है। इन आँकड़ों से जो प्रमाणित होता है वह है :core का कुंजी चयन और उसकी छेड़छाड़-पहचान। यह असला काम है, पर यह "साइन किए गए QR परत काम करती है" से छोटा दावा है: साबित केवल छोटा वाला है।`,
      ],
    ],
    null,
    null,
  );
}

function qrCard(ev) {
  const c = ev.counters || {};
  const tbl = (ev.buckets || {})['QR verification outcome by fixture arm'] || {};
  const arms = armsOf(tbl);
  const rows = arms.map((arm) => {
    const asExpected = cell(tbl, arm, 'as expected');
    const cases = cell(tbl, arm, 'cases');
    return [arm, group(cases), group(asExpected), pct(cell(tbl, arm, '%')), bar(cell(tbl, arm, '%'))];
  });
  const table = dataTable(
    [
      { en: 'Fixture arm', hi: 'फ़िक्स्चर आर्म' },
      { en: 'Cases', hi: 'केस', num: true },
      { en: 'As expected', hi: 'अपेक्षित', num: true },
      { en: '%', hi: '%', num: true },
      { en: 'As expected, drawn', hi: 'अपेक्षित, चित्र में' },
    ],
    rows,
  );
  const armTotal = sumArms(tbl, 'cases');
  const note = (c['qr.corpus.size'] == null || armTotal == null) ? null : small(
    `Cases across every arm: ${group(armTotal)} · corpus size counter: ${group(c['qr.corpus.size'])} · ${armTotal === c['qr.corpus.size'] ? 'these agree' : 'these DO NOT agree'}.`,
    `हर आर्म के केस: ${group(armTotal)} · कॉर्पस साइज़ काउंटर: ${group(c['qr.corpus.size'])} · ${armTotal === c['qr.corpus.size'] ? 'दोनों मेल खाते हैं' : 'दोनों मेल नहीं खाते'}।`);

  return card(
    h4(t('m.qr'), t('m.qr')),
    arms.length ? qrCaveatNotice(tbl, arms) : null,
    table,
    note,
    suiteNotesBlock(ev, 'qr'),
  );
}

/** The gate list the record carries and this page used to drop: a bar set before the
 *  run, and what the run did with it. A gate that never got measured is shown as
 *  skipped, in its own row, and is not folded into the pass count. */
function gatesCard(ev) {
  const gov = ev.governance || {};
  const gates = Array.isArray(gov.gates) ? gov.gates.filter(Boolean) : [];
  if (!gates.length) return null;

  const tally = (want) => gates.filter((g) => String(g.status || '').toUpperCase() === want).length;
  const passed = tally('PASS');
  const notRun = gates.length - passed;

  const rows = gates.map((g) => {
    const id = el('div');
    id.appendChild(el('b', 'mono', em(g.id)));
    id.appendChild(el('div', null, em(g.name)));
    const ref = el('div');
    ref.appendChild(el('small', null, em(g.evidenceRef)));
    return [id, pill(statusPillClass(g.status), em(g.status)), em(g.bar), em(g.observed), ref];
  });
  const table = dataTable(
    [
      { en: 'Gate', hi: 'गेट' },
      { en: 'Status', hi: 'स्थिति' },
      { en: 'Bar', hi: 'सीमा' },
      { en: 'Observed', hi: 'पाया गया' },
      { en: 'Evidence', hi: 'साक्ष्य' },
    ],
    rows,
  );

  const grid = statgrid([
    statTile(null, group(gates.length), 'gates recorded in this run', 'इस रन में दर्ज गेट'),
    statTile('good', group(passed), 'passed', 'उत्तीर्ण'),
    statTile(notRun ? 'warn' : null, group(notRun),
      'not passed — listed, not hidden', 'उत्तीर्ण नहीं — सूचीबद्ध, छिपाए नहीं'),
  ]);

  // Notes belonging to suites that get no table of their own, so that every note in the
  // record reaches the page and none is shown twice.
  const suites = Array.isArray(gov.suites) ? gov.suites.filter(Boolean) : [];
  const orphanNotes = [];
  for (const s of suites) {
    if (SUITES_WITH_TABLE.includes(s.suite)) continue;
    const notes = Array.isArray(s.notes) ? s.notes.filter((n) => typeof n === 'string' && n.length) : [];
    if (notes.length) orphanNotes.push([`${s.suite} —`, ...notes.map((n) => `  ·  ${n}`)]);
  }

  const box = el('div');
  box.appendChild(h4('Gates, as the run recorded them', 'गेट, जैसे रन ने दर्ज किए'));
  box.appendChild(para(
    'A gate is a bar set before the run and a check of whether the run cleared it, missed it, or never got to it. A gate that was skipped is listed as skipped and is not counted as a pass — a suite that could not be measured says so instead of going quiet.',
    'गेट का अर्थ है रन से पहले तय सीमा, और यह जाँच कि रन उसे पार कर पाया या चूका या उस तक पहुँच ही नहीं सका। जो गेट छोड़ा गया, वह छोड़ा गया दिखता है और उत्तीर्ण में नहीं गिना जाता — जिस सूट को मापा ही नहीं जा सका, वह चुप नहीं होता बल्कि यह बताता है।'));
  box.appendChild(grid);
  box.appendChild(table);

  if (orphanNotes.length) {
    const list = el('ul');
    for (const [head, ...rest] of orphanNotes) {
      const li = el('li');
      li.appendChild(el('b', null, head));
      for (const n of rest) li.appendChild(document.createTextNode(n));
      list.appendChild(li);
    }
    box.appendChild(small(
      'Notes from a suite that has no table above, copied word for word from the run record:',
      'उस सूट के नोट्स जिसकी ऊपर कोई तालिका नहीं है, रन रिकॉर्ड से शब्दशः:'));
    box.appendChild(list);
  }
  return card(box);
}

function diaryCard(ev) {
  const c = ev.counters || {};
  const tbl = (ev.buckets || {})['D-SCEN scripts by category'] || {};
  const arms = armsOf(tbl);
  const rows = arms.map((arm) => {
    const scripts = cell(tbl, arm, 'scripts');
    return [arm, group(scripts), group(cell(tbl, arm, 'passed')),
      scripts === 0 ? EM : pct(cell(tbl, arm, '%')), bar(cell(tbl, arm, '%'))];
  });
  const table = dataTable(
    [
      { en: 'Category', hi: 'श्रेणी' },
      { en: 'Scripts', hi: 'स्क्रिप्ट', num: true },
      { en: 'Passed', hi: 'उत्तीर्ण', num: true },
      { en: '%', hi: '%', num: true },
      { en: 'Pass rate, drawn', hi: 'उत्तीर्णता, चित्र में' },
    ],
    rows,
  );
  const armTotal = sumArms(tbl, 'scripts');
  const notes = [];
  if (armTotal != null && c['diary.scenarios.total'] != null) {
    notes.push(small(
      `Scripts across every category: ${group(armTotal)} · scenarios total counter: ${group(c['diary.scenarios.total'])} · ${armTotal === c['diary.scenarios.total'] ? 'these agree' : 'these DO NOT agree'}.`,
      `हर श्रेणी की स्क्रिप्ट: ${group(armTotal)} · परिदृश्य कुल काउंटर: ${group(c['diary.scenarios.total'])} · ${armTotal === c['diary.scenarios.total'] ? 'दोनों मेल खाते हैं' : 'दोनों मेल नहीं खाते'}।`));
  }
  return card(h4(t('m.diary'), t('m.diary')), table, ...notes, suiteNotesBlock(ev, 'diary'));
}

function latencyCard(ev) {
  const c = ev.counters || {};
  const m = ev.measures || {};
  const tbl = (ev.buckets || {})['Latency by stage (host JVM)'] || {};
  const arms = armsOf(tbl);
  const rows = arms.map((arm) => {
    const p95 = cell(tbl, arm, 'p95 ms');
    const budget = cell(tbl, arm, 'advisory budget ms');
    const within = typeof p95 === 'number' && typeof budget === 'number' ? p95 <= budget : null;
    const flag = within == null ? EM : pill(within ? 'PASS' : 'FAIL', within ? 'within' : 'over');
    return [arm, ms(cell(tbl, arm, 'median ms')), ms(p95), ms(budget), flag];
  });
  const table = dataTable(
    [
      { en: 'Stage', hi: 'चरण' },
      { en: 'Median (ms)', hi: 'माध्यिका (ms)', num: true },
      { en: 'p95 (ms)', hi: 'p95 (ms)', num: true },
      { en: 'Advisory budget (ms)', hi: 'सलाहकार बजट (ms)', num: true },
      { en: 'p95 vs budget', hi: 'p95 बनाम बजट' },
    ],
    rows,
  );
  const grid = statgrid([
    statTile('note', ms(m['latency.total_p95_ms']), 'total p95 (ms), as recorded', 'कुल p95 (ms), जैसा दर्ज है'),
    statTile(null, group(c['latency.iterations']), 'timed iterations per stage', 'प्रति चरण समय-मापन पुनरावृत्तियाँ'),
    statTile(null, group(c['latency.warmup_iterations']), 'discarded warm-up runs', 'छोड़े गए वार्म-अप रन'),
    statTile(null, em(m['latency.jvm_max_heap_mb']), 'JVM max heap (MB)', 'JVM अधिकतम हिप (MB)'),
  ]);

  return card(
    h4(t('m.latency'), t('m.latency')),
    small('Host JVM, measured offline. These are not on-device figures, and they are not claimed to be.',
      'होस्ट JVM, ऑफ़लाइन मापे गए। ये ऑन-डिवाइस आँकड़े नहीं हैं, और ऐसा दावा भी नहीं किया जाता।'),
    table,
    grid,
    suiteNotesBlock(ev, 'latency'),
  );
}

export async function renderMeasured() {
  const host = document.getElementById('measured');
  if (!host) return;

  loadingBlock(host, 'Loading the measurement record…', 'माप रिकॉर्ड लोड हो रहा है…');

  let ev;
  try {
    ev = await loadEvalRun();
  } catch (err) {
    errorBlock(host, 'The measurement record', 'माप रिकॉर्ड');
    return;
  }

  const gov = ev.governance || {};
  const exitCode = gov.exitCode;
  const incomplete = /INCOMPLETE/i.test(String(gov.status || ''));

  const head = [
    runHeaderBox(ev),
    incomplete
      ? para(
        `Exit code ${em(exitCode)} means a required device-gated suite was skipped. With no device attached that is the correct answer, not a failed run — a green result here would imply a phone was in the loop, and there was none.`,
        `एग्ज़िट कोड ${em(exitCode)} का अर्थ है कि एक आवश्यक डिवाइस-गेटेड सूट छोड़ा गया। कोई डिवाइस जुड़ा होने पर यही सही उत्तर है, असफल रन नहीं — यहाँ हरा परिणाम इस बात का इशारा होता कि कोई फ़ोन शामिल था, और कोई नहीं था।`)
      : para(
        `Exit code ${em(exitCode)}, status ${em(gov.status)}. Read it with the status above rather than as a pass or a fail on its own.`,
        `एग्ज़िट कोड ${em(exitCode)}, स्थिति ${em(gov.status)}। इसे ऊपर दी गई स्थिति के साथ पढ़ें, अकेले में पास या फेल न मानें।`),
  ];
  // The flag lives on the governance block, not at the top level of the record.
  if (gov.commitDirty === true) {
    head.push(caveatBox(
      'That commit does not describe the tree these numbers came from',
      'यह कमिट उस कार्य-वृक्ष का वर्णन नहीं करता जिससे ये आँकड़े आए हैं',
      [[
        `The record carries commitDirty = true: the commit ${em(ev.commit)} above is an identifier for where the run started, not a recipe that reproduces this tree. Anyone re-running it has to expect a different result until that is fixed.`,
        `रिकॉर्ड में commitDirty = true है: ऊपर दिया गया कमिट ${em(ev.commit)} यह दर्शाता है कि रन कहाँ से शुरू हुआ, यह नहीं कि यह कार्य-वृक्ष दोबारा बनाया जा सके। जब तक यह ठीक नहीं होता, इसे दोबारा चलाने वाले को अलग परिणाम की अपेक्षा करनी चाहिए।`,
      ]],
      null,
      null,
    ));
  }

  const untuned = (gov.splitDiscipline && gov.splitDiscipline.untuned) || [];
  const facts = thresholdFacts(ev);
  // The record states the untuned count twice — once in splitDiscipline, once by the
  // selectedOnSplit flag on each operating point. Say whether the two copies agree, so
  // the number on this page and the number in the limits panel cannot drift apart quietly.
  const crossCheck = facts.ok ? small(
    `Counted from the operating points by their selectedOnSplit flag: ${group(facts.checked)} checked, ${group(facts.untuned)} untuned. The split-discipline block above says ${group(untuned.length)} — ${facts.agreement ? 'these agree' : 'these DO NOT agree'}.`,
    `ऑपरेटिंग पॉइंट को उनके selectedOnSplit चिह्न से गिनने पर: ${group(facts.checked)} जाँचे, ${group(facts.untuned)} अन-ट्यून्ड। ऊपर दिया स्प्लिट-डिसिप्लिन ब्लॉक ${group(untuned.length)} कहता है — ${facts.agreement ? 'दोनों मेल खाते हैं' : 'दोनों मेल नहीं खाते'}।`) : null;
  const tail = card(
    h4(t('m.untuned'), t('m.untuned')),
    para(
      `${untuned.length} threshold(s) in this run are still at the value in the registry, chosen by nobody because the dataset that would justify a different value does not exist yet. A number produced at an untuned operating point is a placeholder. We label it as one instead of presenting it as a tuned result.`,
      `इस रन में ${untuned.length} थ्रेशहोल्ड अब भी रजिस्ट्री के मान पर हैं, जिसे किसी ने चुना नहीं है क्योंकि कोई अलग मान सही ठहराने वाला डेटासेट अभी मौजूद नहीं है। अन-ट्यून्ड ऑपरेटिंग पॉइंट पर बना कोई आँकड़ा एक प्लेसहोल्डर है। हम उसे ट्यून्ड परिणाम की तरह पेश करने के बजाय उसी रूप में बताते हैं।`),
    crossCheck,
  );

  fill(host,
    ...head,
    splitDisciplineCard(gov),
    calibrationNotice(gov),
    gatesCard(ev),
    mrzCard(ev),
    qrCard(ev),
    diaryCard(ev),
    latencyCard(ev),
    tail,
  );
}

/* ================================================================= limits == */

/**
 * The status vocabulary for the table below. Five words, one colour each, and a row may
 * only carry a word this file can support from the source project. There is deliberately no
 * sixth word: a state that sounds better for an unfinished component is a claim about work
 * nobody did, and a status page that inflates a state is worse than an apology, because a
 * judge can check a status and cannot check a sentence about being busy.
 *
 *   available      — in the engine, and it runs
 *   source complete— written end to end, never compiled
 *   untuned        — the mechanism is real, its parameters are still defaults
 *   placeholder    — something stands in for the real thing, and is labelled as such
 *   blocked        — cannot proceed without something outside this project's control
 */
const STATUS_COLOUR = {
  blocked: 'RED',
  placeholder: 'GREY',
  untuned: 'AMBER',
  'source complete': 'INFO',
  available: 'GREEN',
};

/**
 * One row per component this project has not finished, written as a status page rather
 * than a list of apologies. Four columns carry the weight a status page carries:
 *
 *   notDone  — the shortfall, stated exactly. Never softened, never summarised away.
 *   instead  — what genuinely runs in its place. Every entry here was checked against
 *              /mnt/Lay/Kasoti before it was written, and an unsupported mitigant was
 *              left out rather than invented: a status page is only worth reading if
 *              every cell in it is checkable.
 *   next     — the work that would change the state.
 *
 * A cell may be a function of the run record, in which case its numbers are counted out
 * of the record at render time and never typed in here. Both languages are always built,
 * so the node carries a real data-hi even though only one of the two is showing.
 */
const STATUS_ROWS = [
  {
    name: { en: 'Face 1:1', hi: 'फेस 1:1' },
    sub: { en: 'embedder weights', hi: 'एम्बेडर वेट्स' },
    state: 'blocked',
    stateLabel: { en: 'blocked', hi: 'अवरुद्ध' },
    notDone: {
      en: 'No face embedder could be obtained, and none was fabricated. Every candidate we checked was rejected: two upstream repositories are gone, the weights are unpublished, the licence is research-only, or the model is 512-dimensional where our pipeline needs 128. A licensing decision was taken and recorded, and a second sourcing round under it obtained nothing. A verified 1:1 face match is therefore unreachable, and a GREEN 1:1 is blocked on every track.',
      hi: 'कोई फेस एम्बेडर नहीं मिल सका, और कोई बनाया भी नहीं गया। हमने जो भी उम्मीदवार देखे, वे या तो हटा दिए गए हैं, या उनके वेट्स अप्रकाशित हैं, या उनका लाइसेंस केवल शोध-हेतु है, या वे 512-आयामी हैं जबकि हमारा पाइपलाइन 128-आयामी माँगता है। लाइसेंस पर निर्णय लिया जा चुका था और उसी के तहत दूसरा प्रयास भी कुछ नहीं ला पाया। इसलिए सत्यापित 1:1 फेस मिलान असंभव है, और हर ट्रैक पर GREEN 1:1 अवरुद्ध है।',
    },
    instead: {
      en: 'The detector half is real: BlazeFace short-range (Apache-2.0, SHA-256 pinned) runs TFLite inference in the engine. Without an embedder the engine refuses rather than guesses — the face layer reports UNAVAILABLE, and the fusion coverage rules turn a required-but-absent layer into an AMBER escalation, never a pass. Every verdict card above shows that.',
      hi: 'डिटेक्टर वाला हिस्सा असली है: BlazeFace short-range (Apache-2.0, SHA-256 पिन किया हुआ) इंजन में TFLite इन्फ़रेंस चलाता है। एम्बेडर न होने पर इंजन अनुमान लगाने के बजाय मना कर देता है — फेस लेयर UNAVAILABLE बताती है, और फ्यूज़न कवरेज नियम किसी आवश्यक लेयर के न मिलने को पास नहीं, बल्कि AMBER तक ले जाते हैं। ऊपर हर वर्डिक्ट कार्ड यही दिखाता है।',
    },
    next: {
      en: 'A purchase enquiry to the publisher, or a 128-dimensional embedder of our own trained on data with clear training rights. The permission is settled; the price is not.',
      hi: 'प्रकाशक से खरीद की पूछताछ, या ऐसे डेटा पर अपना 128-आयामी एम्बेडर जिसके प्रशिक्षण अधिकार स्पष्ट हों। अनुमति तय है; कीमत नहीं।',
    },
  },
  {
    name: { en: 'Print process', hi: 'प्रिंट प्रोसेस' },
    sub: { en: 'macro classifier (SVM)', hi: 'मैक्रो क्लासिफ़ायर (SVM)' },
    state: 'placeholder',
    stateLabel: { en: 'placeholder', hi: 'प्लेसहोल्डर' },
    notDone: {
      en: 'The one classifier we could train was fitted only on textures a script generated, never on real print substrate. It is labelled SYNTHETIC in the model file, the run id, the console, the gate detail and the model card, and it is never eligible to satisfy a gate. The labelled dataset holds a header and zero rows, so there is no real macro accuracy figure to quote and we quote none.',
      hi: 'जो एकमात्र क्लासिफ़ायर हम प्रशिक्षित कर सके, वह केवल किसी स्क्रिप्ट से बने टेक्स्चर पर फिट हुआ — असली प्रिंट सब्स्ट्रेट पर कभी नहीं। यह मॉडल फ़ाइल, रन आईडी, कंसोल, गेट डिटेल और मॉडल कार्ड — हर जगह SYNTHETIC लिखा है, और यह कभी किसी गेट को पूरा करने के योग्य नहीं है। लेबल किया गया डेटासेट में सिर्फ़ हेडर है, शेष शून्य पंक्तियाँ — इसलिए असली मैक्रो सटीकता का कोई आँकड़ा पाने को नहीं है, और हम कोई आँकड़ा नहीं देते।',
    },
    instead: {
      en: 'The pipeline around that model is finished and tested: grayscale, a radial FFT spectrum, uniform LBP-59 features and a linear multiclass classifier. The collector that files labelled patches into the dataset is written and tested too. Only the data it would collect is missing.',
      hi: 'उस मॉडल के चारों ओर की पाइपलाइन पूरी और परीक्षित है: ग्रेस्केल, रेडियल FFT स्पेक्ट्रम, यूनिफ़ॉर्म LBP-59 फ़ीचर और एक लीनियर मल्टीक्लास क्लासिफ़ायर। डेटासेट में लेबल वाले पैच रखने वाला कलेक्टर भी लिखा और परीक्षित है। सिर्फ़ वही डेटा नहीं है जो वह एकत्र करता।',
    },
    next: {
      en: 'Capture. It needs physical documents, a printed specimen set and signed consent. Nothing else unblocks it.',
      hi: 'कैप्चर। इसके लिए भौतिक दस्तावेज़, छपा हुआ स्पेसिमन सेट और हस्ताक्षरित सहमति चाहिए। और कुछ भी इसे आगे नहीं बढ़ाता।',
    },
  },
  {
    name: { en: 'Thresholds', hi: 'थ्रेशहोल्ड' },
    sub: { en: 'operating points', hi: 'ऑपरेटिंग पॉइंट' },
    state: 'untuned',
    stateLabel: { en: 'untuned', hi: 'अन-ट्यून्ड' },
    // Function of the record, so the counts are counted out of the run rather than typed in
    // here. "Every one is untuned" is not a sentence this file can say: whether it is true
    // depends on the record, and the record decides.
    notDone: {
      en: (f) => `The tuning data does not exist, and neither does the versioned thresholds file the project requires as the source of truth — so every operating point is still a number a human typed into code, not a number a split chose. In this run ${em(f.checked)} thresholds were checked, ${em(f.untuned)} of them are still at the untuned registry default, and ${em(f.decidedNames.length ? f.decidedNames.join(', ') : null)} was set by policy instead — not untuned, and not a placeholder. A number produced at an untuned operating point is a placeholder, and we call it one.`,
      hi: (f) => `ट्यूनिंग का डेटा मौजूद नहीं है, और न ही वह वर्ज़न वाली थ्रेशहोल्ड फ़ाइल है जिसे परियोजना सत्य का स्रोत मानती है — इसलिए हर ऑपरेटिंग पॉइंट अब भी कोड में किसी व्यक्ति द्वारा टाइप किया गया अंक है, वह नहीं जिसे किसी स्प्लिट ने चुना। इस रन में ${em(f.checked)} थ्रेशहोल्ड जाँचे गए, उनमें से ${em(f.untuned)} अब भी अन-ट्यून्ड रजिस्ट्री डिफ़ॉल्ट पर हैं, और ${em(f.decidedNames.length ? f.decidedNames.join(', ') : null)} नीति से तय किया गया था — वह अन-ट्यून्ड नहीं है, और प्लेसहोल्डर भी नहीं। अन-ट्यून्ड ऑपरेटिंग पॉइंट पर बना कोई आँकड़ा प्लेसहोल्डर है, और हम उसे प्लेसहोल्डर ही कहते हैं।`,
    },
    instead: {
      en: 'The registry itself is real and enforced: every tunable carries a name, a unit, a default, a floor, a ceiling, an owner and a canonical serialisation, and the policy range is checked. That is what makes tuning later a reviewable file change rather than a quiet edit — and why we can say which numbers are untuned instead of guessing.',
      hi: 'रजिस्ट्री असली है और लागू है: हर ट्यूनेबल के पास नाम, इकाई, डिफ़ॉल्ट, न्यूनतम सीमा, अधिकतम सीमा, ज़िम्मेदार और एक निश्चित क्रम वाला क्रमांतरण है, और नीति-सीमा की जाँच होती है। यही कारण है कि बाद में ट्यूनिंग कोई चुपचाप का एडिट नहीं, बल्कि देखने योग्य फ़ाइल बदलाव बनती है — और इसीलिए हम यह बता सकते हैं कि कौन-से आँकड़े अन-ट्यून्ड हैं, बजाय अनुमान लगाने के।',
    },
    next: {
      en: 'Publish the registry as thresholds.v1.json — that is the fix for the red magic-number check, not an allowlist — then tune on a tune split and verify on a report split once the datasets land.',
      hi: 'रजिस्ट्री को thresholds.v1.json के रूप में प्रकाशित करें — लाल magic-number जाँच का यही हल है, कोई allowlist नहीं — और फिर डेटासेट आने पर ट्यून स्प्लिट पर ट्यून करके रिपोर्ट स्प्लिट पर जाँचें।',
    },
  },
  {
    name: { en: 'Android field app', hi: 'एंड्रॉइड फ़ील्ड ऐप' },
    sub: { en: 'capture · OCR · detector · demo', hi: 'कैप्चर · OCR · डिटेक्टर · डेमो' },
    state: 'source complete',
    stateLabel: { en: 'source complete', hi: 'कोड पूरा' },
    notDone: {
      en: 'The build environment has no Android SDK, so the module is not in the build at all and no APK has ever been produced. The source is complete across capture, ML Kit OCR, the TFLite detector and demo mode, but nothing has been shown to run on a phone: every on-device number this project mentions is a claim, not a measurement, and it is labelled as one.',
      hi: 'बिल्ड वातावरण में एंड्रॉइड SDK नहीं है, इसलिए यह मॉड्यूल बिल्ड में शामिल ही नहीं होता और कोई APK कभी नहीं बना। स्रोत पूरा है — कैप्चर, ML Kit OCR, TFLite डिटेक्टर और डेमो मोड — पर यह प्रमाणित नहीं किया गया कि यह फ़ोन पर चलता है: इस परियोजना का हर ऑन-डिवाइस आँकड़ा एक दावा है, माप नहीं, और वैसा ही लेबल किया गया है।',
    },
    instead: {
      en: 'An SDK-free harness compiles the platform-free half of the module against the real core classes and runs its unit tests; a second tier compiles the TFLite- and Android-facing files against hand-written API stubs. That is how nine real defects in the Android detector binding were found, three of them files the compiler would not accept at all. The harness states in its own header that the stub tier is a name-resolution gate, not a build.',
      hi: 'SDK-रहित जाँच स्क्रिप्ट मॉड्यूल के प्लेटफ़ॉर्म-मुक्त हिस्से को असली core क्लास के सामने संकलित करती है और उसकी यूनिट जाँचें चलाती है; दूसरा स्तर TFLite और एंड्रॉइड से जुड़ी फ़ाइलों को हाथ से लिखे गए API स्टब के सामने संकलित करता है। एंड्रॉइड डिटेक्टर बाइंडिंग में मिले नौ असली दोष इसी से मिले, जिनमें तीन ऐसी फ़ाइलें थीं जिन्हें कंपाइलर बिल्कुल स्वीकार नहीं करता। स्क्रिप्ट अपनी शीर्षलाखा में साफ़ लिखती है कि स्टब वाला स्तर नाम-समाधान की जाँच है, बिल्ड नहीं।',
    },
    next: {
      en: 'Install an SDK and run assembleDebug against the real one, then the no-network install test on a device in airplane mode. The stub signatures are our own reading of the API, so expect the first build to need fixes.',
      hi: 'SDK इंस्टॉल करके असली SDK के सामने assembleDebug चलाएँ, फिर किसी डिवाइस पर एयरप्लेन मोड में नेटवर्क-रहित इंस्टॉल जाँच। स्टब के हस्ताक्षर हमारा अपना पठन हैं, इसलिए पहले बिल्ड में सुधार की अपेक्षा रखें।',
    },
  },
];

/** The section's own position, below the table. Deliberately not a restatement of the lede
 *  in index.html, which already says that nothing here is hidden or faked: this says why
 *  naming a gap is worth more than smoothing it over. */
const STATUS_CLOSING = {
  en: 'Each row names the missing part, the state it is actually in, and the part of the system running in its place — so the size of every gap sits on the record next to everything else this project claims. Naming a component precisely is more useful to whoever picks it up than leaving it out: a status can be acted on, a silence cannot.',
  hi: 'हर पंक्ति बताती है कि कौन-सा हिस्सा नहीं है, वह असल में किस हालत में है, और उसकी जगह सिस्टम का कौन-सा हिस्सा चल रहा है — इसलिए हर अंतर का आकार उसी रिकॉर्ड में दर्ज है जहाँ इस परियोजना के सारे दावे दर्ज हैं। किसी घटक को ठीक-ठीक नाम देना उसे उठाने वाले के लिए उसकी चुप्पी से ज़्यादा उपयोगी है: स्थिति पर काम हो सकता है, चुप्पी पर नहीं।',
};

/** One marker for the whole table, in the gutter the section already has. */
const SECTION_MARK = '\u25b8';

const STATUS_COLS = [
  { en: 'Component', hi: 'घटक' },
  { en: 'State', hi: 'स्थिति' },
  { en: 'What is not done', hi: 'जो नहीं हुआ' },
  { en: 'What runs instead', hi: 'जो उसकी जगह चलता है' },
  { en: 'Next', hi: 'अगला कदम' },
];

export function renderLimits() {
  const host = document.getElementById('limits');
  if (!host) return;

  // One row quotes the run record, so it needs the record. loadEvalRun() dedupes on the
  // same promise renderMeasured() is already using, so this costs no extra fetch, and a
  // language toggle finds the record in memory and re-renders from it.
  if (!evalData && !limitsLoadFailed) {
    loadEvalRun()
      .then(() => renderLimits())
      .catch(() => { limitsLoadFailed = true; renderLimits(); });
    return;
  }

  const facts = thresholdFacts(evalData);
  // A cell may be a function of the record, so its numbers are counted out of the run
  // rather than typed in. Both languages are always built, so the node carries a real
  // data-hi even though only one of the two is showing.
  const cell = (lang) => bi('p', 'mb0', typeof lang.en === 'function' ? lang.en(facts) : lang.en,
    typeof lang.hi === 'function' ? lang.hi(facts) : lang.hi);

  const rows = STATUS_ROWS.map((r) => {
    // The pill's colour is a property of the state, so it is a class and not a translatable
    // word: the state name rides in the text, the colour is decided by STATUS_COLOUR.
    const state = bi('span', `pill ${STATUS_COLOUR[r.state] || 'NONE'}`, r.stateLabel.en, r.stateLabel.hi);
    return [
      [bi('b', null, r.name.en, r.name.hi), bi('div', 'lbl', r.sub.en, r.sub.hi)],
      state,
      cell(r.notDone),
      cell(r.instead),
      cell(r.next),
    ];
  });

  // The table sits directly in a .limit so the .limits grid item keeps its own surface:
  // a bare grid child would paint the container's rule colour as its background. The
  // scroll wrapper is the grid item, which is also what lets it shrink below the
  // table's min-content width on a narrow screen instead of widening the page.
  const table = el('div', 'limit');
  table.appendChild(el('div', 'mk', SECTION_MARK));
  table.appendChild(dataTable(STATUS_COLS, rows));

  const closing = el('div', 'limit');
  closing.appendChild(el('div', 'mk'));
  const closingText = el('div', 'mt');
  closingText.appendChild(bi('p', null, STATUS_CLOSING.en, STATUS_CLOSING.hi));
  closing.appendChild(closingText);

  const parts = [table, closing];

  // A failed record is rendered, not swallowed: the table still draws, its counts fall
  // back to an em-dash, and a line says the record is missing so a judge does not read
  // the em-dash as a measurement. A blank panel would read as "no limits found", which
  // is the one thing this section must never say.
  if (!evalData) {
    const note = el('div', 'notice plain');
    note.appendChild(bi('p', 'mb0',
      'The run record could not be loaded, so the counts in the threshold row below are unavailable rather than zero.',
      'रन रिकॉर्ड लोड नहीं हो सका, इसलिए नीचे थ्रेशहोल्ड पंक्ति में गिनतियाँ उपलब्ध नहीं हैं — शून्य नहीं।'));
    parts.unshift(note);
  }

  fill(host, ...parts);
}

/* ============================================================ provenance == */

export function renderProvenance() {
  const host = document.getElementById('foot-provenance');
  if (!host) return;

  if (!evalData) {
    loadEvalRun()
      .then(() => renderProvenance())
      .catch(() => {
        host.textContent = isHindi()
          ? 'प्रोवेनांस लोड नहीं हुआ।'
          : 'Provenance unavailable — the evaluation record could not be loaded.';
      });
    return;
  }

  const fusion = (scenData && scenData.fusionRuleVersion)
    || (scenData && scenData.scenarios && scenData.scenarios[0] && scenData.scenarios[0].fusionRuleVersion);
  const thresholds = (scenData && scenData.thresholdVersion)
    || (scenData && scenData.scenarios && scenData.scenarios[0] && scenData.scenarios[0].thresholdVersion);

  const parts = [
    `run ${em(evalData.runId)}`,
    `commit ${em(evalData.commit)}`,
    `suite ${em(evalData.suite)}`,
    `fusion ${em(fusion)}`,
    `thresholds ${em(thresholds)}`,
    isHindi()
      ? '— यह ब्राउज़र बिल्ड इंजन का पोर्ट है और अपनी स्वयं की जाँच करता है'
      : '— this browser build is a port of the engine and carries its own self-check',
  ];
  // Same flag as the measured panel: a dirty commit is an identifier, not a recipe.
  if (evalData.governance && evalData.governance.commitDirty === true) {
    parts.push(isHindi()
      ? '· commitDirty: यह कमिट उस कार्य-वृक्ष का वर्णन नहीं करता'
      : '· commitDirty: that commit does not describe the whole working tree');
  }
  host.textContent = parts.join(' · ');
}

/* ================================================================== entry == */

export function rerenderPanels() {
  // Each renderer clears its own container before it fills it, so calling this twice,
  // or calling it while a first fetch is still in flight, cannot duplicate content.
  renderScenarios();
  renderMeasured();
  renderLimits();
  renderProvenance();
  // renderProvenance() re-invokes itself once the record lands if it ran too early.
}
