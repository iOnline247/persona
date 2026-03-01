#!/usr/bin/env node
// Offline evaluation script – runs without popup/UI.
// Usage: node --experimental-strip-types scripts/eval.ts
//
// Reads examples/eval-fixtures.json, runs risk assessment on each case,
// outputs per-case results and group summaries to examples/eval-results.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Inline the evaluator logic to avoid TS module resolution issues in script context
// (avoids needing tsx / ts-node for a zero-dependency run)
type Platform = 'win' | 'mac' | 'linux';
type EvalWindow = string;

interface EvalMeta { platform: Platform; window: EvalWindow; personaId: string; }
interface EvalCase { id: string; input: string; output: string; meta: EvalMeta; }

function charBigrams(text: string): Set<string> {
  const n = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const s = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) s.add(n.slice(i, i + 2));
  return s;
}

function computeDivergence(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const ba = charBigrams(a), bb = charBigrams(b);
  let intersect = 0;
  for (const bg of ba) { if (bb.has(bg)) intersect++; }
  const union = ba.size + bb.size - intersect;
  return union === 0 ? 0 : 1 - intersect / union;
}

// Minimal risk scorer – matches Tier 1 and most Tier 2 patterns from
// src/lib/risk.ts. Combination amplifiers (name+address, tier mixing, etc.)
// are NOT applied here; scores therefore represent a conservative lower bound
// compared to the production assessRisk() output.
// TODO: when a Node-compatible compiled output of src/lib/ is available,
// replace this with a direct import of assessRisk().
function quickRiskScore(text: string): number {
  if (!text.trim()) return 0;
  const patterns: [RegExp, number][] = [
    // Tier 1 – direct identifiers
    [/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi, 0.45],
    [/(?:(?:\+|00)\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{4}\b/g, 0.40],
    [/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, 0.55],
    [/\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011|65\d{2})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, 0.55],
    [/\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){3,7}\d{1,4}\b/g, 0.50],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 0.20],
    [/\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g, 0.25],
    // Tier 2 – quasi-identifiers
    [/\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Rev)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g, 0.30],
    [/\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:St|Ave|Rd|Blvd|Dr|Ln|Ct|Way|Pl)\b/gi, 0.35],
    [/\b(?:\d{5}(?:[-\s]\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/g, 0.22],
    [/[-+]?\d{1,3}\.\d{4,},\s*[-+]?\d{1,3}\.\d{4,}/g, 0.35],
    // Tier 3 – soft signals
    [/\bhttps?:\/\/\S+\b/gi, 0.12],
    [/@[A-Za-z0-9_]{2,30}\b/g, 0.10],
  ];
  let score = 0;
  for (const [re, w] of patterns) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) score += w * (1 + Math.log(m.length) * 0.25);
  }
  return Math.min(1, score);
}

async function main() {
  const fixturesPath = path.join(root, 'examples', 'eval-fixtures.json');
  const raw = await fs.readFile(fixturesPath, 'utf8');
  const cases: EvalCase[] = JSON.parse(raw);

  const TARGET_RISK = 0.30;

  const results = cases.map((c) => {
    const inputRisk = quickRiskScore(c.input);
    const outputRisk = c.output ? quickRiskScore(c.output) : null;
    const divergence = c.output ? computeDivergence(c.input, c.output) : null;
    return {
      id: c.id,
      platform: c.meta.platform,
      window: c.meta.window,
      personaId: c.meta.personaId,
      inputRisk: +inputRisk.toFixed(4),
      outputRisk: outputRisk !== null ? +outputRisk.toFixed(4) : null,
      delta: outputRisk !== null ? +(inputRisk - outputRisk).toFixed(4) : null,
      divergence: divergence !== null ? +divergence.toFixed(4) : null,
      passedThreshold: outputRisk !== null ? outputRisk <= TARGET_RISK : null,
    };
  });

  // Group summaries
  type Key = string;
  const groups = new Map<Key, typeof results>();
  for (const r of results) {
    const key = `${r.platform}:${r.window}:${r.personaId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const summaries = Array.from(groups.entries()).map(([key, rows]) => {
    const withOutput = rows.filter((r) => r.outputRisk !== null);
    return {
      key,
      count: rows.length,
      avgInputRisk: +(rows.reduce((s, r) => s + r.inputRisk, 0) / rows.length).toFixed(4),
      avgOutputRisk: withOutput.length
        ? +(withOutput.reduce((s, r) => s + (r.outputRisk ?? 0), 0) / withOutput.length).toFixed(4)
        : null,
      passRate: withOutput.length
        ? +(withOutput.filter((r) => r.passedThreshold).length / withOutput.length).toFixed(4)
        : null,
    };
  });

  const output = { meta: { targetRisk: TARGET_RISK, evaluatedAt: new Date().toISOString() }, results, summaries };
  const outPath = path.join(root, 'examples', 'eval-results.json');
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`✓ Evaluated ${results.length} cases → examples/eval-results.json`);
  console.log(`  Groups: ${summaries.length}`);
  for (const s of summaries) {
    console.log(`  ${s.key}: avgInputRisk=${s.avgInputRisk}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
