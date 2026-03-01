## 1) Risk detector missing

**Gap**  
No pre-rewrite risk scoring exists for direct identifiers or quasi-identifiers.

**Why it matters**  
Without a detector, the extension rewrites sensitive content blindly and cannot gate high-risk inputs.

**Code example**
```ts
// src/lib/risk.ts
export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskAssessment {
  score: number; // 0..1
  level: RiskLevel;
  signals: string[];
}

const PATTERNS: Array<[string, RegExp, number]> = [
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 0.35],
  ['phone', /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g, 0.25],
  ['ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 0.2],
  ['url', /\bhttps?:\/\/\S+\b/gi, 0.15],
];

export function assessRisk(text: string): RiskAssessment {
  let score = 0;
  const signals: string[] = [];
  for (const [name, regex, weight] of PATTERNS) {
    if (regex.test(text)) {
      signals.push(name);
      score += weight;
    }
  }
  score = Math.min(1, score);
  const level: RiskLevel = score >= 0.7 ? 'high' : score >= 0.35 ? 'medium' : 'low';
  return { score, level, signals };
}
```

**Acceptance criteria**
- `assessRisk()` returns deterministic `score`, `level`, and `signals`.
- Known PII-like inputs are classified at least `medium`.
- Empty/benign text returns `low` risk.

---

## 2) Redaction pass missing

**Gap**  
No sanitization/redaction occurs before model input.

**Why it matters**  
Raw identifiers can leak into model context and survive rewriting.

**Code example**
```ts
// src/lib/redaction.ts
export interface RedactionResult {
  redactedText: string;
  replacements: Record<string, string>;
}

export function redactSensitive(text: string): RedactionResult {
  const replacements: Record<string, string> = {};
  let i = 0;

  const swap = (value: string, prefix: string) => {
    const token = `[${prefix}_${++i}]`;
    replacements[token] = value;
    return token;
  };

  const redactedText = text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (m) => swap(m, 'EMAIL'))
    .replace(/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g, (m) => swap(m, 'PHONE'))
    .replace(/\bhttps?:\/\/\S+\b/gi, (m) => swap(m, 'URL'));

  return { redactedText, replacements };
}
```

**Acceptance criteria**
- Model sees `redactedText` rather than original text.
- Replacement tokens are stable per request and non-reversible without in-memory map.
- Unit inputs with email/phone/URL produce placeholder tokens.

---

## 3) Iterative rewrite-until-threshold loop missing

**Gap**  
Only one rewrite pass is attempted.

**Why it matters**  
A single pass may leave residual identifier patterns and style fingerprints.

**Code example**
```ts
// src/lib/risk.ts (or src/lib/evaluator.ts)
import { assessRisk } from './risk.js';
import { redactSensitive } from './redaction.js';

export async function rewriteUntilSafe(
  inputText: string,
  systemPrompt: string,
  rewrite: (text: string, prompt: string) => Promise<string>,
  maxRounds = 3,
  targetRisk = 0.3
): Promise<{ output: string; rounds: number; finalRisk: number }> {
  const { redactedText } = redactSensitive(inputText);
  let current = redactedText;

  for (let round = 1; round <= maxRounds; round++) {
    current = await rewrite(current, systemPrompt);
    const risk = assessRisk(current).score;
    if (risk <= targetRisk) return { output: current, rounds: round, finalRisk: risk };
  }

  return { output: current, rounds: maxRounds, finalRisk: assessRisk(current).score };
}
```

**Acceptance criteria**
- Loop stops early when risk threshold is met.
- Maximum rounds are enforced.
- Returned metadata includes `rounds` and `finalRisk`.

---

## 4) User risk/confidence signal missing

**Gap**  
UI does not expose risk estimate or confidence to users.

**Why it matters**  
Users cannot judge whether output is safe enough to share.

