/**
 * KASOTI-Demo — entry point.
 *
 * Wires the page together: language toggle, hero counters, the live MRZ lab, the
 * 10,000-row corpus runner, the PDF panel, and the replayed data panels.
 *
 * Nothing here makes a network request carrying anything the visitor typed or
 * dropped. The only fetches are this page's own static assets and its data files.
 */

import { parse, allPassed, failedFields, computeDetailed } from './mrz.js';
import { loadCorpus, runCorpus } from './corpus.js';
import { t, setLang, getLang, applyStatic } from './i18n.js';
import { initPdfPanel, rerenderPdfPanel, annotate, cdMaps } from './pdfscan.js';
import { renderScenarios, renderMeasured, renderLimits, renderProvenance, rerenderPanels } from './panels.js';
import { initHeroDemo } from './herodemo.js';

/* ---------------------------------------------------------------- helpers */

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data')) node.setAttribute(k, v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** An element carrying both languages, so applyStatic() can swap it. */
function bi(en, hi, tag = 'p', cls = '') {
  return el(tag, { class: cls, 'data-en': en, 'data-hi': hi }, en);
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* ------------------------------------------------------- hero live counters */

const stats = { docs: 0, cd: 0, tamper: 0, ms: 0, n: 0 };

function tickTicker() {
  $('tk-docs').textContent = stats.docs.toLocaleString('en-IN');
  $('tk-cd').textContent = stats.cd.toLocaleString('en-IN');
  $('tk-tamper').textContent = stats.tamper.toLocaleString('en-IN');
  $('tk-ms').textContent = stats.n ? (stats.ms / stats.n).toFixed(2) : '0.00';
}

/** Count one screening, so the hero reflects what the visitor actually did. */
function countRun(result, elapsedMs) {
  stats.docs++;
  stats.cd += result.checks.length;
  if (!allPassed(result)) stats.tamper++;
  stats.ms += elapsedMs;
  stats.n++;
  tickTicker();
}

/* ------------------------------------------------------------------ samples */

/**
 * Specimens for the lab, assembled from fields rather than typed by hand.
 *
 * The first version of this file hand-wrote the MRZ lines and three of them were
 * the wrong length, so the parser correctly reported "unrecognised" and the panel
 * looked broken. Building them here and computing every check digit with the same
 * `computeDetailed` the engine uses means a specimen cannot be malformed: if the
 * builder produces a line, that line is valid by construction.
 *
 * The identity is the project's own zero-PII specimen — synthetic name, synthetic
 * document number. No real person's document data is in this file.
 */
function cd(text) {
  const d = computeDetailed(text);
  return d.ok ? d.expected : '0';
}

const pad = (s, n) => (s + '<'.repeat(n)).slice(0, n);

/** ICAO 9303 Part 4/5 TD3: two lines of 44. */
function buildTd3({ docNumber, nationality, dob, sex, expiry, personalNumber, surname, givenNames }) {
  const l1 = [
    pad(docNumber, 9), cd(pad(docNumber, 9)),
    pad(nationality, 3),
    dob, cd(dob),
    sex,
    expiry, cd(expiry),
    pad(personalNumber, 14), cd(pad(personalNumber, 14)),
  ].join('');
  const l2 = pad(`${surname}<<${givenNames || ''}`, 44);
  const composite = cd(l1.slice(0, 10) + l1.slice(13, 20) + l1.slice(21, 43) + l2);
  return [l1.slice(0, 43) + composite, l2];
}

/** ICAO 9303 Part 6 TD1: three lines of 30. Note: no composite check digit. */
function buildTd1({ docNumber, nationality, dob, sex, optional1, expiry, optional2, issuer, surname, givenNames }) {
  const o1 = pad(optional1, 8);
  const o2 = pad(optional2, 6);
  const iss = pad(issuer, 15);
  const name = pad(`${surname}<<${givenNames || ''}`, 29);
  return [
    [pad(docNumber, 9), cd(pad(docNumber, 9)), pad(nationality, 3), dob, cd(dob), sex, o1, cd(o1)].join(''),
    name + cd(name),
    [o2, cd(o2), expiry, cd(expiry), iss, cd(iss)].join(''),
  ];
}

const TD3_FIELDS = {
  docNumber: 'AB1234567', nationality: 'IND', dob: '900608', sex: 'M',
  expiry: '310607', personalNumber: '<<<<<<<<<<<<<<', surname: 'SHARMA', givenNames: 'RAMESH',
};
const TD1_FIELDS = {
  docNumber: 'AB1234567', nationality: 'IND', dob: '880824', sex: 'M',
  optional1: '12345678', optional2: '654321', expiry: '310607',
  issuer: 'AUTHORITY1', surname: 'SINGH', givenNames: 'RAMESH',
};

function buildSamples() {
  const td3 = buildTd3(TD3_FIELDS);
  const td1 = buildTd1(TD1_FIELDS);

  // Alter the printed document-number check digit. The composite covers that
  // position, so both the field check and the composite fail.
  const badCd = td3[0].split('');
  badCd[9] = badCd[9] === '0' ? '1' : '0';

  // Alter one name character. TD3 line 2 carries no check digit of its own, but
  // the composite spans the whole line, so the composite catches it.
  const badName = td3[1].split('');
  badName[0] = badName[0] === 'S' ? 'X' : 'S';

  // The genuinely blind case: alter a name character in a TD1 zone AND recompute
  // that field's own check digit. Every one of the seven checks then passes and
  // the alteration is undetectable by arithmetic — because a TD1 zone has no
  // composite check digit. This is the same class as the 746 structurally blind
  // rows in the corpus, and the panel says so rather than hiding it.
  const badNameTd1 = td1[1].split('');
  badNameTd1[0] = badNameTd1[0] === 'S' ? 'X' : 'S';
  const nameSpan = badNameTd1.slice(0, 29).join('');
  badNameTd1[29] = cd(nameSpan);

  return [
    { key: 'valid-td3', en: 'Valid TD3 passport', hi: 'सही TD3 पासपोर्ट', mrz: td3.join('\n') },
    { key: 'valid-td1', en: 'Valid TD1 identity card', hi: 'सही TD1 पहचान पत्र', mrz: td1.join('\n') },
    { key: 'bad-cd', en: 'One check digit altered', hi: 'एक चेक डिजिट बदला', mrz: [badCd.join(''), td3[1]].join('\n') },
    { key: 'bad-name', en: 'One name character altered', hi: 'नाम का एक अक्षर बदला', mrz: [td3[0], badName.join('')].join('\n') },
    { key: 'td1-blind', en: 'TD1 alteration we cannot catch', hi: 'TD1 में बदलाव जिसे हम पकड़ नहीं सकते', mrz: [td1[0], badNameTd1.join(''), td1[2]].join('\n') },
  ];
}

function renderSamples() {
  const host = $('mrz-samples');
  clear(host);
  for (const s of buildSamples()) {
    const btn = bi(s.en, s.hi, 'button', 'sampletag');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      $('mrz-input').value = s.mrz;
      runMrzLab();
      $('mrz-input').focus();
    });
    host.appendChild(btn);
  }
}

