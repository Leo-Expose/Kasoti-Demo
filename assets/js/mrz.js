/**
 * Docuscan — ICAO 9303 machine-readable-zone engine.
 *
 * This is a direct port of `core/src/commonMain/kotlin/dev/kasoti/mrz/MrzCheckDigit.kt`
 * and `MrzParser.kt` from the Kotlin source repo. It is here so a judge can verify the
 * arithmetic by hand in front of us, and so the 10,000-row corpus can be re-checked
 * in the browser.
 *
 * It is NOT a re-implementation of Docuscan's fusion rules. Those are not re-implemented
 * anywhere in this demo; the verdict panel replays real engine output instead. What is
 * ported here is the ICAO 9303 standard itself: repeating weights 7,3,1, values
 * 0-9 -> 0..9, A-Z -> 10..35, '<' -> 0, modulo 10.
 *
 * Fail-closed, same as the original: any character outside the MRZ alphabet makes the
 * computation fail rather than fuzzy-pass.
 */

export const FILLER = '<';
const WEIGHTS = [7, 3, 1];
const UPPER_ALNUM = /^[0-9A-Z<]*$/;

/** Numeric value of an MRZ character, or null if it is outside the MRZ alphabet. */
export function value(ch) {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  if (ch === FILLER) return 0;
  return null;
}

/**
 * Check digit with the full working shown, so the page can display the arithmetic
 * rather than assert a result.
 * @returns {{ok: boolean, expected: string|null, sum: number|null, steps: Array}}
 */
export function computeDetailed(field) {
  const steps = [];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const v = value(field[i]);
    if (v === null) {
      return { ok: false, expected: null, sum: null, steps, badChar: field[i], badIndex: i };
    }
    const w = WEIGHTS[i % WEIGHTS.length];
    steps.push({ ch: field[i], value: v, weight: w, product: v * w });
    sum += v * w;
  }
  return { ok: true, expected: String(sum % 10), sum, steps, badChar: null, badIndex: -1 };
}

export function compute(field) {
  const r = computeDetailed(field);
  return r.ok ? r.expected : null;
}

export function verify(field, given) {
  const e = compute(field);
  return e !== null && e === given;
}

/** Kotlin `slice(start, endExclusive)` semantics, including the out-of-range cases. */
function slice(s, start, endExclusive) {
  if (start >= s.length) return '';
  return s.slice(start, Math.min(endExclusive, s.length));
}

const trimFiller = (s) => s.replace(/</g, ' ').trim().replace(/\s+/g, ' ');

/** Mirrors `MrzFormat.detect`. */
export function detectFormat(lines) {
  if (lines.length === 2 && lines.every((l) => l.length === 44)) return 'TD3';
  if (lines.length === 3 && lines.every((l) => l.length === 30)) return 'TD1';
  return 'UNKNOWN';
}

function check(field, span, observed) {
  const d = computeDetailed(span);
  return {
    field,
    span,
    expected: d.expected,
    observed: observed === FILLER ? null : observed,
    passed: d.ok && d.expected === observed,
    steps: d.steps,
    sum: d.sum,
    badChar: d.badChar,
  };
}

function parseName(field) {
  const sep = field.indexOf(FILLER.repeat(2));
  if (sep < 0) return { surname: trimFiller(field), givenNames: null, raw: field };
  return {
    surname: trimFiller(field.slice(0, sep)),
    givenNames: trimFiller(field.slice(sep + 2)) || null,
    raw: field,
  };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** `CalendarDate.daysInMonth` as the 12-entry table the validator indexes. */
function daysInMonths(year) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
}

function resolveYear(yy, referenceYear) {
  const century = Math.floor(referenceYear / 100) * 100;
  let y = century + parseInt(yy, 10);
  if (y > referenceYear + 25) y -= 100;
  return y;
}

/**
 * `CalendarDate.parseYymmdd`, reduced to the question this file asks of it: does the
 * six-digit field name a real day in the resolved year? Returns that year, or null.
 */