**Code example**
```svelte
<!-- src/popup/App.svelte -->
<script lang="ts">
  import { assessRisk } from '../lib/risk.js';
  let lastRisk = $state(0);
  let confidence = $derived(Math.max(0, 1 - lastRisk));

  async function handleConvert() {
    // existing conversion flow...
    outputText = await rewriteText(inputText, persona.systemPrompt);
    lastRisk = assessRisk(outputText).score;
  }
</script>

<div class="risk-banner">
  <span>Risk: {(lastRisk * 100).toFixed(0)}%</span>
  <span>Confidence: {(confidence * 100).toFixed(0)}%</span>
</div>
```

**Acceptance criteria**
- Risk/confidence are visible after each conversion.
- Signal updates on new output.
- Signal values are bounded to 0–100%.

---

## 5) Abstain logic missing

**Gap**  
The app always returns output, even when safety confidence is poor.

**Why it matters**  
For high-risk/low-confidence cases, abstention is safer than misleading output.

**Code example**
```ts
// src/lib/risk.ts
export interface AbstainDecision {
  abstain: boolean;
  reason?: string;
}

export function shouldAbstain(riskScore: number, confidence: number): AbstainDecision {
  if (riskScore >= 0.7 && confidence < 0.5) {
    return { abstain: true, reason: 'High residual deanonymization risk' };
  }
  return { abstain: false };
}
```

```svelte
<!-- src/popup/App.svelte -->
<script lang="ts">
  import { shouldAbstain } from '../lib/risk.js';
  let abstainReason = $state<string | null>(null);

  // after computing risk/confidence
  const decision = shouldAbstain(lastRisk, confidence);
  if (decision.abstain) {
    outputText = '';
    abstainReason = decision.reason ?? 'Unsafe to provide rewrite';
  }
</script>

{#if abstainReason}
  <div class="warning">{abstainReason}. Please remove more personal details and retry.</div>
{/if}
```

**Acceptance criteria**
- High-risk, low-confidence outputs are blocked.
- User receives a clear abstain reason.
- Non-abstain cases continue normally.

---

## 6) Evaluation harness missing

**Gap**  
No repeatable script exists to evaluate anonymization quality over fixtures.

**Why it matters**  
Without a harness, claims are anecdotal and regressions go undetected.

**Code example**
```ts
// src/lib/evaluator.ts
import { assessRisk } from './risk.js';

export interface EvalCase { id: string; input: string; output: string; }
export interface EvalResult { id: string; inputRisk: number; outputRisk: number; delta: number; }

export function evaluateCases(cases: EvalCase[]): EvalResult[] {
  return cases.map((c) => {
    const inputRisk = assessRisk(c.input).score;
    const outputRisk = assessRisk(c.output).score;
    return { id: c.id, inputRisk, outputRisk, delta: inputRisk - outputRisk };
  });
}
```

```ts
// scripts/eval.ts
import fs from 'node:fs/promises';
import { evaluateCases } from '../src/lib/evaluator.js';

const raw = await fs.readFile('./examples/eval-fixtures.json', 'utf8');
const cases = JSON.parse(raw);
const results = evaluateCases(cases);
await fs.writeFile('./examples/eval-results.json', JSON.stringify(results, null, 2));
console.log(`Evaluated ${results.length} cases`);
```

**Acceptance criteria**
- Running eval script produces a machine-readable results artifact.
- Results include per-case before/after risk.
- Harness runs without popup/UI interaction.

---

## 7) Calibrated metrics missing

**Gap**  
Current stats track usage volume, not calibration or reliability.

**Why it matters**  
A risk score is only useful if observed outcomes align with predicted risk.

