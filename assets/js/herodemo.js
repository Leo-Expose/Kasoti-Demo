/**
 * Docuscan — the live hero instrument, and the judge brief strip above it.
 *
 * Two pieces, both built from real data and the real engine:
 *
 *   1. `initHeroDemo()` builds an instrument panel in the hero that runs the
 *      actual `parse()` / `allPassed()` from `./mrz.js` over a TD3 zone the
 *      instrument builds itself from field values (never hand-typed, so it
 *      cannot be malformed), walks its five check digits one term at a time,
 *      then alters a single digit and re-runs the same engine. The arithmetic on
 *      screen is `computeDetailed()`'s own `steps[]`, `sum` and `expected` —
 *      nothing here is a canned animation or a simulated verdict.
 *
 *   2. The judge brief strip's three numbers are read out of
 *      `data/evalrun.json` at runtime so they cannot drift from the evaluation
 *      record. If that fetch fails the strip renders em-dashes. It never renders
 *      a zero, because a zero here would read as a measurement.
 *
 * Honesty rules this file obeys, because the whole project rests on them:
 *   - no claim on screen that the page cannot itself demonstrate;
 *   - nothing animates while the visitor is reading (scroll / focus / blur);
 *   - `prefers-reduced-motion: reduce` gets one static, complete, valid frame.
 *
 * Nothing touches `document` at module scope. `initHeroDemo()` is idempotent:
 * main.js calls it again on every language change and it tears the previous
 * instance down first.
 */

import { parse, allPassed, computeDetailed, FILLER } from './mrz.js';
import { getLang } from './i18n.js';

const EVALRUN_URL = 'data/evalrun.json';
const EM = '—';

/* ------------------------------------------------------------------ timing */
/* Chosen so the whole story lands in about eleven seconds and the loop restarts
   before a judge's attention does: a judge who watches fifteen seconds sees the
   zone read, all five check digits evaluated, a digit altered, both failures
   reported, and the beginning of a second run. */
const T = {
  char: 16,      // one MRZ character revealed. 26ms read as 'nothing is happening';
              // the zone now ghosts in first, so a quicker sweep looks intentional
  term: 15,      // one value x weight = product term
  settle: 230,   // pause once a check's sum is on screen
  preTamper: 420,
  tamper: 620,
  summary: 2600, // hold the failing frame long enough to read it
  hold: 1300,    // breath before resetting
};

/* ------------------------------------------------------- the specimen zone */
/* The project's own zero-PII specimen, matching the lab's default: synthetic
   name, synthetic document number, no real person's document data anywhere. */

const SPECIMEN = {
  docNumber: 'AB1234567', nationality: 'IND', dob: '900608', sex: 'M',
  expiry: '310607', personalNumber: '<<<<<<<<<<<<<<',
  surname: 'SHARMA', givenNames: 'RAMESH',
};

/** Check digit for a field, from the same function the engine uses. */
const cd = (field) => {
  const d = computeDetailed(field);
  return d.ok ? d.expected : '0';
};

const pad = (s, n) => (s + FILLER.repeat(n)).slice(0, n);

/** ICAO 9303 Part 4/5 TD3: two lines of 44. Valid by construction. */
function buildTd3() {
  const l1 = [
    pad(SPECIMEN.docNumber, 9), cd(pad(SPECIMEN.docNumber, 9)),
    pad(SPECIMEN.nationality, 3),
    SPECIMEN.dob, cd(SPECIMEN.dob),
    SPECIMEN.sex,
    SPECIMEN.expiry, cd(SPECIMEN.expiry),
    pad(SPECIMEN.personalNumber, 14), cd(pad(SPECIMEN.personalNumber, 14)),
  ].join('');
  const l2 = pad(`${SPECIMEN.surname}<<${SPECIMEN.givenNames}`, 44);
  const composite = cd(l1.slice(0, 10) + l1.slice(13, 20) + l1.slice(21, 43) + l2);
  return [l1.slice(0, 43) + composite, l2];
}

