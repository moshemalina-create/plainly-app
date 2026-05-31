# Plainly

A single-page React app (`index.html`, JSX transformed in the browser by
Babel-standalone) for NY parents navigating special education due
process. Deploys from this repo to Netlify; one serverless function
(`netlify/functions/claude.js`) proxies the Anthropic API.

## Architecture: the chat is the product

The `#/start` route renders `ChatTool` — a single conversational guide
that helps a parent understand their situation, make sense of their
documents, push back on school decisions, and prepare for meetings.
Documents are uploaded **into the chat** (the attach button in the
composer): the PDF text is extracted in the browser and folded into the
chat's system prompt (`formatDocsForPrompt` → `UPLOADED DOCUMENTS`
section in `processCall`). There is no automatic structured assessment
of an upload in this flow — the chat references documents
conversationally and only produces written assessments/letters when the
parent explicitly asks.

The chat's system prompt is `CHAT_ADVOCATE_PROMPT`. It was deliberately
written long (advocate role, tone, document behavior, wait-checks,
output library, attorney/uncertainty calibration) — voice was prioritized
over brevity. **Revisit prompt length after some real usage**: if cost or
latency becomes a concern, tighten it then, with behavior to measure
against rather than trimming blind now.

### Preserved: the quick-assessment pipeline (NOT dead code)

Three things are preserved here, all reserved for the same future entry
point:

1. **The IEP extraction/flagging pipeline** — `IEP_EXTRACT_PROMPT`,
   `IEP_FLAG_PROMPT`, the `IEPSection` component, and the `processIEP` /
   `submitIepAnswers` / `clearIEP` handlers — a one-shot **structured IEP
   assessment** (Stage A extract → Stage B flag → the "What I'd look at"
   panel). Disconnected from the chat flow as of `chat-as-primary`.
2. **The triage verdict** — `TRIAGE_PROMPT` and the `TriageSection`
   component (the "What we're seeing / Yes — this is worth filing"
   panel). Its chat-flow auto-run effect and mount were removed in
   `clean-output-handoff` because the chat now does claim recognition
   conversationally; an unsolicited structured verdict is the same
   pattern we removed from the upload flow.

All of the above are kept intact behind banner comments in `index.html`,
reserved for a planned **second landing-page entry point** ("Want a quick
IEP assessment?"): a transactional flow where the parent describes the
situation, uploads documents, receives the structured assessment +
triage verdict in one shot, and is then offered the chat for follow-up.
That future flow reuses this code and will run triage and mount
`TriageSection` itself.

**Do not delete or refactor these as unused.** They are unreferenced by
design, awaiting re-wiring to the new entry point. (The PDF helpers
`extractPdfText` / `pdfQualityBlocker` are *shared* with the live chat
attach flow, so those are not preserved-only. `triageResult` /
`triageLoading` state is also kept — the preserved `processIEP` reads it.)

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