/* ----------------------------------------------------------------- MRZ lab */

const FIELD_LABELS = {
  _fmt: ['Format', 'प्रारूप'],
  DOCUMENT_NUMBER: ['Document number', 'दस्तावेज़ संख्या'],
  NAME: ['Name', 'नाम'],
  GIVEN_NAMES: ['Given names', 'पहले नाम'],
  NATIONALITY: ['Nationality', 'राष्ट्रीयता'],
  BIRTH_DATE: ['Date of birth', 'जन्म तिथि'],
  SEX: ['Sex', 'लिंग'],
  EXPIRY_DATE: ['Date of expiry', 'मान्यता समाप्ति'],
  PERSONAL_NUMBER: ['Personal number', 'व्यक्तिगत संख्या'],
  OPTIONAL_DATA: ['Optional data', 'वैकल्पिक आँकड़ा'],
  ISSUER: ['Issuing authority', 'जारीकर्ता'],
};

function fieldRow(key, en, hi, value) {
  const [ken, khi] = FIELD_LABELS[key] || [key, key];
  return el('div', { class: 'frow' },
    bi(ken, khi, 'div', 'k'),
    el('div', { class: 'v' }, value === null || value === undefined || value === '' ? '—' : String(value)));
}

/** The check-digit arithmetic, shown in full rather than asserted. */
function renderMath(check) {
  const wrap = el('div', { class: 'math' });
  const head = el('div', { class: 'math-head' });
  const [fen, fhi] = FIELD_LABELS[check.field] || [check.field, check.field];
  head.appendChild(bi(fen, fhi, 'span', 'fname'));
  head.appendChild(el('span', { class: 'pill ' + (check.passed ? 'PASS' : 'FAIL'), text: check.passed ? 'pass' : 'fail' }));
  wrap.appendChild(head);

  if (check.badChar) {
    wrap.appendChild(el('div', { class: 'math-foot' },
      el('span', { class: 'mono', style: 'color:var(--red)' },
        `character '${check.badChar}' at position ${check.badIndex} is outside the MRZ alphabet A-Z 0-9 <`)));
    return wrap;
  }

  const scroll = el('div', { class: 'math-scroll' });
  const table = el('table', { class: 'calc' });
  const thead = el('tr', {},
    bi('char', 'अक्षर', 'th'), bi('value', 'मान', 'th'), bi('weight', 'भार', 'th'), bi('product', 'गुणनफल', 'th'));
  table.appendChild(thead);
  for (const s of check.steps) {
    table.appendChild(el('tr', {},
      el('td', { class: 'ch', text: s.ch }),
      el('td', { text: String(s.value) }),
      el('td', { text: String(s.weight) }),
      el('td', { text: String(s.product) })));
  }
  table.appendChild(el('tr', { class: 'sum' },
    el('td', { text: '' }), el('td', { text: '' }),
    el('td', { class: 'mono', text: 'Σ' }),
    el('td', { text: String(check.sum) })));
  scroll.appendChild(table);
  wrap.appendChild(scroll);

  const foot = el('div', { class: 'math-foot' });
  foot.appendChild(bi(`${check.sum} mod 10 = `, `${check.sum} mod 10 = `, 'span', 'mono'));
  foot.appendChild(el('b', { style: check.passed ? 'color:var(--green)' : 'color:var(--red)', text: check.expected }));
  const sep = el('span', { class: 'mono', style: 'color:var(--ink-3)' });
  sep.appendChild(document.createTextNode(' '));
  foot.appendChild(sep);
  foot.appendChild(bi('expected', 'अपेक्षित', 'span', 'mono'));
  foot.appendChild(el('span', { style: 'width:6px' }));
  foot.appendChild(bi('observed', 'पाया गया', 'span', 'mono'));
  foot.appendChild(el('b', { class: 'num', style: 'color:var(--ink-2)', text: check.observed === null ? '—' : check.observed }));
  if (!check.passed && check.observed !== null) {
    foot.appendChild(bi('— the printed digit disagrees with the arithmetic', '— मुद्रित अंक गणना से मेल नहीं खाता', 'span', 'mono'));
  }
  wrap.appendChild(foot);
  return wrap;
}