/**
 * Which tape characters each check digit reaches.
 *
 * These are the ICAO 9303 Part 5 TD3 offsets — the same `slice()` indices
 * `parseTd3()` in `./mrz.js` uses — so the colouring here agrees with the lab by
 * construction. The verdict attached to each segment always comes from the
 * engine's own `checks[]`, never from this table.
 */
function td3Segments() {
  return [
    { line: 0, from: 0, to: 9, digit: [0, 9], field: 'DOCUMENT_NUMBER' },
    { line: 0, from: 13, to: 19, digit: [0, 19], field: 'BIRTH_DATE' },
    { line: 0, from: 21, to: 27, digit: [0, 27], field: 'EXPIRY_DATE' },
    { line: 0, from: 28, to: 42, digit: [0, 42], field: 'PERSONAL_NUMBER' },
    { line: 0, from: 0, to: 10, digit: [0, 43], field: 'COMPOSITE' },
    { line: 0, from: 13, to: 20, digit: null, field: 'COMPOSITE' },
    { line: 0, from: 21, to: 43, digit: null, field: 'COMPOSITE' },
    { line: 1, from: 0, to: 44, digit: null, field: 'COMPOSITE' },
  ];
}

/** The check-digit field order, as ICAO 9303 part 5 lays it out for TD3. */
const CHECK_ORDER = ['DOCUMENT_NUMBER', 'BIRTH_DATE', 'EXPIRY_DATE', 'PERSONAL_NUMBER', 'COMPOSITE'];

const CHECK_LABELS = {
  DOCUMENT_NUMBER: ['Document number', 'दस्तावेज़ संख्या'],
  BIRTH_DATE: ['Date of birth', 'जन्म तिथि'],
  EXPIRY_DATE: ['Date of expiry', 'मान्यता समाप्ति'],
  PERSONAL_NUMBER: ['Personal number', 'व्यक्तिगत संख्या'],
  COMPOSITE: ['Composite', 'समग्र'],
};

/* Copy. Both languages on every user-facing string. */
const L = {
  live: ['live · the same engine the lab uses', 'लाइव · प्रयोगशाला वही इंजन'],
  phaseReveal: ['reading the zone', 'क्षेत्र पढ़ा जा रहा है'],
  phaseChecks: ['evaluating five check digits', 'पाँच चेक डिजिट की गणना'],
  phaseTamper: ['altering one digit', 'एक अंक बदला जा रहा है'],
  phaseDone: ['verdict', 'निर्णय'],
  phasePaused: ['paused', 'रुका हुआ'],
  capReveal: [
    'a TD3 zone: two lines of 44 characters',
    'TD3 क्षेत्र: 44 अक्षरों की दो पंक्तियाँ',
  ],
  capChecks: [
    'each check digit is a weighted sum, weights 7 3 1, modulo 10',
    'हर चेक डिजिट भार-गुणित योग है, भार 7 3 1, mod 10',
  ],
  capTamper: ['one digit of the check position changed, and nothing else', 'चेक स्थान का एक अंक बदला, और कुछ नहीं'],
  capFail: [
    'document number check digit failed, composite failed',
    'दस्तावेज़ संख्या का चेक डिजिट विफल, समग्र चेक डिजिट विफल',
  ],
  capPass: ['all five agree', 'पाँचों सहमत हैं'],
  capPaused: [
    'paused — it will hold still while you read',
    'रुका हुआ — आपके पढ़ने तक यह स्थिर रहेगा',
  ],
  sum: ['sum', 'योग'],
  expected: ['expected', 'अपेक्षित'],
  observed: ['observed', 'पाया गया'],
  pass: ['pass', 'पास'],
  fail: ['fail', 'विफल'],
  terms: ['terms', 'पद'],
};

/* ------------------------------------------------------------------- state */

