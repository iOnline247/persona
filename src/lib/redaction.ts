// Redaction pass – replaces direct identifiers with stable placeholder tokens
// before text reaches the LLM, reducing leakage risk.
// The in-memory replacements map is returned so callers can optionally restore
// original values if needed (though for privacy purposes they typically won't).

export interface RedactionResult {
  redactedText: string;
  replacements: Record<string, string>;
  count: number;
}

type RedactionRule = [string, RegExp];

// Order matters: more specific patterns first to avoid partial matches
const RULES: RedactionRule[] = [
  ['CREDITCARD', /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011|65\d{2})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g],
  ['SSN',        /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g],
  ['IBAN',       /\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){3,7}\d{1,4}\b/g],
  ['PASSPORT',   /\b[A-Z]{1,2}\d{6,9}\b/g],
  ['EMAIL',      /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi],
  ['PHONE',      /(?:(?:\+|00)\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{4}\b/g],
  ['GPS',        /[-+]?\d{1,3}\.\d{4,},\s*[-+]?\d{1,3}\.\d{4,}/g],
  ['IP',         /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ['MAC',        /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g],
  ['URL',        /\bhttps?:\/\/\S+\b/gi],
];

export function redactSensitive(text: string): RedactionResult {
  const replacements: Record<string, string> = {};
  let counter = 0;

  let redactedText = text;

  for (const [prefix, regex] of RULES) {
    regex.lastIndex = 0;
    redactedText = redactedText.replace(regex, (match) => {
      counter++;
      const token = `[${prefix}_${counter}]`;
      replacements[token] = match;
      return token;
    });
  }

  return { redactedText, replacements, count: counter };
}

// Restore placeholders back to original values (for display/debug purposes only)
export function restoreRedactions(text: string, replacements: Record<string, string>): string {
  let restored = text;
  for (const [token, original] of Object.entries(replacements)) {
    restored = restored.replaceAll(token, original);
  }
  return restored;
}