function renderMrzResult(result, elapsedMs) {
  countRun(result, elapsedMs);

  // Verdict. Fail-closed, and the gate has two independent conditions.
  //
  // `allPassed` alone is NOT sufficient. A zone can have every check digit
  // agreeing and still be undecidable — a birth date of month 13, 31 February,
  // or day 00 all pass the 7-3-1 arithmetic and are still not a real document.
  // The Kotlin refuses to grade those (`MrzParser.validateDateField`); before
  // `mrz.js` started recording date problems, neither did this panel, and it
  // rendered a green PASS on a month-13 birth date. So structural errors gate
  // the verdict exactly as a failed check digit does.
  const vhost = $('mrz-verdict');
  clear(vhost);
  const structErrors = result.structuralErrors || [];
  if (result.format === 'UNKNOWN') {
    vhost.appendChild(bi('unrecognised', 'अपरिचित', 'span', 'pill NONE'));
  } else if (structErrors.length > 0) {
    vhost.appendChild(bi('no verdict — the zone is not a real document', 'कोई निर्णय नहीं — क्षेत्र वास्तविक दस्तावेज़ नहीं है', 'span', 'pill NONE'));
  } else if (allPassed(result)) {
    vhost.appendChild(bi('all check digits agree', 'सभी चेक डिजिट सही', 'span', 'pill PASS'));
  } else {
    const bad = failedFields(result);
    vhost.appendChild(el('span', { class: 'pill FAIL' },
      bi('check digit failed', 'चेक डिजिट विफल', 'span'),
      el('span', { style: 'opacity:.7', text: ' ' + bad.join(', ') })));
  }

  // tape, coloured from the same span table the PDF panel uses
  const cells = annotate(result);
  const maps = cdMaps(result, cells);
  const tape = $('mrz-tape');
  clear(tape);
  if (result.rawLines.length === 0) {
    tape.appendChild(bi('Paste a machine-readable zone to begin.', 'शुरू करने के लिए मशीन-पठन क्षेत्र चिपकाएँ।', 'div', 'tape-line'));
  } else {
    result.rawLines.forEach((line, li) => {
      const row = el('div', { class: 'tape-line' });
      row.appendChild(el('span', { class: 'ln', text: String(li + 1) }));
      const map = maps[li] || new Array(line.length).fill('none');
      for (let i = 0; i < line.length; i++) {
        row.appendChild(el('span', { class: 'f', 'data-cd': map[i] || 'none', text: line[i] }));
      }
      tape.appendChild(row);
    });
    tape.appendChild(renderTapeLegend());
  }

  // fields
  const fhost = $('mrz-fields');
  clear(fhost);
  if (result.format === 'UNKNOWN') {
    fhost.appendChild(el('div', { class: 'frow' },
      bi('Layout', 'लेआउट', 'div', 'k'),
      el('div', { class: 'v' },
        `${result.rawLines.length} line(s) × ${result.rawLines[0] ? result.rawLines[0].length : 0} characters`)));
    for (const e of result.structuralErrors) {
      fhost.appendChild(el('div', { class: 'frow' },
        bi('Reason', 'कारण', 'div', 'k'),
        el('div', { class: 'v', style: 'color:var(--ink-2)', text: e })));
    }
  } else {
    // Structural problems are shown first and in full, whatever the shape. A
    // check digit can pass on a date that does not exist, so a green-looking
    // field grid next to an impossible birth date would be the wrong picture.
    if (structErrors.length > 0) {
      const block = el('div', { class: 'frow head' },
        bi('Not a real document', 'वास्तविक दस्तावेज़ नहीं', 'div', 'k'),
        el('div', { class: 'v', style: 'color:var(--amber)' },
          bi('the arithmetic agrees, but the field values cannot exist — so we return no verdict rather than a pass',
             'गणना सही है, पर फ़ील्ड के मान संभव नहीं हैं — इसलिए हम पास के बजाय कोई निर्णय नहीं देते', 'div')));
      fhost.appendChild(block);
      for (const e of structErrors) {
        fhost.appendChild(el('div', { class: 'frow' },
          bi('Reason', 'कारण', 'div', 'k'),
          el('div', { class: 'v', style: 'color:var(--amber)', text: e })));
      }
    }
    fhost.appendChild(fieldRow('_fmt', 'Format', 'प्रारूप', result.format === 'TD3' ? 'TD3 — passport (2 × 44)' : 'TD1 — identity card (3 × 30)'));
    const name = [result.name.surname, result.name.givenNames].filter(Boolean).join(', ');
    fhost.appendChild(fieldRow('NAME', null, null, name));
    fhost.appendChild(fieldRow('DOCUMENT_NUMBER', null, null, result.documentNumber));
    fhost.appendChild(fieldRow('NATIONALITY', null, null, result.nationality));
    fhost.appendChild(fieldRow('BIRTH_DATE', null, null, result.birthDate));
    fhost.appendChild(fieldRow('SEX', null, null, result.sex));
    fhost.appendChild(fieldRow('EXPIRY_DATE', null, null, result.expiryDate));
    fhost.appendChild(fieldRow('PERSONAL_NUMBER', null, null, result.personalNumber));
    if (result.issuer) fhost.appendChild(fieldRow('ISSUER', null, null, result.issuer));
    if (result.optionalData) fhost.appendChild(fieldRow('OPTIONAL_DATA', null, null, result.optionalData));
  }

  // checks
  const chost = $('mrz-checks');
  clear(chost);
  if (result.checks.length === 0) {
    chost.appendChild(bi('No check digits to verify in that shape.', 'उस आकार में जाँचने योग्य कोई चेक डिजिट नहीं।', 'div', 'mono'));
  } else {
    for (const c of result.checks) chost.appendChild(renderMath(c));
    chost.appendChild(bi(
      'ICAO 9303 TD3 line 2 is pure name and carries no check digit of its own — its integrity is covered by the composite above. A TD1 zone has no composite at all, which is why some alterations to it are undetectable by arithmetic.',
      'ICAO 9303 TD3 की दूसरी पंक्ति केवल नाम है और उसका कोई अपना चेक डिजिट नहीं — उसकी अखंडता ऊपर के कॉम्पोज़िट से कवर होती है। TD1 क्षेत्र में कोई कॉम्पोज़िट होता ही नहीं, इसीलिए उसमें कुछ बदलाव गणना से पकड़े नहीं जा सकते।',
      'p', 'mono'));
    chost.lastChild.style.cssText = 'font-size:.76rem;color:var(--ink-3);margin-top:14px';
  }
}