const state = {
  timer: null,
  stepIndex: 0,
  steps: null,
  running: false,
  userPaused: false,   // deliberate stop via pauseHeroDemo(); only resumeHeroDemo() clears it
  outOfView: false,    // scrolled past — a *suspension*, lifts on scroll back
  engaged: false,      // visitor is reading/interacting elsewhere — also a suspension
  hidden: false,
  reduced: false,
  nodes: null,
  disposers: [],
  observer: null,
  mq: null,
  mounted: false,
  sawFirstObserverEntry: false,
  watchdog: null,
  holding: false,   // true while the finished frame is held before a rebuild
};

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** A node carrying both languages, already written in the active one. */
function bi(en, hi, tag = 'span', cls = '') {
  const useHi = getLang() === 'hi';
  return el(tag, { class: cls, 'data-en': en, 'data-hi': hi, text: useHi ? hi : en });
}

function fromL(key, tag = 'span', cls = '') {
  const [en, hi] = L[key];
  return bi(en, hi, tag, cls);
}

function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-IN') : EM);

/* ------------------------------------------------------------- the brief strip */

/**
 * Three numbers, one caveat. Every figure is read from the evaluation record at
 * runtime; a missing key or a failed fetch yields an em-dash, never a zero.
 */
/** The evaluation counters, fetched at most once per page load. */
let countersPromise = null;
function loadCounters() {
  if (!countersPromise) {
    countersPromise = fetch(EVALRUN_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => (json && typeof json === 'object' && json.counters ? json.counters : null))
      // A failed load is remembered as a resolved null so we do not retry on every
      // toggle, but it is cleared on the next full page load by definition.
      .catch(() => null);
  }
  return countersPromise;
}

async function renderBrief(mount) {
  const set = (i, text) => {
    const n = mount.querySelector(`[data-slot="${i}"]`);
    if (n) n.textContent = text;
  };

  // Fetched once per page load, not once per render. `initHeroDemo()` is re-run on
  // every language toggle, and `cache: 'no-store'` meant each toggle put a request
  // on the wire for a file that cannot have changed. The counters are a property
  // of the evaluation record, not of the language.
  const counters = await loadCounters();

  // A stale brief is worse than an empty one: main.js may have rebuilt the strip
  // while this fetch was in flight, so bail out if our mount is gone.
  if (!document.body.contains(mount)) return;

  const c = counters || {};
  const num = (key) => (typeof c[key] === 'number' ? c[key] : null);

  set('docs', fmt(num('mrz.corpus.rows')));
  const caught = num('mrz.mutate_catch.detectable_caught');
  const detectable = num('mrz.mutate_catch.detectable_total');
  set('caught', caught === null || detectable === null ? EM : `${fmt(caught)} / ${fmt(detectable)}`);
  set('blind', fmt(num('mrz.mutate_catch.structurally_blind')));

  mount.setAttribute('data-loaded', counters ? '1' : '0');
}

/* --------------------------------------------------------- instrument render */

/** Colour every tape character from the engine's own per-check verdicts. */
function paintTape(maps) {
  const { tapeRows, lines } = state.nodes;
  lines.forEach((line, li) => {
    const row = tapeRows[li];
    if (!row) return;
    const map = maps[li];
    for (let i = 0; i < line.length; i++) {
      const cell = row.children[1 + i];
      if (!cell) continue;
      // painting a final state also lights it: an unlit cell here would render
      // the tape as an empty box on the reduced-motion and paused frames
      cell.classList.remove('f-pending');
      cell.setAttribute('data-cd', map[i] || 'none');
    }
  });
}

/** Blank tape: every character present but unlit, so the box is never empty. */
function blankTape() {
  const { tapeRows, lines } = state.nodes;
  lines.forEach((line, li) => {
    const row = tapeRows[li];
    if (!row) return;
    for (let i = 0; i < line.length; i++) {
      const cell = row.children[1 + i];
      if (cell) { cell.setAttribute('data-cd', 'none'); cell.classList.add('f-pending'); }
    }
  });
}

