// Risk assessment with multi-tier heuristics for PII / quasi-identifier detection.
// Tier 1 = direct identifiers (high weight)
// Tier 2 = quasi-identifiers (medium weight)
// Tier 3 = soft signals (low weight, but amplified when multiple co-occur)
// Combination amplifiers boost the final score when signals cluster.

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskSignal {
  name: string;
  label: string;
  count: number;
}

export interface RiskAssessment {
  score: number;      // 0..1
  level: RiskLevel;
  signals: RiskSignal[];
  confidence: number; // inverse of residual risk: Math.max(0, 1 - score)
}

// ---------------------------------------------------------------------------
// Pattern registry – [id, label, regex, weight, tier]
// Weights are additive; combination logic amplifies when many signals fire.
// ---------------------------------------------------------------------------
type PatternEntry = [string, string, RegExp, number, 1 | 2 | 3];

const PATTERNS: PatternEntry[] = [
  // ── Tier 1 – Direct identifiers ──────────────────────────────────────────
  [
    'email',
    'Email address',
    /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi,
    0.45,
    1,
  ],
  [
    'phone',
    'Phone number',
    /(?:(?:\+|00)\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{4}\b/g,
    0.40,
    1,
  ],
  [
    'ssn',
    'Social Security Number',
    /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    0.55,
    1,
  ],
  [
    'credit-card',
    'Credit card number',
    /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011|65\d{2})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
    0.55,
    1,
  ],
  [
    'iban',
    'Bank account / IBAN',
    /\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){3,7}\d{1,4}\b/g,
    0.50,
    1,
  ],
  [
    'passport',
    'Passport / national ID',
    /\b[A-Z]{1,2}\d{6,9}\b/g,
    0.45,
    1,
  ],
  [
    'ip',
    'IP address',
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    0.20,
    1,
  ],
  [
    'mac-address',
    'MAC address',
    /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g,
    0.25,
    1,
  ],

  // ── Tier 2 – Quasi-identifiers ───────────────────────────────────────────
  [
    'full-name',
    'Full name (honorific + word)',
    /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Rev|Lt|Sgt|Cpl|Capt|Col|Gen|Cmdr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
    0.30,
    2,
  ],
  [
    'street-address',
    'Street address',
    /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Ct|Court|Way|Pl|Place|Ter(?:race)?)\b/gi,
    0.35,
    2,
  ],
  [
    'postcode',
    'Postal / ZIP code',
    /\b(?:\d{5}(?:[-\s]\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/g,
    0.22,
    2,
  ],
  [
    'gps',
    'GPS coordinates',
    /[-\+]?\d{1,3}\.\d{4,},\s*[-\+]?\d{1,3}\.\d{4,}/g,
    0.35,
    2,
  ],
  [
    'date-of-birth',
    'Date of birth',
    /\b(?:born|dob|date\s+of\s+birth|b\.?\s*d\.?|birthday)[:\s]+\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/gi,
    0.35,
    2,
  ],
  [
    'license-plate',
    'License plate',
    /\b[A-Z]{1,3}[\s\-]?\d{1,4}[\s\-]?[A-Z]{0,3}\b/g,
    0.25,
    2,
  ],
  [
    'medical-personal',
    'Medical condition + personal pronoun',
    /\b(?:I|my|me|i'm|I've|I\s+have|diagnosed)\b.{0,60}\b(?:diabetes|cancer|HIV|depression|anxiety|ADHD|bipolar|schizophrenia|epilepsy|asthma|allergy|hypertension|MS|lupus)\b/gi,
    0.30,
    2,
  ],

  // ── Tier 3 – Soft signals ─────────────────────────────────────────────────
  [
    'url-personal',
    'URL with personal path segment',
    /\bhttps?:\/\/(?:[\w\-]+\.)*[\w\-]+(?:\/[\w%\-]+){1,}\b/gi,
    0.12,
    3,
  ],
  [
    'at-mention',
    '@username mention',
    /@[A-Za-z0-9_]{2,30}\b/g,
    0.10,
    3,
  ],
  [
    'age-mention',
    'Age with personal context',
    /\b(?:I\s+am|i'm|aged?|years?\s+old)\s+\d{1,3}\b/gi,
    0.10,
    3,
  ],
  [
    'employer-name',
    'Employer / workplace reference',
    /\b(?:work(?:ing)?\s+at|employed\s+(?:by|at)|my\s+(?:job|company|employer|boss|workplace))\b/gi,
    0.12,
    3,
  ],
  [
    'relative-names',
    'Named relatives',
    /\b(?:my|our)\s+(?:wife|husband|partner|son|daughter|father|mother|sister|brother|friend)\s+[A-Z][a-z]+\b/g,
    0.15,
    3,
  ],
];

// ---------------------------------------------------------------------------

function countMatches(regex: RegExp, text: string): number {
  // Always reset lastIndex before global use
  regex.lastIndex = 0;
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

export function assessRisk(text: string): RiskAssessment {
  if (!text.trim()) {
    return { score: 0, level: 'low', signals: [], confidence: 1 };
  }

  let rawScore = 0;
  const signals: RiskSignal[] = [];
  let tier3Hits = 0;
  let tier1Hits = 0;
  let tier2Hits = 0;

  for (const [id, label, regex, weight, tier] of PATTERNS) {
    const count = countMatches(regex, text);
    if (count > 0) {
      signals.push({ name: id, label, count });
      // Diminishing returns: each extra match of same type adds less
      rawScore += weight * (1 + Math.log(count) * 0.25);
      if (tier === 1) tier1Hits++;
      if (tier === 2) tier2Hits++;
      if (tier === 3) tier3Hits++;
    }
  }

  // Combination amplifiers
  // 1. Name + address together = strong quasi-identity
  const hasName = signals.some((s) => s.name === 'full-name');
  const hasAddress = signals.some((s) => s.name === 'street-address');
  if (hasName && hasAddress) rawScore += 0.20;

  // 2. Name + date-of-birth = near-unique identifier
  const hasDob = signals.some((s) => s.name === 'date-of-birth');
  if (hasName && hasDob) rawScore += 0.25;

  // 3. Three or more soft signals co-occurring: amplify
  if (tier3Hits >= 3) rawScore *= 1.25;

  // 4. Any tier-1 + tier-2 mix: additional bump (identity linkage risk)
  if (tier1Hits >= 1 && tier2Hits >= 1) rawScore += 0.15;

  const score = Math.min(1, rawScore);
  const level: RiskLevel =
    score >= 0.75 ? 'critical' :
    score >= 0.50 ? 'high' :
    score >= 0.25 ? 'medium' :
    'low';

  return { score, level, signals, confidence: Math.max(0, 1 - score) };
}

// ---------------------------------------------------------------------------
// Abstain decision – block output when residual risk is unacceptably high
// ---------------------------------------------------------------------------

export interface AbstainDecision {
  abstain: boolean;
  reason?: string;
}

const ABSTAIN_RISK_THRESHOLD = 0.7;
const ABSTAIN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Returns { abstain: true } when the risk score is critically high AND
 * confidence is too low to trust the output.  Callers should suppress output
 * and show the reason string to the user instead.
 */
export function shouldAbstain(riskScore: number, confidence: number): AbstainDecision {
  if (riskScore >= ABSTAIN_RISK_THRESHOLD && confidence < ABSTAIN_CONFIDENCE_THRESHOLD) {
    return { abstain: true, reason: 'High residual deanonymization risk' };
  }
  return { abstain: false };
}