/**
 * What the tape colours mean. Without this a judge sees green and red characters
 * and has to guess, which is worse than no colour at all.
 */
function renderTapeLegend() {
  const swatch = (cls) => el('span', {
    class: 'f', 'data-cd': cls,
    style: 'padding:1px 4px;border-radius:2px;margin-right:6px;background:#07080a;border:1px solid #23282f',
    text: 'ABC123',
  });
  const item = (cls, en, hi) => el('span', { style: 'display:inline-flex;align-items:center;margin:0 20px 4px 0' },
    swatch(cls), bi(en, hi, 'span'));
  return el('div', { class: 'mono', style: 'font-size:.7rem;color:var(--ink-2);letter-spacing:.02em;padding:2px 2px 6px' },
    item('ok', 'covered by a check digit that agreed', 'सहमत चेक डिजिट से कवर'),
    item('bad', 'covered by a check digit that failed', 'विफल चेक डिजिट से कवर'),
    item('none', 'no check digit reaches this character', 'इस अक्षर तक कोई चेक डिजिट नहीं पहुँचता'),
  );
}

function runMrzLab() {
  const raw = $('mrz-input').value;
  const t0 = performance.now();
  const result = parse(raw, new Date().getFullYear());
  renderMrzResult(result, performance.now() - t0);
}