function buildTape(host, lines) {
  const rows = [];
  lines.forEach((line, li) => {
    const row = el('div', { class: 'tape-line instrument-line' });
    row.appendChild(el('span', { class: 'ln', text: String(li + 1) }));
    for (const ch of line) {
      row.appendChild(el('span', { class: 'f f-pending', 'data-cd': 'none', text: ch }));
    }
    host.appendChild(row);
    rows.push(row);
  });
  return rows;
}

function buildChecks(host) {
  const rows = [];
  for (const field of CHECK_ORDER) {
    const [en, hi] = CHECK_LABELS[field];
    const name = bi(en, hi, 'span', 'icheck-name');
    // Plain span, no data-en/data-hi: it is filled from the engine's own numbers
    // and must not exist as an empty bilingual pair waiting to be swapped.
    const sum = el('span', { class: 'icheck-sum' });
    const verdict = el('span', { class: 'pill icheck-verdict' });
    const terms = el('div', { class: 'icheck-terms' });
    const row = el('div', { class: 'icheck', 'data-field': field },
      el('div', { class: 'icheck-head' }, name, sum, verdict),
      terms);
    host.appendChild(row);
    rows.push({ field, row, name, sum, verdict, terms });
  }
  return rows;
}

/* ------------------------------------------------------------- the story run */

/**
 * The loop as an explicit list of steps, so pausing is `clearTimeout` and
 * resuming is picking the list back up at the same index.
 */
function buildSteps(view) {
  const { lines } = state;
  const steps = [];
  const at = (fn, ms) => steps.push({ fn, ms });

  at(() => setPhase('phaseReveal'), 0);
  at(() => setCaption('capReveal'), 0);
  // line 1 is revealed a character at a time; it is where all five check digits
  // live. Line 2 carries no check digit of its own, so it lights in one step.
  for (let i = 0; i < lines[0].length; i++) at(() => revealChar(i), T.char);
  at(() => revealLine2(), T.char);

  at(() => setPhase('phaseChecks'), 260);
  at(() => setCaption('capChecks'), 0);
  for (const field of CHECK_ORDER) {
    at(() => beginCheck(field), 120);
    const c = view.byField.get(field);
    const stepsFor = (c && c.steps) || [];
    for (let k = 0; k < stepsFor.length; k++) at(() => pushTerm(field, k), T.term);
    at(() => endCheck(field), T.settle);
  }

  at(() => setPhase('phaseTamper'), T.preTamper);
  at(() => setCaption('capTamper'), 0);
  at(() => tamper(), T.tamper);

  at(() => setPhase('phaseDone'), 120);
  at(() => setCaption('capFail'), 0);
  at(() => {}, T.summary);
  at(() => reset(view), T.hold);
  return steps;
}

/* --------------------------------------------------------- step primitives */

function setPhase(key) {
  const n = state.nodes;
  if (!n || !n.phase) return;
  clear(n.phase);
  n.phase.appendChild(fromL(key));
  n.instrument.setAttribute('data-phase', key);
}

function setCaption(key) {
  const n = state.nodes;
  if (!n || !n.caption) return;
  clear(n.caption);
  n.caption.appendChild(fromL(key, 'span'));
}

function revealChar(i) {
  const n = state.nodes;
  const cell = n.tapeRows[0].children[1 + i];
  if (cell) cell.classList.remove('f-pending');
}

/** Line 2 carries no check digit of its own; it only feeds the composite. */
function revealLine2() {
  const n = state.nodes;
  const row = n.tapeRows[1];
  if (!row) return;
  for (let k = 0; k < state.lines[1].length; k++) {
    const c = row.children[1 + k];
    if (c) c.classList.remove('f-pending');
  }
}

