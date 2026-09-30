/**
 * KASOTI-Demo — the replay panels: verdicts, the measurement record, the limits, the footer.
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

const LIMITS = [
  {
    mk: '▸',
    en: {
      h: 'Face embedding model — none we are allowed to ship',
      p: 'No face embedder could be sourced. Every candidate we looked at is deleted or unpublished, non-commercial-research-only, or 512-dimensional when our pipeline needs 128-d. A detector (BlazeFace, Apache-2.0) runs fine; an embedder does not exist. So a verified 1:1 face match is unreachable, and GREEN on a face track is unreachable too.',
      fix: 'Next step is written down, not guessed at: a purchase enquiry, or training our own embedder on data whose training rights are clear.',
    },
    hi: {
      h: 'फेस एम्बेडिंग मॉडल — ऐसा कोई नहीं जिसे हम भेज सकें',
      p: 'कोई फेस एम्बेडर नहीं मिल सका। हमने जो भी उम्मीदवार देखे, वे या तो हटा दिए गए हैं या अप्रकाशित हैं, या केवल गैर-वाणिज्यिक शोध हेतु हैं, या 512-आयामी हैं जबकि हमारे पाइपलाइन को 128-आयामी चाहिए। डिटेक्टर (BlazeFace, Apache-2.0) आसानी से चलता है; एम्बेडर मौजूद ही नहीं है। इसलिए सत्यापित 1:1 फेस मिलान असंभव है, और फेस ट्रैक पर GREEN भी असंभव।',
      fix: 'अगला कदम लिखित है, अनुमान नहीं: या तो खरीद की पूछताछ, या ऐसे डेटा पर अपना एम्बेडर प्रशिक्षित करना जिसके प्रशिक्षण अधिकार स्पष्ट हों।',
    },
  },
  {
    mk: '▸',
    en: {
      h: 'Print-process classifier — trained only on synthetic textures',
      p: 'The only model we could train was fitted on textures generated by a script — never on real print substrate. It is labelled SYNTHETIC everywhere it appears and it is never eligible to satisfy a gate. Real macro numbers do not exist yet, and we will not quote any.',
      fix: 'The capture collector is already built and waiting. It needs physical documents and signed consent, nothing else.',
    },
    hi: {
      h: 'प्रिंट-प्रोसेस क्लासिफ़ायर — केवल कृत्रिम टेक्स्चर पर प्रशिक्षित',
      p: 'हम जो एकमात्र मॉडल प्रशिक्षित कर पाए, वह किसी स्क्रिप्ट से बनाए गए टेक्स्चर पर फिट किया गया था — असली प्रिंट सब्सट्रेट पर कभी नहीं। यह जहाँ भी आता है, वहाँ SYNTHETIC लिखा है, और यह कभी किसी गेट को पूरा करने के योग्य नहीं है। असली मैक्रो आँकड़े अभी मौजूद नहीं हैं, और हम कोई आँकड़ा नहीं देंगे।',
      fix: 'कैप्चर कलेक्टर पहले से बना हुआ खड़ा है। उसे भौतिक दस्तावेज़ और हस्ताक्षरित सहमति चाहिए — बस इतना ही।',
    },
  },
  {
    mk: '!',
    en: {
      h: 'Thresholds — a real registry, a missing file, and mostly untuned defaults',
      // `p` may be a function of the record, so the counts in it are counted out of the
      // run rather than typed in here. "Every one" is not a sentence this file can say:
      // whether it is true depends on the record, and the record decides.
      p: (f) => `The registry is real: every tunable has a name, a default, a unit, a floor and a ceiling, versioned in code and enforced by tests. That is the part that makes later tuning a reviewable file change rather than a sneaky edit nobody can see. What it is not yet is a versioned *file* — the project requires fusion/thresholds.v1.json to be the source of truth and it does not exist, so the "versioned registry" claim is half-true and every operating point still lives in a Kotlin enum: a number a human typed, not one a split chose. In this run ${em(f.checked)} thresholds were checked, ${em(f.untuned)} of them are still at the untuned registry default, and ${em(f.decidedNames.length ? f.decidedNames.join(', ') : null)} was set by policy instead — not untuned, and not a placeholder. A number from an untuned threshold is a placeholder, and we call it one rather than letting it pass as a result.`,
      fix: 'The registry exists so that tuning later is a reviewable file change. The missing JSON file is the one thing standing between that and a registry anybody outside the codebase can read.',
    },
    hi: {
      h: 'थ्रेशहोल्ड — असली रजिस्ट्री, ग़ायब फ़ाइल, और ज़्यादातर अन-ट्यून्ड डिफ़ॉल्ट',
      p: (f) => `रजिस्ट्री असला है: हर ट्यूनेबल के पास नाम, डिफ़ॉल्ट, इकाई, न्यूनतम और अधिकतम सीमा है, कोड में वर्ज़न है, और परीक्षण इसकी रक्षा करते हैं। यही वह हिस्सा है जिसकी वजह से बाद में ट्यूनिंग एक देखने योग्य फ़ाइल बदलाव बनती है, कोई चुपचाप का एडिट नहीं। पर यह अभी वर्ज़न वाली *फ़ाइल* नहीं है — परियोजना को fusion/thresholds.v1.json को सत्य का स्रोत चाहिए और वह फ़ाइल मौजूद नहीं है, इसलिए "वर्ज़न वाला रजिस्ट्री" दावा आधा-सच है और हर ऑपरेटिंग पॉइंट अब भी एक Kotlin एनम में रहता है: कोई संख्या जिसे किसी व्यक्ति ने टाइप किया, वह नहीं जिसे किसी स्प्लिट ने चुना। इस रन में ${em(f.checked)} थ्रेशहोल्ड जाँचे गए, उनमें से ${em(f.untuned)} अब भी अन-ट्यून्ड रजिस्ट्री डिफ़ॉल्ट पर हैं, और ${em(f.decidedNames.length ? f.decidedNames.join(', ') : null)} नीति से तय किया गया था — वह अन-ट्यून्ड नहीं है, और प्लेसहोल्डर भी नहीं। अन-ट्यून्ड थ्रेशहोल्ड से आया कोई आँकड़ा प्लेसहोल्डर है, और हम उसे परिणाम बनकर पेश करने के बजाय प्लेसहोल्डर ही कहते हैं।`,
      fix: 'रजिस्ट्री इसलिए मौजूद है कि बाद में ट्यूनिंग एक देखने योग्य फ़ाइल बदलाव हो। वह ग़ायब JSON फ़ाइल ही एकमात्र चीज़ है जो इसे कोडबेस के बाहर पढ़ने योग्य रजिस्ट्री से अलग करती है।',
    },
  },
  {
    mk: '!',
    en: {
      h: 'No device build yet — every on-device claim is still a claim',
      p: 'The Android field application has been written but never compiled, because no Android SDK was available in the build environment. Until a device build exists, nothing on this page has been shown to run on a phone: the on-device numbers are a claim, not a measurement, and we label them that way.',
      fix: 'The SDK-free verification script does compile and test the platform-free subset, and that is how several real defects were found. The first real device build is still outstanding.',
    },
    hi: {
      h: 'अभी कोई डिवाइस बिल्ड नहीं — हर ऑन-डिवाइस दावा अभी दावा ही है',
      p: 'एंड्रॉइड फ़ील्ड एप्लिकेशन लिखा जा चुका है, पर संकलित कभी नहीं हुआ, क्योंकि बिल्ड वातावरण में एंड्रॉइड SDK उपलब्ध नहीं था। जब तक डिवाइस बिल्ड नहीं बनता, इस पृष्ठ की कोई चीज़ फ़ोन पर चलकर दिखाई नहीं गई है: ऑन-डिवाइस आँकड़े एक दावा हैं, माप नहीं — और हम उन्हें वैसा ही लेबल करते हैं।',
      fix: 'SDK-रहित जाँच स्क्रिप्ट प्लेटफ़ॉर्म-मुक्त हिस्सा वाकई संकलित और परीक्षित करती है, और कई वास्तविक दोष उसी से मिले। पहला असली डिवाइस बिल्ड अब भी बाक़ी है।',
    },
  },
];

export function renderLimits() {
  const host = document.getElementById('limits');
  if (!host) return;

  // One limit quotes the run record, so it needs the record. loadEvalRun() dedupes on
  // the same promise renderMeasured() is already using, so this costs no extra fetch,
  // and a language toggle finds the record in memory and re-renders from it.
  if (!evalData && !limitsLoadFailed) {
    loadEvalRun()
      .then(() => renderLimits())
      .catch(() => { limitsLoadFailed = true; renderLimits(); });
    return;
  }

  const facts = thresholdFacts(evalData);
  // A limit's `p` may be a function of the record, so the counts in it are counted out
  // of the run rather than typed in. Both languages are always built, so the node carries
  // a real data-hi even though only one of the two is showing.
  const prose = (lang) => (typeof lang.p === 'function' ? lang.p(facts) : lang.p);
  const blocks = LIMITS.map((entry) => {
    const lang = isHindi() ? entry.hi : entry.en;
    const block = el('div', 'limit');
    block.appendChild(el('div', 'mk', entry.mk));
    const text = el('div');
    text.appendChild(bi('h4', null, lang.h, lang.h));
    text.appendChild(bi('p', null, prose(entry.en), prose(entry.hi)));
    text.appendChild(bi('div', 'fix', lang.fix, lang.fix));
    block.appendChild(text);
    return block;
  });
  fill(host, ...blocks);
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