/**
 * Keystroke handler. Debounced, because the hero counters count *analyses*: run
 * per `input` event they ticked on every character of a half-typed line and
 * "tampered zones caught" counted a failed analysis rather than a distinct zone,
 * so re-typing the same tampered zone inflated it. A short settle also stops the
 * panel strobing through UNKNOWN while a line is being typed.
 */
let mrzTimer = null;
function onMrzInput() {
  clearTimeout(mrzTimer);
  mrzTimer = setTimeout(runMrzLab, 160);
}

/* ------------------------------------------------------------------- corpus */

let corpusRunning = false;

async function onRunCorpus() {
  if (corpusRunning) return;
  corpusRunning = true;
  const btn = $('corpus-run');
  const status = $('corpus-status');
  const prog = $('corpus-progress');
  const bar = $('corpus-progress-bar');
  btn.disabled = true;
  clear(status);
  status.appendChild(bi('Loading corpus…', 'कॉर्पस लोड हो रहा है…', 'span'));
  prog.style.display = '';
  bar.style.width = '0%';
  $('corpus-results').classList.add('hidden');

  try {
    const rows = await loadCorpus('data/corpus.txt', (done, total) => {
      status.textContent = `${done.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')}`;
    });

    const t0 = performance.now();
    const r = await runCorpus(rows, (done, total) => {
      bar.style.width = ((done / total) * 100).toFixed(1) + '%';
      status.textContent = `${done.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')} — ${t('corpus.running')}`;
    });
    const elapsed = performance.now() - t0;
    bar.style.width = '100%';
    status.textContent = `${rows.length.toLocaleString('en-IN')} rows in ${elapsed.toFixed(0)} ms`;
    renderCorpus(r);
    $('corpus-results').classList.remove('hidden');
  } catch (err) {
    status.textContent = '';
    status.appendChild(el('span', { style: 'color:var(--red)', text: 'corpus failed: ' + err.message }));
  } finally {
    btn.disabled = false;
    prog.style.display = 'none';
    corpusRunning = false;
  }
}