function beginCheck(field) {
  const row = state.nodes.byField.get(field);
  if (!row) return;
  row.row.classList.add('is-active');
  row.row.setAttribute('data-state', 'active');
  row.terms.textContent = '';
  row.verdict.className = 'pill icheck-verdict';
  clear(row.sum);
  clear(row.verdict);
  row.sum.appendChild(document.createTextNode('…'));
}

function pushTerm(field, k) {
  const row = state.nodes.byField.get(field);
  const c = state.view && state.view.byField.get(field);
  if (!row || !c || !c.steps || !c.steps[k]) return;
  const s = c.steps[k];
  const chip = el('span', { class: 'icterm', text: `${s.ch}·${s.weight}=${s.product}` });
  row.terms.appendChild(chip);
  // keep the newest term in view without scrolling the page
  if (row.terms.scrollWidth > row.terms.clientWidth) {
    row.terms.scrollLeft = row.terms.scrollWidth;
  }
}

function endCheck(field) {
  const row = state.nodes.byField.get(field);
  const c = state.view && state.view.byField.get(field);
  if (!row || !c) return;
  row.row.classList.remove('is-active');
  row.row.setAttribute('data-state', c.passed ? 'pass' : 'fail');
  row.terms.textContent = '';
  clear(row.sum);
  clear(row.verdict);
  const hi = getLang() === 'hi';
  const label = (en, hiText) => el('span', {
    class: 'icheck-cmp', 'data-en': en, 'data-hi': hiText,
    text: hi ? hiText : en,
  });
  row.sum.appendChild(label(L.sum[0], L.sum[1]));
  row.sum.appendChild(document.createTextNode(` ${c.sum} mod 10 = ${c.expected}`));
  row.sum.appendChild(document.createTextNode(' · '));
  row.sum.appendChild(label(L.expected[0], L.expected[1]));
  row.sum.appendChild(document.createTextNode(` ${c.expected}`));
  row.sum.appendChild(document.createTextNode(' · '));
  row.sum.appendChild(label(L.observed[0], L.observed[1]));
  row.sum.appendChild(document.createTextNode(` ${c.observed}`));
  row.verdict.className = `pill icheck-verdict ${c.passed ? 'PASS' : 'FAIL'}`;
  row.verdict.appendChild(bi(
    c.passed ? L.pass[0] : L.fail[0],
    c.passed ? L.pass[1] : L.fail[1],
    'span', 'icheck-verdictlabel',
  ));
}

/** Alter one digit of the document-number check position, then re-run the engine. */
function tamper() {
  const n = state.nodes;
  const bad = state.lines[0].split('');
  const at9 = 9;
  bad[at9] = bad[at9] === '0' ? '1' : '0';
  const tampered = [bad.join(''), state.lines[1]];

  // re-run the real engine over the altered zone
  const result = parse(tampered.join('\n'), new Date().getFullYear());
  const passed = allPassed(result);
  const byField = new Map(result.checks.map((c) => [c.field, c]));
  state.view = { result, passed, byField };

  // repaint the check rows and the tape from that result
  for (const field of CHECK_ORDER) endCheck(field);
  const maps = tapeMaps(result);
  paintTape(maps);
  const altered = n.tapeRows[0].children[1 + at9];
  if (altered) altered.setAttribute('data-altered', '1');

  n.instrument.setAttribute('data-verdict', passed ? 'PASS' : 'FAIL');
  n.instrument.setAttribute('data-tampered', '1');
}

function reset() {
  const n = state.nodes;
  n.instrument.setAttribute('data-verdict', 'PENDING');
  n.instrument.setAttribute('data-tampered', '0');
  // Label the empty tape as what it is. Without this the panel spent one frame
  // showing the previous phase's label over a blanked tape, which reads as a
  // glitch rather than as the start of the next cycle.
  setPhase('phaseReveal');
  for (const field of CHECK_ORDER) {
    const row = n.byField.get(field);
    if (!row) continue;
    row.row.classList.remove('is-active');
    row.row.setAttribute('data-state', 'pending');
    row.terms.textContent = '';
    clear(row.sum);
    clear(row.verdict);
  }
  blankTape();
  // the engine's verdict for the untampered specimen
  const result = parse(state.lines.join('\n'), new Date().getFullYear());
  const byField = new Map(result.checks.map((c) => [c.field, c]));
  state.view = { result, passed: allPassed(result), byField };
}

