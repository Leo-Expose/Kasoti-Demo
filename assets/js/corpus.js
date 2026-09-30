/**
 * KASOTI-Demo — the 10,000-row MRZ mutation corpus, re-checked in the browser.
 *
 * `data/corpus.txt` is the corpus from the real eval run, one row per line:
 *
 *   id|format|mutation|expectedCaught|blindSpotReason|line1|line2|line3
 *
 * The browser re-derives caught / blind with its own 7-3-1 implementation and compares
 * against `expectedCaught`. That comparison is the self-check: if the totals land exactly
 * on the numbers the JVM harness recorded, this JavaScript port is correct, and if they
 * do not, the page says so instead of quietly agreeing with itself.
 */

import { parse, allPassed } from './mrz.js';

export async function loadCorpus(url = 'data/corpus.txt', onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`corpus fetch failed: ${res.status}`);
  const text = await res.text();
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const p = line.split('|');
    if (p.length < 8) continue;
    rows.push({
      id: p[0], format: p[1], mutation: p[2],
      expectedCaught: p[3] === '1',
      blindReason: p[4] || null,
      lines: [p[5], p[6], p[7]].filter((l) => l.length > 0),
    });
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return rows;
}

const CHUNK = 500;

/**
 * Run the corpus. Yields to the event loop between chunks so the progress bar paints.
 * @param rows corpus rows
 * @param onProgress (done, total, partial)
 */
export async function runCorpus(rows, onProgress, referenceYear = 2026) {
  const byMutation = new Map();
  let detectable = 0, caught = 0, blind = 0, falsePositives = 0, validRows = 0;
  let agreements = 0, disagreements = [];
  const disagreementsByKind = new Map();

  // `i` is the loop variable for the outer walk; the inner loop uses its own counter so
  // the chunk boundary cannot advance the outer index. (An earlier version shared `i`
  // between the two and silently skipped every second block of rows — it still reported
  // total=10000, which is exactly the kind of quiet wrongness this project exists to catch.)
  for (let base = 0; base < rows.length; base += CHUNK) {
    const end = Math.min(base + CHUNK, rows.length);
    for (let i = base; i < end; i++) {
      const r = rows[i];
      const result = parse(r.lines.join('\n'), referenceYear);
      const flagged = !allPassed(result);   // engine says "this document is not intact"

      let b = byMutation.get(r.mutation);
      if (!b) {
        b = { mutation: r.mutation, rows: 0, detectable: 0, caught: 0, blind: 0, falsePositives: 0, reasons: new Set() };
        byMutation.set(r.mutation, b);
      }
      b.rows++;

      // The self-check runs on EVERY row, including the unmutated control set,
      // before any `continue`. A NONE row's expected outcome is `false` (a valid
      // document must not be flagged), so `flagged === r.expectedCaught` is the
      // right comparison for those rows too.
      //
      // An earlier version `continue`d on NONE before reaching this check, so the
      // agreement counter topped out at 7,471 and the page rendered "7,471 /
      // 10,000" — which reads as 2,529 disagreements when in fact all 10,000 rows
      // agree. The 2,529 are covered by the false-positive count instead. Both
      // numbers are now right, and the tile can honestly say 10,000 / 10,000.
      if (flagged === r.expectedCaught) {
        agreements++;
      } else {
        disagreements.push({ id: r.id, mutation: r.mutation, expected: r.expectedCaught, got: flagged });
        disagreementsByKind.set(r.mutation, (disagreementsByKind.get(r.mutation) || 0) + 1);
      }

      if (r.mutation === 'NONE') {
        validRows++;
        if (flagged) { b.falsePositives++; falsePositives++; }
        continue;
      }
      if (r.expectedCaught) {
        detectable++;
        b.detectable++;
        if (flagged) { caught++; b.caught++; }
      } else {
        blind++;
        b.blind++;
        if (r.blindReason) b.reasons.add(r.blindReason);
      }
    }
    if (onProgress) onProgress(end, rows.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    total: rows.length,
    detectable, caught, blind, validRows, falsePositives,
    agreements, disagreements,
    disagreementsByKind: Object.fromEntries(disagreementsByKind),
    byMutation: [...byMutation.values()]
      .map((b) => ({ ...b, reasons: [...b.reasons] }))
      .sort((a, b) => b.rows - a.rows),
  };
}
