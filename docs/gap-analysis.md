# Gap Analysis: Persona Extension vs. 2602.16800v2 Threat Model

## Scope
This document compares the extension claim in manifest metadata with techniques and threat assumptions from Large-scale online deanonymization with LLMs (arXiv:2602.16800v2).

## Stated Goal (Manifest)
Protect your identity by rewriting text with AI-powered personas to combat large-scale deanonymization attacks.

## Paper Threat Lens (What defenses must address)
The paper’s strongest deanonymization framing is a staged ESRC pipeline:
- Extract identity-relevant micro-data from unstructured text
- Search candidate identities via embeddings
- Reason over top candidates to verify matches
- Calibrate confidence to control precision and false positives

It also shows high-precision linking remains feasible at scale and across temporal/cross-platform settings.

## Current Implementation Snapshot
The current extension provides:
- Persona-based style rewriting with a local model
- Single-pass conversion flow
- Random persona option
- Website persona mapping
- Draft storage and usage stats

The current extension does not provide:
- Identity-risk detector or redaction pipeline
- Adversarial evaluation against deanonymization-style attacks
- Confidence calibration loop or abstain decisioning
- Quantitative privacy efficacy metrics

## Executive Verdict
- There is a meaningful mismatch between claim strength and implemented defenses.
- Current functionality is best characterized as stylistic obfuscation assistance.
- Under the paper’s threat model, claim substantiation is low without measurement and calibrated controls.
- Main user risk is false confidence, not zero utility.

## Goal-vs-Implementation Gaps
| Manifest claim intent | Capability implied by paper threat model | Current state in repo | Severity |
|---|---|---|---|
| Protect identity | Quantified re-identification risk reduction | No risk metric or benchmark harness | High |
| Combat large-scale attacks | Scalable attacker simulation and precision/recall calibration | No ESRC-style eval pipeline | High |
| Persona rewrite as mitigation | Suppress both style and semantic micro-data leakage | Style rewrite only, no semantic-risk suppression | High |
| Safe rewriting workflow | Pre-output identifier detection/redaction | No dedicated detector/redaction stage | High |
| Reliable user guidance | Calibrated confidence and abstain behaviors | No confidence score or abstain logic | High |
| Robustness across settings | Cross-platform and temporal drift testing | No such evaluation framing | Medium-High |
| Privacy-preserving storage posture | Minimized retention and clear retention controls | Drafts and originals retained locally by design | Medium |
| Transparent trust boundary | Qualified, non-absolute claim language | Current wording implies strong protection | High |

## Prioritized Remediation
1. Add pre-rewrite risk detector and redaction pipeline.
2. Add risk thresholding with abstain behavior in unsafe cases.
3. Add iterative rewrite-until-threshold flow with max rounds.
4. Add user-visible risk/confidence indicators and warning copy.
5. Add offline evaluation harness with before/after risk outputs.
6. Add calibration reporting (predicted vs observed leakage behavior).
7. Harden storage defaults (TTL purge, minimize source retention).
8. Reword manifest/README claims to avoid guarantee semantics.
9. Add cross-platform and temporal evaluation metadata.

## Recommended Claim Language
Suggested replacement sentence:
Rewrites text in different personas locally to vary writing style; this may reduce some stylistic linkability, but it does not guarantee protection against large-scale deanonymization.

## Success Criteria for Future Claim Upgrade
The stronger claim should only be reintroduced after:
- reproducible benchmark evidence,
- calibrated risk/confidence behavior,
- low false-confidence UX,
- and documented limits under temporal and cross-platform conditions.
