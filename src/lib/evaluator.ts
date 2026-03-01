// Evaluation harness and calibration metrics.
// Designed to run without popup/UI interaction (Node.js or browser).

import { assessRisk } from './risk.js';

// ---------------------------------------------------------------------------
// Core eval types
// ---------------------------------------------------------------------------

export type Platform = 'win' | 'mac' | 'linux';
export type EvalWindow = `${number}-Q${1 | 2 | 3 | 4}`;

export interface EvalMeta {
  platform: Platform;
  window: EvalWindow;
  personaId: string;
}

export interface EvalCase {
  id: string;
  input: string;
  output: string;
  meta: EvalMeta;
}

export interface EvalResult {
  id: string;
  platform: Platform;
  window: EvalWindow;
  personaId: string;
  inputRisk: number;
  outputRisk: number;
  delta: number;           // inputRisk - outputRisk (positive = improved)
  divergence: number;      // 0..1 character bigram divergence (from evaluator)
  passedThreshold: boolean; // outputRisk <= targetRisk
}

// ---------------------------------------------------------------------------
// Text divergence (character bigram Jaccard)
// ---------------------------------------------------------------------------

function charBigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const set = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
}

export function computeDivergence(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const ba = charBigrams(a);
  const bb = charBigrams(b);
  let intersection = 0;
  for (const bg of ba) {
    if (bb.has(bg)) intersection++;
  }
  const union = ba.size + bb.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}

// ---------------------------------------------------------------------------
// Case evaluation
// ---------------------------------------------------------------------------

export function evaluateCases(
  cases: EvalCase[],
  targetRisk = 0.30
): EvalResult[] {
  return cases.map((c) => {
    const inputRisk = assessRisk(c.input).score;
    const outputRisk = assessRisk(c.output).score;
    const divergence = computeDivergence(c.input, c.output);
    return {
      id: c.id,
      platform: c.meta.platform,
      window: c.meta.window,
      personaId: c.meta.personaId,
      inputRisk,
      outputRisk,
      delta: inputRisk - outputRisk,
      divergence,
      passedThreshold: outputRisk <= targetRisk,
    };
  });
}

// ---------------------------------------------------------------------------
// Group by platform + window for drift tracking
// ---------------------------------------------------------------------------

export function groupKey(f: EvalCase): string {
  return `${f.meta.platform}:${f.meta.window}:${f.meta.personaId}`;
}

export interface GroupSummary {
  key: string;
  count: number;
  avgInputRisk: number;
  avgOutputRisk: number;
  avgDelta: number;
  avgDivergence: number;
  passRate: number;
}

export function summarizeByGroup(results: EvalResult[], cases: EvalCase[]): GroupSummary[] {
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const groups = new Map<string, EvalResult[]>();
  for (const r of results) {
    const c = caseMap.get(r.id)!;
    const key = groupKey(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return Array.from(groups.entries()).map(([key, rows]) => ({
    key,
    count: rows.length,
    avgInputRisk: rows.reduce((s, r) => s + r.inputRisk, 0) / rows.length,
    avgOutputRisk: rows.reduce((s, r) => s + r.outputRisk, 0) / rows.length,
    avgDelta: rows.reduce((s, r) => s + r.delta, 0) / rows.length,
    avgDivergence: rows.reduce((s, r) => s + r.divergence, 0) / rows.length,
    passRate: rows.filter((r) => r.passedThreshold).length / rows.length,
  }));
}

// ---------------------------------------------------------------------------
// Calibration table
// ---------------------------------------------------------------------------

export interface CalibrationRow {
  bin: string;
  predicted: number;
  observed: number;
  count: number;
}

/**
 * Compute a calibration table comparing predicted risk scores against
 * observed leak outcomes. `leaked` means the output still contained
 * detectable PII (as determined by the caller's ground-truth labelling).
 */
export function calibrationTable(
  rows: Array<{ riskScore: number; leaked: boolean }>,
  bins = [0, 0.25, 0.5, 0.75, 1]
): CalibrationRow[] {
  const out: CalibrationRow[] = [];
  for (let i = 0; i < bins.length - 1; i++) {
    const lo = bins[i];
    const hi = bins[i + 1];
    const isLastBin = i === bins.length - 2;
    // Last bin is inclusive on both ends so riskScore === 1.0 is captured
    const slice = rows.filter((r) =>
      r.riskScore >= lo && (isLastBin ? r.riskScore <= hi : r.riskScore < hi)
    );
    if (slice.length === 0) continue;
    const predicted = slice.reduce((s, r) => s + r.riskScore, 0) / slice.length;
    const observed = slice.filter((r) => r.leaked).length / slice.length;
    out.push({ bin: `[${lo},${hi}${isLastBin ? ']' : ')'}`, predicted, observed, count: slice.length });
  }
  return out;
}
