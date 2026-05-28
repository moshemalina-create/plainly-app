# Plainly

A single-page React app (`index.html`, JSX transformed in the browser by
Babel-standalone) for NY parents navigating special education due
process. Deploys from this repo to Netlify; one serverless function
(`netlify/functions/claude.js`) proxies the Anthropic API.

## Future / planned features

**Expand document uploads beyond IEPs.** The PDF upload flow currently
targets IEPs specifically — Stage A extracts an IEP-shaped schema,
Stage B flags claim categories against that schema. Preview testing on
`fix-pdf-reliability` showed the flow already handles non-IEP PDFs
gracefully (the quality detection doesn't false-positive on them, and
the model produces a reasonable best-effort read), so the natural next
step is first-class support for the other documents parents typically
have on hand:

- **Evaluations** — speech/language, neuropsychological, educational
  (psychoeducational), OT/PT, FBA. Each has its own structured shape
  worth extracting (assessor, date, standardized scores, narrative
  findings, recommendations).
- **Progress reports** — quarterly or trimester reports showing actual
  progress against IEP goals. Key for surfacing "same goal recycled
  with no progress" patterns.
- **Prior written notices (PWNs)** — the district's formal
  explanations of accepted/rejected parent requests. Central to
  procedural-violation claims.

The high-leverage piece is **cross-referencing eval findings against
the IEP**: e.g., a neuropsych recommends structured literacy
intervention 5x/week and the IEP provides 1x/week SETSS group → that's
a concrete inappropriate-program flag with documentary support, no
parent question needed. Same shape for PWNs that contradict claimed
parent agreement, or progress reports that contradict the IEP's
"making expected progress" language.

Implementation sketch when picked up: per-document-type extraction
prompts, a unified evidence store keyed by document type, and a
comparison stage that runs once at least one IEP plus at least one
other document is present.