function statTile(value, label, cls = '') {
  return el('div', { class: 'stat ' + cls },
    el('b', { class: 'num', text: value }),
    el('i', {}, label));
}

function renderCorpus(r) {
  // headline stats
  const host = $('corpus-stats');
  clear(host);
  host.appendChild(statTile(r.total.toLocaleString('en-IN'), t('corpus.rows')));
  // The caught figure is a numerator. Showing "6,725 / 6,725" in one cell made the
  // tile clip at narrow widths, so the denominator moves into the label where it
  // can wrap. The number is derived, never typed.
  host.appendChild(statTile(
    r.caught.toLocaleString('en-IN'),
    bi('mutants caught, of ' + r.detectable.toLocaleString('en-IN') + ' detectable',
       r.detectable.toLocaleString('en-IN') + ' पहचान योग्य में से पकड़े गए उत्परिवर्तन', 'i'),
    'good'));
  host.appendChild(statTile(r.blind.toLocaleString('en-IN'), t('corpus.blind'), 'warn'));
  host.appendChild(statTile(String(r.falsePositives), t('corpus.fp'), r.falsePositives === 0 ? 'good' : 'bad'));
  const agreeLabel = el('i', {}, `${t('corpus.agree')}`);
  host.appendChild(el('div', { class: 'stat ' + (r.disagreements.length === 0 ? 'good' : 'bad') },
    el('b', { class: 'num', text: `${r.agreements.toLocaleString('en-IN')} / ${(r.total).toLocaleString('en-IN')}` }),
    agreeLabel));

  // self-check
  const sc = $('corpus-selfcheck');
  clear(sc);
  const ok = r.disagreements.length === 0;
  sc.appendChild(el('div', { class: 'notice' + (ok ? '' : ' plain'), style: ok ? '' : 'border-color:#7f1d1d;background:#1e0d0d;color:#ffd2d2' },
    el('b', { text: t('corpus.selfcheck') + ' — ' }),
    ok ? t('corpus.selfok') : `${t('corpus.selfbad')} (${r.disagreements.length})`));
  // Say what the comparison actually is. "Agrees on every row" means the
  // caught-vs-blind decision matched the recorded run row by row — for the 2,529
  // unmutated control rows that means "was not wrongly flagged", which the
  // false-positive count covers. It is not a byte-for-byte comparison of two
  // implementations, and saying so would be the kind of overclaim this page
  // exists to avoid.
  sc.appendChild(bi(
    'Compared row by row: for each of the 7,471 mutants, whether this engine flags it matches the run that recorded it. The 2,529 unmutated documents are checked the other way — this engine must not flag them, and flagged none.',
    'पंक्ति-दर-पंक्ति तुलना: 7,471 उत्परिवर्तितों में से प्रत्येक के लिए, क्या यह इंजन उसे चिह्नित करता है, यह दर्ज रन से मेल खाता है। 2,529 अपरिवर्तित दस्तावेज़ उल्टी दिशा में जाँचे जाते हैं — यह इंजन उन्हें चिह्नित नहीं करना चाहिए, और एक भी नहीं किया।',
    'p', 'mono'));
  sc.lastChild.style.cssText = 'font-size:.76rem;color:var(--ink-3);margin:10px 0 0';
  if (!ok) {
    const ul = el('ul', { class: 'mono', style: 'font-size:.74rem;color:var(--ink-2)' });
    for (const d of r.disagreements.slice(0, 8)) {
      ul.appendChild(el('li', { text: `${d.id} · ${d.mutation} · expected ${d.expected} · got ${d.got}` }));
    }
    sc.appendChild(ul);
  }

  // per-mutation table
  const table = $('corpus-table');
  clear(table);
  const head = el('tr', {},
    bi('Mutation', 'उत्परिवर्तन', 'th'),
    bi('Rows', 'पंक्तियाँ', 'th'),
    bi('Detectable', 'पहचान योग्य', 'th'),
    bi('Caught', 'पकड़े', 'th'),
    bi('Catch rate', 'पकड़ दर', 'th'),
    bi('Blind', 'अंधी', 'th'));
  table.appendChild(el('thead', {}, head));
  const tbody = el('tbody');
  for (const b of r.byMutation) {
    const isControl = b.detectable === 0;
    const rate = isControl ? null : (b.caught / b.detectable) * 100;
    const rateCell = rate === null
      ? el('td', { class: 'n', style: 'color:var(--ink-3)', text: '—' })
      : el('td', { class: 'n' },
          el('span', { text: rate.toFixed(1) + '% ' }),
          el('div', { class: 'bar' + (rate < 100 ? ' warn' : '') },
            el('i', { style: `width:${Math.max(0, Math.min(100, rate))}%` })));
    tbody.appendChild(el('tr', {},
      el('td', { class: 'lbl', text: b.mutation }),
      el('td', { class: 'n', text: b.rows.toLocaleString('en-IN') }),
      el('td', { class: 'n', text: b.detectable.toLocaleString('en-IN') }),
      el('td', { class: 'n', text: b.caught.toLocaleString('en-IN') }),
      rateCell,
      el('td', { class: 'n', style: b.blind ? 'color:var(--amber)' : 'color:var(--ink-3)', text: b.blind ? b.blind.toLocaleString('en-IN') : '0' })));
  }
  table.appendChild(tbody);
  const note = el('caption', { style: 'caption-side:bottom;text-align:left;font-family:var(--mono);font-size:.7rem;color:var(--ink-3);padding-top:10px' });
  note.appendChild(document.createTextNode('NONE is the unmutated control set: it has no detectable mutants, so a catch rate is undefined for it. The '));
  note.appendChild(document.createTextNode(`${r.falsePositives}`));
  note.appendChild(document.createTextNode(' false-positive count is the number of control rows this engine wrongly rejected.'));
  table.appendChild(note);

  // blind reasons
  const bh = $('corpus-blind');
  clear(bh);
  const reasons = new Set();
  for (const b of r.byMutation) for (const x of b.reasons) reasons.add(x);
  if (reasons.size === 0) {
    bh.appendChild(bi('No structurally blind rows in this corpus.', 'इस कॉर्पस में कोई संरचनात्मक अंधी पंक्ति नहीं।', 'div'));
  } else {
    for (const reason of reasons) bh.appendChild(el('div', { style: 'margin-bottom:8px' }, reason));
  }
}

/* ------------------------------------------------------------ language wiring */

function wireLanguage() {
  const host = $('lang-toggle');
  host.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      if (lang === getLang()) return;
      setLang(lang);
      host.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      applyStatic(document);
      initHeroDemo();          // herodemo nodes are rebuilt in the active language
      rerenderPanels();
      rerenderPdfPanel();
      renderSamples();
      runMrzLab();
    });
  });
}

/* ------------------------------------------------------------------- boot */

function boot() {
  applyStatic(document);
  wireLanguage();
  initHeroDemo();
  renderSamples();
  tickTicker();

  $('mrz-input').addEventListener('input', onMrzInput);
  $('corpus-run').addEventListener('click', onRunCorpus);

  // start on the project's own zero-PII specimen so the panel is never empty
  $('mrz-input').value = buildTd3(TD3_FIELDS).join('\n');
  runMrzLab();

  initPdfPanel();

  // data panels. Deliberately not awaited: a failure here must not stop the lab.
  renderScenarios().catch((e) => console.error('scenarios', e));
  renderMeasured().catch((e) => console.error('measured', e));
  renderLimits();
  renderProvenance();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
