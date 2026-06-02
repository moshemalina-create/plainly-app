# Plainly — Accounts & Persistence: Architecture Scoping

**Status:** Scoping / pre-build. Not yet implemented.
**Purpose:** Define the architecture for optional user accounts that persist a parent's case across sessions. This document is the source of truth for the design; it should be read alongside `CLAUDE.md` before any implementation begins.
**Audience:** Claude Code (implementation) and Moshe (product owner).

---

## 1. What this adds, and why it's a threshold

Today Plainly is **stateless**: a parent's data lives only in the browser tab and disappears when the tab closes. There is no login, no server-side storage, no database.

This change adds **optional accounts** so a parent can preserve their case — documents Plainly generated, a record of what was reviewed, and enough context for a future chat to pick up where the last one left off.

**This is a real threshold.** The moment accounts exist, Plainly stores sensitive information about children (special-education disputes, disability-related context, case details) on a server. The architecture must be built with that fact shaping it from line one — see Section 7, which is a design *input*, not an afterthought.

**Non-negotiable principle: accounts are optional.** Anonymous, one-time use stays fully first-class. No login wall, no nag. A parent can use Plainly once and walk away with no trace, exactly as today.

---

## 2. Two scenarios this serves

1. **Pre-filing, multi-session.** A parent starts a conversation, then leaves to chase down a document or think, then returns — possibly several times — before deciding whether to file a complaint. Each return should resume with the prior context intact.

2. **Post-filing.** After filing, the parent receives material back from the district and has questions. Same need: resume with context.

**Architecturally these are identical.** There is no mode switch, no state machine distinguishing "pre-filing" from "post-filing" behavior. It is one experience: a knowledgeable advocate that loads the case context and engages with whatever the parent brings. Any difference in how post-filing situations are handled is a *prompt/content* matter to be layered on later — not a structural one. (Procedural guidance about the actual due-process timeline — resolution period, hearing officer, pre-hearing conference, hearing — is being handled separately via short explainer videos, not built into the tool as tracked state.)

---

## 3. Data model

One user maps to **one case** (one child, one dispute). A parent with a second child creates a separate account. (Future: multi-case per user is a known, bounded refactor — pull case fields into their own table — logged as a deferred item, not built now.)

Because it is one-to-one, the case fields fold directly into the user record. The model has three layers:

### USER / CASE (one record)

The persistent spine. Combines account identity with the case state.

- **Auth identity** — email + auth credentials. Handled by the auth layer; **we never store passwords ourselves.**
- **`intake`** (existing, from the canonical-intake work) — structured substantive fields, persisted: `remedy_sought`, `prior_written_detail`, `pendency_assertion`, `pendency_details`, `key_dates { most_recent_cse_date, ten_day_notice_date_sent }`. This is already built in-session; persistence stores it.
- **`formalFields`** (existing) — identity fields: parent name, child name, DOB, address, email, phone.
- **`recap`** — *short, parent-facing.* One or two sentences: "what's been done most recently," in plain prose. Powers the account-page headline and the chat's opening line. Honest and descriptive, never prescriptive (it reports what happened in conversation; it does not assert real-world procedural status it cannot verify). Example: "You used Plainly to prepare a due-process complaint." Generated from the session.
- **`context_payload`** — *detailed, chat-facing.* The fuller briefing injected into a returning chat so a fresh Claude can engage intelligently. Contains **both** the structured object **and** a prose narrative. Critical: the structured layer is the stored `intake` + `formalFields`, reused **VERBATIM** — never re-derived from the transcript. Only the prose narrative is generated. Re-deriving structured facts (dates, service amounts, remedy) from a transcript invites drift/hallucination, and because the chat reads the payload rather than the ground-truth transcript, any drift becomes a wrongly-"remembered" fact that compounds across sessions — directly undermining the Section 5 honesty posture. Reusing the already-validated `intake` keeps the precise facts un-reinvented. Not shown to the parent as prose. Generated from the session(s), incrementally (see Section 5). **Implementation refinement (Step 2):** taking the "structured layer = live intake" principle to its conclusion, only the **prose narrative** is *stored* (as a `context_narrative` column); `context_payload` is *assembled at read time* as live `intake` + stored `context_narrative`. There is no separate stored copy of the structured facts to drift from.
- **`parent_notes`** — free-text the parent authors themselves in a box on the account page. Stored verbatim, injected into chat context so the chat can access it.
- **timestamps** — `created`, `last_session`, `last_updated`.