/* ------------------------------------------------- character coverage table */

/**
 * Which characters each check digit covers, coloured by that check's engine
 * verdict — the same three states the lab's tape legend defines: `ok` covered by
 * a check digit that agreed, `bad` covered by one that failed, `none` reached by
 * no check digit at all. Later segments win, exactly as `cdMaps()` in
 * `./pdfscan.js` behaves, so the hero and the lab never disagree.
 */
function tapeMaps(result) {
  const maps = result.rawLines.map((l) => new Array(l.length).fill('none'));
  const segs = td3Segments();
  const byField = new Map(result.checks.map((c) => [c.field, c]));
  for (const seg of segs) {
    const c = byField.get(seg.field);
    if (!c) continue;
    const mark = c.passed ? 'ok' : 'bad';
    for (let i = seg.from; i < seg.to; i++) maps[seg.line][i] = mark;
    if (seg.digit) maps[seg.digit[0]][seg.digit[1]] = mark;
  }
  return maps;
}

/* ------------------------------------------------------------ static frames */

/**
 * One complete, valid frame with every digit passing and the caption on screen.
 * Used for `prefers-reduced-motion` and whenever the loop is paused by the
 * visitor, so the panel is never blank and never mid-draw.
 */
function renderStaticFrame() {
  const n = state.nodes;
  if (!n) return;
  reset();
  // endCheck, not a hand-written summary: the sums and the PASS pills on this
  // frame come from the engine parsing the untampered specimen
  for (const field of CHECK_ORDER) endCheck(field);
  paintTape(tapeMaps(state.view.result));
  n.instrument.setAttribute('data-verdict', 'PASS');
  n.instrument.setAttribute('data-static', '1');
  setPhase('phasePaused');
  setCaption('capPaused');
}

/* --------------------------------------------------------------- the loop */

function schedule(fn, ms) {
  if (!state.running) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    fn();
  }, ms);
}

function tick() {
  if (!state.running || !state.steps) return;

  if (state.holding) {
    // The finished frame has been held. Rebuild and start the story over.
    state.holding = false;
    state.stepIndex = 0;
    reset();
  } else if (!state.steps[state.stepIndex]) {
    // Story complete: hold the finished frame before rebuilding.
    //
    // This used to reset() immediately and hold afterwards, which blanked the tape
    // for the whole 1.3 s breath. The payoff frame — the tamper, the red characters,
    // "document number check digit failed, composite failed" — is the one thing
    // worth leaving on screen, and it was the one thing that got wiped.
    //
    // The order of the two branches matters and was got wrong once: with the
    // `!steps[i]` test first, the timer re-armed on every tick and the `holding`
    // branch below it was unreachable, so the loop spun on the hold forever and
    // never restarted the story.
    state.holding = true;
    schedule(tick, T.hold);
    return;
  }

  const step = state.steps[state.stepIndex];
  state.stepIndex++;
  step.fn();
  schedule(tick, step.ms || T.char);
}

function startLoop() {
  if (state.running || !state.steps) return;
  // The guard used to be `userPaused || hidden` only, which was correct before the
  // scroll and focus suspensions existed and silently wrong after. It is written
  // out from `reconcileLoop`'s condition rather than kept in sync by hand.
  if (!wantsLoop()) return;
  state.running = true;
  schedule(tick, 320);
}

/** The single condition. `reconcileLoop` and `startLoop` must agree by construction. */
function wantsLoop() {
  return !state.userPaused && !state.outOfView && !state.engaged
    && !state.hidden && !state.reduced;
}

function stopLoop() {
  state.running = false;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
}