**Code example**
```ts
// src/lib/evaluator.ts
export interface CalibrationRow { bin: string; predicted: number; observed: number; count: number; }

export function calibrationTable(
  rows: Array<{ riskScore: number; leaked: boolean }>,
  bins = [0, 0.25, 0.5, 0.75, 1]
): CalibrationRow[] {
  const out: CalibrationRow[] = [];
  for (let i = 0; i < bins.length - 1; i++) {
    const lo = bins[i], hi = bins[i + 1];
    const slice = rows.filter((r) => r.riskScore >= lo && r.riskScore < hi);
    if (slice.length === 0) continue;
    const predicted = slice.reduce((s, r) => s + r.riskScore, 0) / slice.length;
    const observed = slice.filter((r) => r.leaked).length / slice.length;
    out.push({ bin: `[${lo},${hi})`, predicted, observed, count: slice.length });
  }
  return out;
}
```

**Acceptance criteria**
- Evaluation output includes calibration rows by score bucket.
- Team can compute and track calibration drift over time.
- Metrics are separate from user-facing usage counts.

---

## 8) Draft retention risk

**Gap**  
Drafts store full original and rewritten text indefinitely up to count limit.

**Why it matters**  
Sensitive text accumulation in `chrome.storage.local` increases breach and forensic risk.

**Code example**
```ts
// src/lib/storage.ts (extensions)
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function purgeExpiredDrafts(): Promise<void> {
  const data = await getStorage();
  const now = Date.now();
  data.drafts = data.drafts.filter((d) => now - d.timestamp <= DRAFT_TTL_MS);
  await setStorage({ drafts: data.drafts });
}

export async function saveDraftMinimized(draft: Omit<Draft, 'id' | 'timestamp' | 'originalText'>): Promise<Draft> {
  const scrubbed: Draft = {
    ...draft,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    originalText: '', // never persist raw source by default
  };
  const data = await getStorage();
  data.drafts = [scrubbed, ...data.drafts].slice(0, MAX_DRAFTS);
  await setStorage({ drafts: data.drafts });
  return scrubbed;
}
```

**Acceptance criteria**
- Drafts expire automatically by TTL.
- Raw original input is not persisted by default.
- Existing expired drafts are deleted on startup/load.

---

## 9) Weak claim language

**Gap**  
Project messaging can imply guaranteed deanonymization prevention.

**Why it matters**  
Overstated guarantees create legal/compliance risk and unsafe user trust.

**Code example**
```md
<!-- README.md (replace claims section) -->
## Privacy and safety scope

Persona provides heuristic style transformation and basic identifier redaction.
It does **not** guarantee anonymity or resistance against all authorship/deanonymization methods.
Use it as a privacy-assistance layer, not as a sole protection mechanism for high-risk use cases.
```

**Acceptance criteria**
- README avoids absolute claims like “prevents deanonymization.”
- Scope and limitations are explicit and user-visible.
- UI/help text matches the same qualified language.

---

## 10) No cross-platform/temporal test framing

**Gap**  
No test framing across operating contexts, dates, and prompt drift windows.

**Why it matters**  
Privacy performance can vary by platform, model/runtime changes, and time.

**Code example**
```ts
// scripts/eval.ts (framing extension)
type EvalMeta = { platform: 'win' | 'mac' | 'linux'; window: '2026-Q1' | '2026-Q2'; personaId: string };

interface EvalFixture {
  id: string;
  input: string;
  output: string;
  meta: EvalMeta;
}

// group metrics by platform + window for drift checks
function groupKey(f: EvalFixture) {
  return `${f.meta.platform}:${f.meta.window}:${f.meta.personaId}`;
}
```

**Acceptance criteria**
- Eval fixtures include `platform` and `window` metadata.
- Report breaks down risk deltas by platform and time window.
- Re-running later cohorts can detect temporal drift.

---

## Suggested implementation order

- **MVP:** 1 (risk detector), 2 (redaction pass), 5 (abstain logic), 4 (risk/confidence UI), 8 (draft retention hardening)  
- **Next:** 3 (iterative rewrite loop), 6 (evaluation harness), 7 (calibration metrics)  
- **Later:** 10 (cross-platform/temporal framing), 9 (claim-language + policy refinements across docs/UI)