### SESSION (many per user)

One chat engagement.

- **transcript** — the full raw conversation. Ground truth. **Not injected wholesale** into future chats (too long/noisy); it is the recovery/audit layer and the source from which `recap` and `context_payload` are regenerated.
- **timestamp**
- **auto-label** — a one-line description ("Discussed evaluation timeline," "Drafted complaint").

### ARTIFACTS (hang off the user/case)

- **`generated_docs[]`** — documents Plainly produced (complaint, letters), stored as **actual files**. Each: `{ doc_type, created_date, file_reference, source_session }`. These are kept (low sensitivity — the parent's own outgoing advocacy; high utility — they re-download/reference them).
- **`docs_reviewed[]`** — a lightweight ledger of documents the parent uploaded. Each: `{ filename, date_reviewed, doc_type, headline_extraction }`. **The raw uploaded original is NOT stored** — see Section 7. `headline_extraction` is deliberately shallow (see Section 7 for the floor/ceiling): document type, date conducted, source/evaluator if relevant, and a short high-level findings summary at the level of "deficiencies in reading, writing, speech" — explicitly **NOT** exact service minutes, goal-by-goal language, classification codes, or verbatim quotes. The headline lets the chat recognize the document and speak to its gist; when a task needs specifics the headline can't supply, the chat asks the parent to re-upload (see Section 5).

### The three-layer derivation (important)

```
recap            → short, parent-facing headline      ("last time, you…")
context_payload  → detailed, chat-facing briefing      (structured + prose)
transcripts[]    → raw ground truth                    (stored, not injected)
```

Parent reads the recap; the chat reads the context_payload; both are derived from the transcripts. Each layer is generated/maintained from the layer below it.

---

## 4. User flows

### Landing page

- **Start** — primary, central call-to-action. Anonymous use. **Unchanged.**
- **Login** — small, top-right. For returning users.
- Account creation is reachable both from the Login area and from the in-chat "save this" affordance (below).

### Flow 1 — Anonymous use (unchanged)

Start → chat → upload docs → get output → close tab → gone. Exactly as today. The only addition: an unobtrusive **"Save this case / Create an account to keep this"** affordance that appears *only once there's something worth saving* (after first doc upload or first generated output — never on message one). It is an offer, never a gate.

### Flow 2 — Anonymous → save (the upgrade path)

The parent is mid-session and decides to save.

1. Parent clicks "Save this case."
2. Lightweight account creation (email + password, or **magic link** — lower friction for non-technical parents; preferred if the auth layer supports it).
3. On success, the **current in-browser state** (`intake`, transcript so far, docs-reviewed entries, generated docs) **writes into the new account.**
4. The chat continues uninterrupted — same conversation, now persisted. Small confirmation: "Saved — you can come back anytime by logging in."

**Design requirement this imposes backward:** the anonymous session must already hold its state in the *same shape* a logged-in session uses, so "save" is a copy-up, not a translation. The canonical-intake work already maintains `intake` in-session, so this is mostly plumbing.

### Flow 3 — Returning user (the core of both scenarios)

1. Parent clicks Login → authenticates.
2. Lands on the **account page** (not straight into a chat — case overview first, then they choose to continue).
3. Clicks **Continue** → opens a **fresh chat** (see Section 5) with `context_payload` + `parent_notes` + `docs_reviewed` summaries injected.

### Account page layout (top to bottom)

- **Recap line** — the short parent-facing headline + last-visit date. First thing they read.
- **Continue conversation** — primary action.
- **Docs Reviewed** — the ledger list (filename, date, type). Read-only.
- **Documents** — generated files (complaint, letters). Downloadable / re-viewable.
- **My Notes** — the editable free-text box → saves to `parent_notes` → injected into next chat.
- **Account / logout**, and (v1.1) **delete my data** — required for the privacy posture; see Section 7.

### The return loop

Continue → new SESSION → conversation → at session end: `recap` + `context_payload` regenerate, transcript stored, new reviewed/generated docs logged → parent leaves → next login reflects the update. Each loop rolls into the same one-user-one-case record. This single loop serves both scenarios; the parent just brings different material.

---

## 5. The return-chat experience (spec)

When a returning parent clicks Continue:

- It is a **fresh chat** (clean conversational surface), not a continued visible transcript. Rationale: simpler, matches the existing re-prompt design, and avoids carrying an ever-growing transcript. Prior conversations are preserved in `transcripts[]` and the chat *knows* their substance via the injected `context_payload`. (A "past conversations" view is a possible later addition; not v1.)
- `context_payload` + `parent_notes` + `docs_reviewed` summaries are injected **silently** (the facts and history).
- The chat **opens with a short re-orientation line**, generated from `recap` (not the full payload — keep it brief), that:
  - states what was done, confidently, based on conversation history;
  - is **honest about what it does not know** — it tracks what was *said*, not what the parent *did* between sessions, and must not presume real-world actions it didn't witness;
  - signals that context carried over;
  - **invites the parent to update** ("let me know how I can help — or if anything's changed since we last talked").

Example tone:
> "You've used Plainly to prepare a due-process complaint. I don't know whether you've filed it yet — but I have the context from our earlier conversations. Let me know how I can help, or if anything's changed since we last talked."

**Why the honesty matters:** this is the same posture the tool holds throughout — it reflects the conversation accurately and stays agnostic about procedural states it can't verify. "Here's what we did; tell me where things stand now" is both more accurate and more in keeping with what Plainly is (someone to call to understand what's going on), than "Welcome back to your filed case."

**Thin-history fallback:** if the prior session never got far enough to produce a meaningful recap (e.g., account created early, barely any conversation), the opening line must degrade gracefully and not reference a milestone that didn't happen — e.g., "Welcome back — we'd started talking through your situation; where would you like to pick up?"

**Conditional document re-upload:** because only a shallow headline of each uploaded document is stored (Section 7), the chat always knows a document existed and its gist, but does not hold the load-bearing specifics. The re-upload ask must be conditional on the task actually needing detail the headline can't supply (e.g., drafting a complaint, or a question requiring exact service levels) — **NOT** fired preemptively on every return. A returning parent who just wants to talk through next steps should not be nagged. When specifics are needed, the chat recalls the headline, states the privacy reason, and asks for the re-upload — a line that doubles as a trust signal. Example tone:
> "While we previously reviewed the IEP conducted on [date], which showed deficiencies in reading, writing, and speech, Plainly doesn't retain the original document on its servers between sessions to protect your and your child's privacy. Could you upload it again here, and I'll have what I need to [draft the complaint / answer that precisely]?"

**Summary-update trigger:** `recap` and `context_payload` are generated **lazily on the next return** (login → brief "loading your case" → generate from the latest stored transcript), and/or after an explicit "Save / I'm done" action — **NOT** on session exit. A browser has no reliable "session end" (`beforeunload` is unreliable, especially on mobile; a parent closing the tab fires nothing), so exit-time regeneration would silently leave the next return with a stale briefing. The raw transcript is persisted continuously (the existing save effect serializes the whole state blob on every change), so deriving summaries at read time guarantees they reflect the real last transcript. Generation is incremental: `new context_payload = f(prior context_payload + this session's transcript)`, so cost is O(1) per return rather than O(n) in case history. (Continuous mid-session updating was considered and rejected.)

---

## 6. Stack direction

The current stack (single `index.html` + one stateless Netlify function) cannot do this as-is. Accounts require three new capabilities: **authentication**, a **database**, and **file storage**.

**Recommended direction: a backend-as-a-service, likely Supabase** — it provides auth, a Postgres database, and file storage in one service and bolts onto the existing frontend. The stateless Anthropic proxy function stays; the backend layer is added around it. Building auth/database/storage from scratch is rejected: months of work and a security surface a non-coder should not own.

**Final stack choice is deferred until Section 7 is settled**, since the sensitive-data posture influences storage choices. This document does not commit to a vendor; it commits to the *shape* (managed auth + DB + file storage).

---

## 7. Sensitive-data handling (a design input, not an afterthought)

Storing children's special-education and disability-related information creates obligations that must shape the build from the start.

### Storage posture (decided)

- **Do NOT store raw uploaded originals** (IEPs, psychoeducational evaluations). Store only a deliberately shallow "headline" extraction in `docs_reviewed[]` and discard the raw file.
  - **Headline floor and ceiling (explicit):** store document type, date conducted, source/evaluator if relevant, and a short high-level findings summary (e.g., "deficiencies in reading, writing, speech"). Do **NOT** store exact service minutes/levels, goal-by-goal language, classification codes, or verbatim quotes. The extraction is intentionally shallow — state this as a floor **AND** a ceiling, because the natural gravity of an extraction prompt is to be thorough, and thoroughness here defeats the purpose.
  - **This is a deliberate product/legal override of the build review's recommendation.** The review (point #4) recommended a rich structured extraction (reusing `IEP_EXTRACT_PROMPT`) to keep returning-session output quality close to in-session. The owner has overridden this in favor of privacy: store less, accept that a returning chat cannot generate a strong complaint from memory alone, and handle the gap conversationally via conditional re-upload (Section 5). This is intentional, not an oversight.
  - **Why this is the honest choice:** the richer the stored extraction, the thinner the "we don't keep your child's clinical data" claim becomes. Headline-only keeps that claim literally true — Plainly genuinely does not retain the substance between sessions, so the reassurance line shown to parents is accurate, not marketing.
- **DO store documents Plainly generated** (complaint, letters) as files. These are lower liability (the parent's own outgoing advocacy) but **NOT** low sensitivity — a complaint necessarily quotes the child's classification, disability, and service levels, so it contains protected child data and gets the same encryption + RLS as everything else. The breach posture must state this plainly: data-minimization reduces what is held, it does not make what is held non-sensitive.
- **DO store a "Docs Reviewed" ledger** — headline extractions and metadata only, no raw files.

**General principle:** minimization reduces what you hold; it does not make what you hold non-sensitive. Both the headline extractions and the generated docs carry protected child information and must be protected accordingly.

### Other requirements to build in from line one

- **Row-Level Security (RLS) correctness is the single highest-risk control — NOT "encryption at rest."** Encryption at rest (as a BaaS delivers it) is disk-level: it protects against stolen hardware, not against the realistic breach here — a leaked key or a misconfigured access rule. For Supabase specifically, forgetting to enable RLS on a table exposes it to anyone with the public anon key. For a non-coder owner this is the thing most likely to go wrong and most catastrophic if it does.
  - **Build gate:** per-table RLS policy review and testing, with an explicit "can user A read user B's row?" test that must pass before that table holds real data.
  - The service-role key lives **ONLY** in the Netlify function — never in the client.
- **Client-trusted vs. server-trusted context assembly — decided: SERVER-SIDE.** The Anthropic proxy function fetches the case context from Supabase server-side (using the user's auth token), rather than the browser fetching `context_payload` and handing it to the proxy. This keeps full case data out of the client beyond what's displayed on the account page. Routing the case read through the existing function shapes that function's role and is decided now because it cascades into Sections 6 and 8.
- **Encryption at rest** — still on (baseline), but understood as the secondary control behind RLS.
- **Minimal retention** + a real **delete-my-data path.** Deletion must **CASCADE** — to the storage-bucket files (generated docs) and all `sessions[]` (transcripts), not just the user row. State this now even though the UI is v1.1.
- **Breach posture** — a clear answer to "what happens if this leaks," honest that both headline extractions and generated docs carry protected child data.
- **Privacy policy, terms of use, and consent at account creation** — what is stored, why, how long, how to delete. Required the moment storage exists. (The headline-only decision makes these easier to write honestly, since less is held.)
- **Anonymous-use invariant (explicit):** anonymous use writes **ZERO** server-side rows until the parent clicks "Save." This keeps "use once and walk away with no trace" literally true and means there is no anonymous-session TTL/cleanup to build.

### Items for Moshe (product owner / attorney) to own

These are flagged for awareness, not for Claude Code to resolve:

- **FERPA-adjacent territory** — these are education records; Plainly isn't a school, but parents may assume school-level protections.
- **Professional-role considerations** — a tool under a NY attorney's name that stores case details, generates complaints, and engages with parents about a live dispute sits near lines around unauthorized practice of law, attorney-client relationship formation, and malpractice exposure. The stateless version kept more distance; persistence narrows it. (These are legal/professional judgments for Moshe, noted here only so the architecture isn't designed in silence about them.)

---

## 8. Build order

Build the spine first; hang the rest off it. The sensitive-data handling (Section 7) is baked into each step, not retrofitted.

1. **Auth** — login, account creation, magic-link or email+password. The foundation.
2. **Case-state persistence** — store/load `intake` + `formalFields` + `recap` + `context_payload` per user; the lazy-on-return regeneration of `recap`/`context_payload`; the context injection on return. This is the spine of both scenarios.
3. **Document storage** — `generated_docs[]` as files; `docs_reviewed[]` ledger with headline extractions and raw-file discard.
4. **Notes** — the `parent_notes` box on the account page + injection.
5. **Anonymous-to-account upgrade** — the "claim in-browser state into a new account" path (Flow 2).

(Account-page UI is built alongside steps 2–4 as those data pieces come online. Delete-my-data is v1.1 but planned.)

---

## 9. Open items / deferred

- **Final stack/vendor choice** — pending Section 7 sign-off (lean: Supabase).
- **LAUNCH GATE — flip Supabase to Pro ($25/mo) before pointing live traffic at it.** Build and test on the free tier (correct for development). But the free tier (a) pauses a project after ~1 week of inactivity, taking the database offline until manually resumed, and (b) has no automated backups. Both are harmless during active development but unacceptable once real parents rely on persistence — a returning parent hitting a paused project is the worst-case break of the core promise, and storing families' case data without backups is not acceptable. This flip is a hard gate, not a nice-to-have. (Free tier limits as of mid-2026: 500 MB DB, 50k MAU, 1 GB file storage, 2 projects — all ample for Plainly's data shape; the pausing/backups are the only real constraints, and both resolve on Pro.)
- **LAUNCH GATE — supply the real consent wording before any real user creates an account.** The Step 1 consent gate ships with placeholder wording, which is fine for preview-only testing. But recording a real parent's click-to-agree against placeholder text is not an acceptable record of consent. The owner-supplied wording (what is stored, how it's protected, what the operator can and cannot access — see Section 7) must replace the placeholder before live traffic. Same hard-gate category as the Supabase Pro flip: harmless in development, unacceptable once a real parent is on the other side of it.
- **Multi-case per user** — deferred; bounded refactor; workaround is separate accounts per child.
- **"Past conversations" transcript view** — possible later addition; not v1.
- **delete-my-data UI** — v1.1, planned.
- **Post-filing prompt/content layer** — later; architecture already supports it with no structural change.