/* ------------------------------------------------------------------ public */

/**
 * The one place that decides whether the loop runs.
 *
 * Every trigger — scroll position, focus, tab visibility, reduced motion — goes
 * through here rather than calling startLoop/stopLoop itself. That is what makes a
 * permanently-dead instrument impossible: there is no path that can stop the loop
 * without recording why, and no state in which "it should be running" and "it is
 * not running" can disagree.
 */
function reconcileLoop() {
  if (!state.mounted) return;
  const shouldRun = wantsLoop();

  if (shouldRun) {
    if (!state.running) startLoop();
  } else {
    stopLoop();
    // Freeze on a complete frame, never mid-reveal, so the panel is never blank
    // and never looks broken to someone who scrolls back up.
    if (state.nodes) renderStaticFrame();
  }
}

/** Stop the loop and leave it stopped until resumeHeroDemo(). */
export function pauseHeroDemo() {
  state.userPaused = true;
  reconcileLoop();
}

/** Start the loop again, unless a suspension still applies. */
export function resumeHeroDemo() {
  state.userPaused = false;
  state.outOfView = false;
  state.engaged = false;
  reconcileLoop();
}

/** Build (or rebuild) the instrument and the brief strip. Safe to call twice. */
export function initHeroDemo() {
  teardown();

  const mount = $('hero-instrument');
  const briefMount = $('hero-brief');
  const lang = getLang();

  state.reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  state.hidden = document.hidden;
  state.userPaused = false;
  state.outOfView = false;
  state.engaged = false;
  state.sawFirstObserverEntry = false;
  state.running = false;
  state.holding = false;
  state.stepIndex = 0;

  if (briefMount) renderBrief(briefMount);
  if (!mount) return;

  const lines = buildTd3();
  state.lines = lines;

  const instrument = el('div', {
    class: 'instrument',
    'data-verdict': 'PENDING',
    'data-tampered': '0',
    'data-phase': 'phaseReveal',
  });

  const dot = el('i', { class: 'instrument-dot' });
  const title = bi(L.live[0], L.live[1], 'span', 'instrument-title');
  const phase = el('span', { class: 'instrument-phase' });
  instrument.appendChild(el('div', { class: 'instrument-top' }, dot, title, phase));

  const tape = el('div', { class: 'instrument-tape' });
  const tapeRows = buildTape(tape, lines);
  instrument.appendChild(tape);

  const checks = el('div', { class: 'instrument-checks' });
  const checkRows = buildChecks(checks);
  instrument.appendChild(checks);

  const caption = el('p', { class: 'instrument-caption' });
  instrument.appendChild(caption);

  clear(mount);
  mount.appendChild(instrument);

  const byField = new Map(checkRows.map((r) => [r.field, r]));
  state.nodes = {
    instrument, tapeRows, lines, byField, phase, caption, checks,
  };

  // seed the engine state for the untampered specimen
  reset();
  setPhase('phaseReveal');
  setCaption('capReveal');

  state.steps = buildSteps(state.view);

  /* ---- interaction: the visitor always wins ---- */

  // Scrolled past the instrument, so it must not keep moving. The trigger is
  // "the instrument is entirely above the top of the viewport", inset by the
  // height of the sticky nav — not a visibility ratio, and not the hero as a
  // whole: the instrument sits low in a hero taller than a laptop viewport, so it
  // leaves the screen well before the hero does, and it is the instrument that
  // must not keep moving.
  //
  // TWO THINGS THIS MUST NOT DO, both of which it did:
  //
  //  1. Treat the observer's FIRST callback as a verdict. That callback fires once
  //     on registration, before layout has necessarily settled, and a single
  //     spurious `!isIntersecting` used to call pauseHeroDemo() — which sets a
  //     flag nothing clears — so the instrument died after one phase and never
  //     reached the tamper. It never resumed. The payoff animation, the whole
  //     point of the panel, simply did not play.
  //  2. Only ever pause. Scrolling past and back left it permanently dead.
  //
  // So: act on transitions only, and treat "out of view" as a suspension that
  // lifts when the instrument comes back.
  const inst = $('hero-instrument');
  if (inst && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!state.mounted) return;
        if (!state.sawFirstObserverEntry) { state.sawFirstObserverEntry = true; continue; }
        state.outOfView = !e.isIntersecting;
        reconcileLoop();
      }
    }, { rootMargin: '-72px 0px 0px 0px', threshold: 0 });
    io.observe(inst);
    state.observer = io;
  }

  // focused a control in the lab, the corpus card or the PDF panel. Also a
  // suspension: scroll back to the hero and it starts again.
  const onFocusIn = (e) => {
    if (!state.mounted) return;
    const t = e.target;
    if (t && t.closest && t.closest('#lab, #corpus, #pdf, #verdicts, .ticker')) {
      state.engaged = true;
      reconcileLoop();
    }
  };
  document.addEventListener('focusin', onFocusIn);
  state.disposers.push(() => document.removeEventListener('focusin', onFocusIn));

  // Any scroll or focus settles "engaged": if the visitor is back up in the hero
  // with the instrument on screen, the loop is wanted again.
  const release = () => {
    if (!state.mounted) return;
    if (state.outOfView || state.hidden || state.reduced) return;
    if (!state.engaged) return;
    state.engaged = false;
    reconcileLoop();
  };
  window.addEventListener('scroll', release, { passive: true });
  state.disposers.push(() => window.removeEventListener('scroll', release));
  document.addEventListener('focusout', () => { /* handled on the next scroll */ });

  const onVis = () => {
    state.hidden = document.hidden;
    reconcileLoop();
  };
  document.addEventListener('visibilitychange', onVis);
  state.disposers.push(() => document.removeEventListener('visibilitychange', onVis));

  if (window.matchMedia) {
    state.mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => {
      state.reduced = state.mq.matches;
      reconcileLoop();
    };
    if (state.mq.addEventListener) state.mq.addEventListener('change', onMq);
    state.disposers.push(() => {
      if (state.mq && state.mq.removeEventListener) state.mq.removeEventListener('change', onMq);
    });
  }

  state.mounted = true;

  // Watchdog. Every trigger above is an event, and events get missed: an
  // IntersectionObserver can fire before layout settles, a scroll can be absorbed
  // by scroll-snap, a tab can be restored without a visibilitychange in some
  // browsers. The instrument then sits in a state where it should be running and
  // is not, and the payoff animation — the whole point of the panel — never plays.
  // One reconcile per second is free and makes every missed event self-healing.
  // It cannot start the loop when it should be stopped: `wantsLoop()` is the same
  // predicate, so the watchdog only ever repairs the running/stopped mismatch.
  state.watchdog = setInterval(reconcileLoop, 1000);
  state.disposers.push(() => clearInterval(state.watchdog));

  // Go through the same decision point as every other trigger, so a freshly
  // mounted instrument cannot come up in a different state from one that was
  // merely resumed.
  reconcileLoop();
}

/**
 * Remove everything this module installed. Called at the top of initHeroDemo(),
 * which is the only place it is needed: it runs on boot and again on every
 * language change, and must not leave a second instance behind.
 *
 * Deliberately not wired to `pagehide`. That event also fires when a page enters
 * the back/forward cache, and tearing the instrument down there would restore an
 * empty hero when the visitor pressed Back. Nothing here outlives the document,
 * so the unload case needs no work.
 */
function teardown() {
  stopLoop();
  state.mounted = false;
  for (const d of state.disposers) { try { d(); } catch { /* listener already gone */ } }
  state.disposers = [];
  if (state.observer) { state.observer.disconnect(); state.observer = null; }
  state.mq = null;
  state.nodes = null;
  state.steps = null;
  state.view = null;
  const mount = $('hero-instrument');
  if (mount) clear(mount);
}