function resolveRealYear(text, referenceYear) {
  if (text.length !== 6) return null;
  if (!/^[0-9]{6}$/.test(text)) return null;
  const mm = parseInt(text.slice(2, 4), 10);
  const dd = parseInt(text.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = resolveYear(text.slice(0, 2), referenceYear);
  return dd <= daysInMonths(year)[mm - 1] ? year : null;
}

/** ISO form of a real `YYMMDD`; null when the six digits are not a real date. */
function isoFrom6(yyMMdd, referenceYear) {
  const y = resolveRealYear(yyMMdd, referenceYear);
  if (y === null) return null;
  return `${String(y).padStart(4, '0')}-${yyMMdd.slice(2, 4)}-${yyMMdd.slice(4, 6)}`;
}

/**
 * Mirrors `MrzParser.validateDateField`, including its message text and its order of
 * tests, and — the part the first JavaScript port dropped — it pushes into the *caller's*
 * `errors` list, which is what becomes `structuralErrors`. Kotlin then uses the same
 * predicate a second time, with a throwaway sink, to decide whether the field is exposed
 * at all (`takeIf { validateDateField(..., mutableListOf()) == null }`); here a single call
 * does both, so the exposed value and the recorded error cannot drift apart.
 *
 * An all-filler field is an absent date on a non-mandatory track, not an error: Kotlin
 * returns the raw text and pushes nothing, and so does this. (`/^<*$/` is vacuously true
 * for the empty string, exactly like Kotlin's `text.all { it == FILLER }`.)
 *
 * @returns the value to expose for the field (ISO date, or the raw filler text), else null
 */
function validateDateField(field, text, referenceYear, errors) {
  if (/^<*$/.test(text)) return text;
  if (!/^[0-9]*$/.test(text)) {
    errors.push(`${field} date '${text}' is not six digits`);
    return null;
  }
  const mm = parseInt(text.slice(2, 4), 10);
  const dd = parseInt(text.slice(4, 6), 10);
  if (resolveRealYear(text, referenceYear) === null) {
    errors.push(`${field} date '${text}' is not a real calendar date`);
    return null;
  }
  if (!(mm >= 1 && mm <= 12)) {
    errors.push(`${field} date '${text}' has month ${mm}`);
    return null;
  }
  if (dd < 1 || dd > 31) {
    errors.push(`${field} date '${text}' has day ${dd}`);
    return null;
  }
  return isoFrom6(text, referenceYear);
}

function parseTd3(l1, l2, referenceYear) {
  const errors = [];
  const checks = [
    check('DOCUMENT_NUMBER', slice(l1, 0, 9), l1[9]),
    check('BIRTH_DATE', slice(l1, 13, 19), l1[19]),
    check('EXPIRY_DATE', slice(l1, 21, 27), l1[27]),
    check('PERSONAL_NUMBER', slice(l1, 28, 42), l1[42]),
  ];
  // ICAO 9303 Part 5: TD3 line 2 is pure name and carries no check digit of its own.
  // Its integrity is covered by the composite, which spans the whole of line 2.
  const spans = [slice(l1, 0, 10), slice(l1, 13, 20), slice(l1, 21, 43), l2];
  checks.push({
    ...check('COMPOSITE', spans.join(''), l1[43]),
    spanParts: spans,
  });

  if (!UPPER_ALNUM.test(l1) || !UPPER_ALNUM.test(l2)) {
    errors.push('MRZ contains characters outside the A-Z0-9< alphabet');
  }
  // The date sink is this function's `errors`, so an impossible date is a structural
  // error the caller can refuse a verdict on. Same order as the Kotlin.
  const birth = validateDateField('BIRTH_DATE', slice(l1, 13, 19), referenceYear, errors);
  const expiry = validateDateField('EXPIRY_DATE', slice(l1, 21, 27), referenceYear, errors);
  const sex = l1[20];
  if (!'MFX<'.includes(sex)) errors.push(`sex '${sex}' is not M/F/X/<`);

  return {
    format: 'TD3', rawLines: [l1, l2], checks, structuralErrors: errors,
    documentNumber: trimFiller(slice(l1, 0, 9)) || null,
    nationality: trimFiller(slice(l1, 10, 13)) || null,
    birthDate: birth,
    sex: sex === FILLER ? null : sex,
    expiryDate: expiry,
    personalNumber: trimFiller(slice(l1, 28, 42)) || null,
    name: parseName(l2),
  };
}

function parseTd1(l1, l2, l3, referenceYear) {
  const errors = [];
  const optional1 = slice(l1, 21, 29);
  const checks = [
    check('DOCUMENT_NUMBER', slice(l1, 0, 9), l1[9]),
    check('BIRTH_DATE', slice(l1, 13, 19), l1[19]),
    check('OPTIONAL_DATA', optional1, l1[29]),
    check('NAME', slice(l2, 0, 29), l2[29]),
    check('OPTIONAL_DATA', slice(l3, 0, 6), l3[6]),
    check('EXPIRY_DATE', slice(l3, 7, 13), l3[13]),
    check('PERSONAL_NUMBER', slice(l3, 14, 29), l3[29]),
  ];
  if (!UPPER_ALNUM.test(l1) || !UPPER_ALNUM.test(l2) || !UPPER_ALNUM.test(l3)) {
    errors.push('MRZ contains characters outside the A-Z0-9< alphabet');
  }
  const birth = validateDateField('BIRTH_DATE', slice(l1, 13, 19), referenceYear, errors);
  const expiry = validateDateField('EXPIRY_DATE', slice(l3, 7, 13), referenceYear, errors);
  const sex = l1[20];
  if (!'MFX<'.includes(sex)) errors.push(`sex '${sex}' is not M/F/X/<`);

  return {
    format: 'TD1', rawLines: [l1, l2, l3], checks, structuralErrors: errors,
    documentNumber: trimFiller(slice(l1, 0, 9)) || null,
    nationality: trimFiller(slice(l1, 10, 13)) || null,
    birthDate: birth,
    sex: sex === FILLER ? null : sex,
    expiryDate: expiry,
    optionalData: trimFiller(optional1) || null,
    issuer: trimFiller(slice(l3, 14, 29)) || null,
    name: parseName(l2),
  };
}

/**
 * Total and non-throwing, same as the Kotlin original: a bad check digit still yields
 * every field, with the failure attributed per field. Callers gate on `allPassed`.
 */
export function parse(input, referenceYear = new Date().getFullYear()) {
  const lines = String(input)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const format = detectFormat(lines);
  if (format === 'TD3') return parseTd3(lines[0], lines[1], referenceYear);
  if (format === 'TD1') return parseTd1(lines[0], lines[1], lines[2], referenceYear);
  return {
    format: 'UNKNOWN', rawLines: lines, checks: [], structuralErrors: [
      `shape ${lines.length}x${lines[0] ? lines[0].length : 0} matches no TD3/TD1 layout`,
    ],
    documentNumber: null, nationality: null, birthDate: null, sex: null,
    expiryDate: null, personalNumber: null, optionalData: null, issuer: null,
    name: { surname: null, givenNames: null, raw: '' },
  };
}

/** True iff every check digit that exists agreed. */
export function allPassed(result) {
  if (result.format === 'UNKNOWN') return false;
  if (result.checks.length === 0) return false;
  return result.checks.every((c) => c.passed);
}

export function failedFields(result) {
  return result.checks.filter((c) => !c.passed).map((c) => c.field);
}

/**
 * Scan free text for candidate MRZ lines. Used by the PDF panel, where the MRZ may
 * arrive as OCR text rather than as a tidy block.
 *
 * TD3 lines are exactly 44 chars from the MRZ alphabet; we allow a little slack on the
 * per-line length because PDF text extraction routinely splits or joins runs, then
 * report the shape we actually found rather than guessing.
 */
export function findMrzCandidates(text) {
  const out = [];
  const raw = String(text).toUpperCase().split(/[^0-9A-Z<]+/);
  for (const tok of raw) {
    if (tok.length >= 40 && tok.length <= 48) out.push(tok);
  }
  // Adjacent 44-char tokens are a TD3 pair.
  const pairs = [];
  for (let i = 0; i + 1 < out.length; i++) {
    if (out[i].length === 44 && out[i + 1].length === 44) {
      pairs.push([out[i], out[i + 1]]);
    }
  }
  return { tokens: out, pairs };
}