---

## 10. How this was decided

This architecture was scoped in a chat-side conversation (per the working split in `CLAUDE.md`: think and scope in chat; implement in Claude Code). Key decisions, in the order they settled:

- Accounts are optional; anonymous use stays first-class.
- One user → one case (multi-case deferred).
- Don't hoard raw originals; keep headline extractions + generated docs.
- No procedural state machine; `recap` is descriptive prose, not an enum. Scenario #1 and #2 share one architecture.
- Three derivation layers: short recap (parent) → detailed context_payload (chat) → raw transcripts (ground truth).
- Returning chat is fresh, with silent context injection + an honest, recap-derived opening line that invites updates.
- Summaries are generated lazily on return (not on unreliable session-exit) and incrementally (O(1) per return).
- The structured layer of context_payload reuses stored `intake` verbatim — never re-derived from transcript (anti-drift).
- Uploaded documents are stored as headline-only extractions (type/date/high-level findings), not rich extractions — a deliberate privacy-over-quality override of the build review; the gap is handled via conditional re-upload.
- RLS correctness (not encryption-at-rest) is the load-bearing security control; context assembly is server-side; deletion cascades.

Before implementation: this doc should be reviewed against `CLAUDE.md`'s pre-flight checklist (branch first, deploy-preview test before merge, explicit approval before push/merge) — note: these conventions have been added to `CLAUDE.md` under Working conventions.
