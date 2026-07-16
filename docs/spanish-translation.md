# Spanish translation — Phase 1 (infrastructure + toggle + homepage)

**Status:** ✅ **WIRED on `spanish-i18n-phase1` (off `main`), in deploy preview
for in-context Spanish review.** Decisions D1/D2/D3/D4 settled (see §10). Verified
NYSED terminology applied (§7). The §6 table below is kept as the source of truth;
review corrections come back as plain-language notes and land as string edits on
this branch. Owner-gated merge after the Spanish review returns.

**Review surface:** the deploy-preview URL — toggle to **Español** and read the
homepage as a parent would.

Three things need your review here before any build:

1. **The architecture** (§1–§4) — the `t()` / context / persistence shape and
   the header-toggle responsive plan.
2. **The full en/es string table** (§6) — flagged *draft-for-review*. You review
   the Spanish before it ships.
3. **The exact chat system-prompt addition + Spanish greeting** (§5) — you
   approve the wording before it's finalized.

---

## 0. Scope boundary (what this branch does and does not touch)

**In scope (Phase 1):**
- Translation infrastructure (string table, `lang` state, `t()` helper), no new deps.
- Header language toggle, visible at every width incl. <500px.
- `<html lang>` updates with the toggle.
- **Homepage only** (`HomePage`, lines ~1926–2172), *including* the hero chat
  demo (its `HERO_DEMO_BEATS` + greeting play in Spanish when lang=ES).
- **Header/nav labels** and **footer** (shown on every page, so they follow the
  toggle everywhere).
- **The chat conversation language** (item 5): when lang=ES, the live chat opens
  and converses in Spanish, and says up front that legal drafts are prepared in
  English but explained in Spanish.

**Explicitly out of scope (Phase 2 / by design):**
- All other page *bodies* (`/how`, `/who`, `/faq`, `/resources`, `/about`,
  `/contact`, `/account`, `/login`, `/start` UI chrome) stay English regardless
  of the toggle this phase. The shared header/footer on those pages *do* follow
  the toggle — that's intentional and expected.
  - *Post-merge note (branch `privacy-ai-copy-edits`):* the FAQ page gained two
    new entries — "How is AI used on this site?" and "Can I just use an AI tool
    like ChatGPT or Claude myself…". These are English-only like the rest of the
    FAQ and **join the Phase-2 FAQ translation scope** when `/faq` is localized.
- **Legal pages** (`#/terms`, `#/privacy`) stay English **permanently** by
  design. Their footer *link labels* translate; the linked pages do not.
- **Generated legal documents stay English, always** — the due-process
  complaint, letters to the district, the 10-day notice. This is the product
  promise, not a gap (see §5). The de-lawyer/drafter prompts are untouched.
- Parent-facing *generated outputs* on `/start` (checklist, action
  recommendations) stay English in Phase 1 — they live on a Phase-2 surface. The
  chat, conversing in Spanish, explains them in Spanish. *(Open decision D3.)*

---

## 1. Translation infrastructure (single-file, zero new deps)

### 1a. The string table shape

A flat, namespaced object keyed by string ID, each holding `en` and `es`. Placed
in its own bannered section near the top of the `<script>` (by the router/header
block, ~line 1615), so it's one obvious place to edit.

```js
const TRANSLATIONS = {
  "nav.how":        { en: "Filing a Complaint", es: "Cómo presentar una queja" },
  "hero.h1.line1":  { en: "Your child's school program isn't working.",
                      es: "El programa escolar de su hijo no está funcionando." },
  // …one entry per string (full table in §6)
};
```

Flat dotted keys (not nested objects) keep lookups trivial and the table
greppable. Interpolation is **not** needed — every Phase-1 string is static.

### 1b. `lang` state + `t()` via React context

A single context provider wraps the app so a toggle re-renders **everything**
consumer-side with no reload (item 6). This is the idiomatic single-file move and
avoids a manual force-update.

```js
const LangContext = React.createContext(null);

function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem("beheard:lang") === "es" ? "es" : "en"; }
    catch (e) { return "en"; }
  });
  // Reflect the restored/selected language onto <html lang> (item 3).
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = (next) => {
    setLangState(next);
    try { localStorage.setItem("beheard:lang", next); } catch (e) {}
  };
  const t = (key) => {
    const row = TRANSLATIONS[key];
    if (!row) return key;                 // missing key → visible, not a crash
    return row[lang] || row.en || key;    // missing es → graceful English fallback
  };
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

function useLang() { return React.useContext(LangContext); }
```

`App` gets wrapped: `root.render(<LangProvider><App /></LangProvider>)`.
Components that render copy call `const { t } = useLang()` and use `t("hero.h1.line1")`.

### 1c. Persistence — **critical gotcha**

The key is **`beheard:lang`**, *not* `plainly:lang`. Two cleanup routines
(index.html ~3002 and ~7483) unconditionally delete every `localStorage` key
beginning with `plainly:`. A `plainly:`-prefixed language key would be wiped on
those code paths. `beheard:` is untouched.

### 1d. `<html lang>` on first paint

Static HTML ships `<html lang="en">` (line 2). The `useEffect` in §1b sets it to
the restored value on mount, so a returning ES visitor gets `lang="es"` as soon
as the app hydrates. (We accept `en` for the pre-hydration instant; acceptable
for an SPA and no worse than today.)

---

## 2. Handling strings that contain inline markup

Some homepage strings wrap markup we must preserve (not translate as opaque HTML,
and **no `dangerouslySetInnerHTML`**). Approach: keep the JSX structure, split the
translatable text into sub-keys around the markup. Examples:

- Hero `<h1>`: `Your child's… <br/> <em>Let's fix it.</em>` →
  `t("hero.h1.line1")` + `<br/>` + `<em>{t("hero.h1.line2")}</em>`.
- "You Can Do Something" paragraphs with `<em>…</em>` → split into
  `…p1.pre` + `<em>{t("…p1.em")}</em>` (a couple of these).
- Footer disclaimer with inline Terms/Privacy `<a>` links → keep the `<a>`
  elements in JSX, translate the surrounding fragments as keys
  (`footer.agree.pre` / `.and` / `.post`).

This is the only mildly fiddly part of the wiring; §6 marks each split-key group.

---

## 3. The language toggle

### 3a. Behavior & label convention (your spec)

- The button shows the **language you'd switch to, in that language**:
  `lang==='en'` → **"Español"**; `lang==='es'` → **"English"**. A Spanish speaker
  landing on the English page sees "Español" and can find it.
- Fully spelled out — never "ES/EN".
- `onClick` → `setLang(lang === 'en' ? 'es' : 'en')`. Immediate, no reload (§1b).
- Accessibility: `aria-label` states the action ("Cambiar idioma a español" /
  "Switch language to English"), and the button carries `lang="es"` when it shows
  "Español" (and `lang="en"` when it shows "English") so screen readers pronounce
  the word in the right language.

### 3b. Styling — a clearly tappable control, not a nav link

Its own class `lang-toggle`, distinct from `.site-nav a`:

```css
.lang-toggle {
  display: inline-flex; align-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 14px; font-weight: 500;
  font-family: inherit;
  color: var(--ink); background: transparent;
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
  min-height: 36px;                 /* comfortable touch target */
  transition: border-color .15s ease, background .15s ease;
}
.lang-toggle:hover { border-color: var(--ink-soft); background: var(--surface, rgba(0,0,0,.03)); }
.lang-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

Subtle border (not underline — reads as a button, and avoids being mistaken for
the underlined "Heard" wordmark). Bordered pill matches the existing `.header-cta`
family without copying its filled terracotta (that stays the single primary CTA).

### 3c. Placement in the header

Insert as its own flex item in `.site-header-inner`, **outside** `.site-nav`
(which is `display:none` on mobile). Order left→right:

```
brand │ site-nav (flex:1, pushes the rest right) │ lang-toggle │ login/account │ Start CTA
```

Because it's a standalone `flex-shrink:0` item with `white-space:nowrap`, it can't
wrap internally and it's not part of the nav group — so it **cannot** reintroduce
the nav-wrap bug (that bug was the *nav links* wrapping; those stay hidden on
mobile and untouched).

### 3d. Responsive plan — visible at every width (your hard requirement)

Current header collapse: at `≤720px` `.site-nav` is hidden, leaving
`brand · login/account · Start CTA`. We add the toggle to that always-visible row.
The tight case is ~360–375px, and Spanish makes the login label longer
("Iniciar sesión" > "Log in"), so a plain add would risk overflow. Plan:

- The toggle is **priority** and is *never* hidden (your rule).
- At `≤500px`, **hide the login/account text link** — it is the lowest-priority
  secondary header item, and you explicitly gave the toggle priority over other
  secondary items. Result row at ≤500px: `brand · lang-toggle · Start CTA` — three
  `nowrap` items, comfortably one line at 375px.
  - **Mobile login path (confirmed):** with the header link hidden there is **no
    remaining tappable path** to sign in on mobile — the footer has no
    account/login link, and the chat's account nudge is text-only (no button); only
    manually typing `#/login` works. So hiding it alone would strand mobile users.
  - **Fix (cheapest): an auth-aware footer link.** Add one row to the footer's
    "Get help" column — `My account` when signed in, `Log in` when not (mirrors the
    header's `user ? "/account" : "/login"`; `Footer` starts reading `useAuth` like
    `Header` does). Footer is already being localized this phase, so it's one more
    `t()`-keyed link with zero header width pressure, working on every page.
  - **Alternative (only if top-of-page login matters on mobile):** replace the
    header text link with a ~32px account icon button at ≤500px. Keeps login at the
    top but only *barely* fits at 375px (~334px in a ~343px box) and needs an icon +
    CSS. Not recommended unless you want it.
  - A full mobile menu (hamburger) is the real long-term fix and stays **deferred to
    Phase 2** (building one now would risk the nav-wrap regression we're told to
    avoid). *(Decision D2.)*
- Also at `≤500px`: tighten `.site-header-inner` gap to ~10px and trim
  `.header-cta` / `.lang-toggle` padding slightly for headroom.

Measured fit at 375px (≤500px rule applied): brand wordmark (~90px) + toggle
"Español" (~86px) + Start CTA (~96px) + 2×10px gaps = ~302px inside a ~343px
content box → fits with margin, no horizontal overflow.

**Verification gate (per our responsive rule):** confirm 375 / 768 / 1280px on
the deploy preview — no horizontal overflow, toggle visible and tappable at all
three, and the mobile header keeps headline + primary CTA above the fold.

---

## 4. Files touched (Phase 1)

- **`index.html`** only, for the app: add `TRANSLATIONS`, `LangProvider`/`useLang`,
  `LangToggle`, wrap `App`, and swap literals → `t(...)` in `Header`, `Footer`,
  `HomePage`, `HeroChatDemo` (beats/greeting), and the chat greeting + system-prompt
  assembly (`ChatTool`/`processCall`).
- **`netlify/functions/claude.js`** — *no change required* under the recommended
  transport (§5c). (Alternative transport would add a few lines; flagged there.)

No build step, no new dependencies — consistent with the Babel-in-browser
single-file architecture.

---

## 5. The chat in Spanish (item 5) — for your approval

### 5a. Design recommendation

The chat's first message is today a **static** constant (`OPENING`, line 6417),
not model-generated. Two ways to deliver a Spanish opening that states the
English-docs caveat:

- **Option 1 (recommended): a static `OPENING_ES`.** When lang=ES the chat seeds
  the thread with a Spanish greeting that already contains the caveat, and the
  system-prompt block (§5b) makes every *subsequent* turn Spanish. Reliable, zero
  added latency, and the caveat is guaranteed present (not dependent on the model
  remembering). Mirrors the EN path exactly.
- **Option 2: model-generated first turn** when lang=ES (call the model on mount
  with the LANGUAGE block and let it write the greeting). Matches item 5's wording
  most literally, but adds a network round-trip + loading state before the parent
  sees anything, and risks the model omitting the caveat. More surface, more failure
  modes.

**Recommendation: Option 1.** It achieves exactly what item 5 asks for — a Spanish
greeting that states the English-docs caveat, plus a fully Spanish conversation —
without the latency/reliability cost. The system-prompt block still carries the
caveat instruction so the model reinforces it on later turns. *(Decision D1.)*

### 5b. Proposed system-prompt addition (appended to `baseSystem` when lang=ES)

> `\n\n--- LANGUAGE: SPANISH ---\n`
> The parent is using the site in Spanish. Conduct this entire conversation in
> warm, plain, natural Spanish — every message you write to the parent must be in
> Spanish, including greetings and follow-ups. Keep the site's voice: warm,
> direct, encouraging, plain-spoken, never bureaucratic. Do not switch to English
> unless the parent writes to you in English.
>
> For special-education terms of art, use the Spanish terminology New York State
> uses in its parent materials, keeping the English acronym in parentheses on
> first use so the parent can recognize the term on district paperwork — e.g.
> "IEP" (Programa de Educación Individualizada), "queja de debido proceso" (due
> process complaint), "reunión de resolución", "comité de educación especial (CSE)",
> "mediación", "reembolso de matrícula".
>
> IMPORTANT — the legal documents you help prepare (the due-process complaint,
> letters to the district, the 10-day notice) are written in **English**, because
> that is the language school districts and the State Education Department process
> them in. You will still explain everything about them — what each says, why it
> matters, what to do with it — in Spanish, at every step. When it comes up
> naturally (and briefly in your opening), say this warmly, as reassurance, not as
> a disclaimer. Never translate the drafted legal documents themselves into Spanish.

### 5c. Transport (how the hint reaches the model)

`callClaude` already sends `system: dynamicSystem`, and the serverless function
forwards `body.system` verbatim. So the minimal, zero-risk mechanism is to
**append the §5b block to `baseSystem` client-side in `processCall` when
`lang==='es'`** — *no serverless change, no function redeploy.*

Alternative (if you'd rather the function own it): pass `lang:'es'` in the request
body and have `claude.js` inject the block. Costs a function change + redeploy +
preview retest for no behavioral gain. **Recommended: client-side append.**

Scope note: the language hint is applied to the **chat turns only** (`callClaude`).
`runDrafter` and the document-drafting calls stay English (the product promise).

---

## 6. The en/es string table — DRAFT FOR YOUR REVIEW

Plain, warm, non-technical Latin-American Spanish, matching the site's voice.
Terms of art follow NYSED's Spanish parent materials (see §7 for the exact terms
and which ones I want you to double-check). **All Spanish below is first-pass
draft — please mark anything to change.**

### 6.1 Header / nav

| key | English | Español (draft) |
|---|---|---|
| `header.tag` | Free · NY · Special education | Gratis · NY · Educación especial |
| `nav.how` | Filing a Complaint | Cómo presentar una queja |
| `nav.who` | Is this for me? | ¿Es esto para mí? |
| `nav.faq` | FAQ | Preguntas frecuentes |
| `nav.resources` | Resources | Recursos |
| `nav.about` | About | Acerca de |
| `header.login` | Log in | Iniciar sesión |
| `header.account` | Account | Mi cuenta |
| `header.cta` | Start → | Comenzar → |

*(Toggle label is not a table row — it's computed: shows "Español" in EN, "English" in ES.)*

### 6.2 Hero

| key | English | Español (draft) |
|---|---|---|
| `hero.eyebrow` | Free · For New York parents | Gratis · Para padres de Nueva York |
| `hero.h1.line1` | Your child's school program isn't working. | El programa escolar de su hijo no está funcionando. |
| `hero.h1.line2` *(em)* | Let's fix it. | Vamos a arreglarlo. |
| `hero.lede` | This is a free tool that helps you push back when your child's IEP or special education decision isn't right — without a lawyer, without legalese, and without giving up. Tell us what's going on. We'll help you figure out what to do next. | Esta es una herramienta gratuita que le ayuda a defender a su hijo cuando su IEP o una decisión de educación especial no es correcta — sin abogados, sin lenguaje legal complicado y sin darse por vencido. Cuéntenos qué está pasando. Le ayudaremos a decidir qué hacer a continuación. |
| `hero.cta.primary` | Tell us what's going on | Cuéntenos qué está pasando |
| `hero.cta.secondary` | Or see how filing works | O vea cómo funciona presentar una queja |

**Hero stats** (numbers unchanged; labels translate):

| key | English | Español (draft) |
|---|---|---|
| `hero.stat1` | NY children receiving special education services | niños en NY que reciben servicios de educación especial |
| `hero.stat2` | of NYC public school students have an IEP | de los estudiantes de escuelas públicas de NYC tienen un IEP |
| `hero.stat3` | cost to file a due process complaint | cuesta presentar una queja de debido proceso |

### 6.3 "You have the right to push back" section

| key | English | Español (draft) |
|---|---|---|
| `rights.h2` | You have the right to push back. | Usted tiene derecho a reclamar. |
| `rights.p1` | Federal law — IDEA, the Individuals with Disabilities Education Act — gives every parent in New York the right to challenge a special education decision they believe is wrong. You don't need a lawyer. You don't need permission. You don't need to be an expert. You just need to put your concerns on the record in a specific way, and the district has to respond. | La ley federal — IDEA, la Ley de Educación para Personas con Discapacidades — le da a cada padre en Nueva York el derecho de cuestionar una decisión de educación especial que considere equivocada. No necesita un abogado. No necesita permiso. No necesita ser un experto. Solo necesita dejar constancia de sus inquietudes de una manera específica, y el distrito tiene que responder. |
| `rights.p2` | Most parents who have viable claims never exercise this right — because the process looks intimidating, lawyers are expensive, and nobody has explained what filing actually involves. That's the gap we're trying to close. | La mayoría de los padres que tienen reclamos válidos nunca ejercen este derecho — porque el proceso parece intimidante, los abogados son caros y nadie les ha explicado lo que realmente implica presentar una queja. Esa es la brecha que estamos tratando de cerrar. |
| `rights.c1.h` | The tool is free | La herramienta es gratuita |
| `rights.c1.p` | Always. There's no fee to use this tool, no premium tier, and no catch. We built this because parents shouldn't have to choose between their child's education and their savings account. | Siempre. No hay ningún costo por usar esta herramienta, no hay versión premium y no hay trucos. La creamos porque ningún padre debería tener que elegir entre la educación de su hijo y sus ahorros. |
| `rights.c2.h` | Filing is free too | Presentar la queja también es gratis |
| `rights.c2.p` | There's no fee to file a due process complaint. The district can't recover legal fees from you unless your filing is frivolous (a high bar). The downside of filing is genuinely low. | No hay ningún costo por presentar una queja de debido proceso. El distrito no puede cobrarle honorarios legales a menos que su queja sea frívola (algo muy difícil de demostrar). El riesgo de presentarla es realmente bajo. |
| `rights.c3.h` | You don't need a lawyer | No necesita un abogado |
| `rights.c3.p` | Many parents handle these cases pro se and most settle at the resolution session — an informal meeting before any hearing. The system is designed to work for parents who represent themselves. | Muchos padres manejan estos casos sin un abogado y la mayoría se resuelven en la reunión de resolución — una reunión informal antes de cualquier audiencia. El sistema está diseñado para funcionar para los padres que se representan a sí mismos. |

### 6.4 "Common situations we help with"

| key | English | Español (draft) |
|---|---|---|
| `situations.h2` | Common situations we help with | Situaciones comunes en las que ayudamos |
| `situations.sub` | Tap any of these to see what it looks like in our tool. You don't have to fit neatly into a category — most parents don't. | Toque cualquiera de estas para ver cómo se ve en nuestra herramienta. No tiene que encajar perfectamente en una categoría — la mayoría de los padres no lo hacen. |
| `situations.tileArrow` | See how → | Vea cómo → |
| `situations.t1.h` | The services aren't enough | Los servicios no son suficientes |
| `situations.t1.p` | Your child needs more speech, OT, reading help, or 1:1 support than the IEP provides — and the district keeps saying no. | Su hijo necesita más terapia del habla, terapia ocupacional, apoyo de lectura o ayuda individual (1:1) de la que ofrece el IEP — y el distrito sigue diciendo que no. |
| `situations.t2.h` | Services are missing | Faltan servicios |
| `situations.t2.p` | The IEP says your child gets services, but they're being skipped, shortened, or quietly dropped. | El IEP dice que su hijo recibe servicios, pero se los están saltando, acortando o eliminando sin avisar. |
| `situations.t3.h` | You're considering private school | Está considerando una escuela privada |
| `situations.t3.p` | The public program isn't working and you're thinking about unilateral private placement — with the district paying. | El programa público no está funcionando y está pensando en una colocación privada unilateral — con el distrito pagando. |
| `situations.t4.h` | The evaluation feels wrong | La evaluación no parece correcta |
| `situations.t4.p` | The district's evaluation missed things, or they're refusing to evaluate — and you can't move forward without one. | La evaluación del distrito pasó cosas por alto, o se niegan a evaluar — y usted no puede avanzar sin una. |
| `situations.t5.h` | The placement is wrong | La colocación no es la adecuada |
| `situations.t5.p` | The class size, ratio, or restrictiveness doesn't match what your child actually needs. | El tamaño de la clase, la proporción o el nivel de restricción no corresponde a lo que su hijo realmente necesita. |
| `situations.t6.h` | The district has gone quiet | El distrito no responde |
| `situations.t6.p` | You've raised concerns at meetings or in emails and gotten no meaningful response. | Ha planteado sus inquietudes en reuniones o por correo electrónico y no ha recibido una respuesta real. |

### 6.5 "How this works"

| key | English | Español (draft) |
|---|---|---|
| `how.h2` | How this works | Cómo funciona esto |
| `how.intro` | Here's what actually happens when you start — no forms, no jargon, no cost. | Esto es lo que realmente sucede cuando empieza — sin formularios, sin jerga, sin costo. |
| `how.s1.h` | Tell us what's going on | Cuéntenos qué está pasando |
| `how.s1.p` | Open the chat. Describe your situation in your own words — no forms, no jargon. We'll ask follow-up questions, identify what kind of claim this looks like, and flag time-sensitive issues right away. | Abra el chat. Describa su situación con sus propias palabras — sin formularios, sin jerga. Le haremos preguntas de seguimiento, identificaremos qué tipo de reclamo parece ser este y le señalaremos de inmediato los asuntos urgentes. |
| `how.s2.h` | Get something useful in your hands | Obtenga algo útil en sus manos |
| `how.s2.p` | Depending on your situation, that might be a 10-day notice letter, a written follow-up to the CSE chair, a list of documents to gather, or a draft of a full due process complaint. You can edit, download, and send anything we generate. | Según su situación, eso podría ser un aviso por escrito de 10 días, un seguimiento por escrito al presidente del comité de educación especial (CSE), una lista de documentos para reunir, o un borrador de una queja de debido proceso completa. Puede editar, descargar y enviar todo lo que generemos. |
| `how.s3.h` | Decide what to do | Decida qué hacer |
| `how.s3.p` | We'll explain what filing involves, what to expect, and what your options are — including alternatives like mediation. Most parents who file at all settle their case at the resolution session, without ever seeing a hearing room. You're not signing up for a lawsuit; you're putting your situation on the record. | Le explicaremos lo que implica presentar la queja, qué esperar y cuáles son sus opciones — incluyendo alternativas como la mediación. La mayoría de los padres que presentan una queja resuelven su caso en la reunión de resolución, sin llegar nunca a una sala de audiencias. No se está inscribiendo en una demanda; está dejando constancia de su situación. |

**Image alt text** (accessibility — translated):

| key | English | Español (draft) |
|---|---|---|
| `how.s1.alt` | A child working through difficult schoolwork | Un niño esforzándose con una tarea escolar difícil |
| `how.s2.alt` | A parent at a desk holding a printed due process complaint, with an IEP binder, a next-steps checklist, and a laptop | Un padre en un escritorio sosteniendo una queja de debido proceso impresa, con una carpeta del IEP, una lista de próximos pasos y una computadora portátil |
| `how.s3.alt` | Two parents discussing their options with an advisor at a table, beside a checklist of options: resolution session, mediation, agreement, and hearing | Dos padres conversando sobre sus opciones con un asesor en una mesa, junto a una lista de opciones: reunión de resolución, mediación, acuerdo y audiencia |

### 6.6 CTA strip + "You Can Do Something About It"

| key | English | Español (draft) |
|---|---|---|
| `cta.h3` | Ready to start? | ¿Listo para comenzar? |
| `cta.p` | The conversation takes about ten minutes, costs nothing, and doesn't commit you to anything. You can stop, save, and come back any time. | La conversación toma unos diez minutos, no cuesta nada y no lo compromete a nada. Puede detenerse, guardar y regresar en cualquier momento. |
| `cta.button` | Start the conversation | Comenzar la conversación |
| `can.h2` | You Can Do Something About It | Usted Puede Hacer Algo al Respecto |
| `can.p1.pre` | The thing we hear most from parents — both before and after they finally file — is some version of: | Lo que más escuchamos de los padres — tanto antes como después de finalmente presentar la queja — es alguna versión de: |
| `can.p1.em` *(em)* | I didn't know I could do this. | No sabía que podía hacer esto. |
| `can.p2` | You can. Filing a due process complaint isn't a lawsuit. There's no fee. The district can't recover legal fees from you unless the filing is frivolous (a high bar). The worst plausible outcome is that you don't get what you asked for and you're back where you started — only with a much clearer record. The likeliest outcome, especially in clear-cut cases, is that the resolution session itself produces some kind of accommodation, because the district doesn't want to litigate. | Sí puede. Presentar una queja de debido proceso no es una demanda. No hay ningún costo. El distrito no puede cobrarle honorarios legales a menos que la queja sea frívola (algo muy difícil de demostrar). El peor resultado posible es que no consiga lo que pidió y quede donde empezó — solo que con un registro mucho más claro. El resultado más probable, especialmente en casos claros, es que la propia sesión de resolución produzca algún tipo de acomodación, porque el distrito no quiere litigar. |
| `can.p3` | We built this tool because we think the gap between "I have a real problem" and "I can do something about it" is too wide. The tool is free, and it always will be. We're trying to close that gap. | Creamos esta herramienta porque pensamos que la brecha entre "tengo un problema real" y "puedo hacer algo al respecto" es demasiado grande. La herramienta es gratuita, y siempre lo será. Estamos tratando de cerrar esa brecha. |

### 6.7 Footer

| key | English | Español (draft) |
|---|---|---|
| `footer.tagline` | A free, guided tool for New York parents who want to challenge an IEP or special education decision — in plain English, without a lawyer. | Una herramienta gratuita y guiada para padres de Nueva York que quieren cuestionar un IEP o una decisión de educación especial — en lenguaje sencillo, sin un abogado. |
| `footer.h.help` | Get help | Obtenga ayuda |
| `footer.h.learn` | Learn | Aprenda |
| `footer.h.legal` | Legal | Legal |
| `footer.link.start` | Start a conversation | Iniciar una conversación |
| `footer.link.how` | Filing a Complaint | Cómo presentar una queja |
| `footer.link.who` | Is this for me? | ¿Es esto para mí? |
| `footer.link.faq` | FAQ | Preguntas frecuentes |
| `footer.link.resources` | Resources | Recursos |
| `footer.link.about` | About | Acerca de |
| `footer.link.terms` | Terms of Use | Términos de uso |
| `footer.link.privacy` | Privacy | Privacidad |
| `footer.link.contact` | Contact | Contacto |
| `footer.agree.pre` | By using Be Heard you agree to our | Al usar Be Heard, usted acepta nuestros |
| `footer.agree.and` | and | y |
| `footer.disclaimer` | This tool is not a law firm and does not provide legal advice. The drafts and guidance produced by this tool are templates and informational content based on what you tell it — they do not create an attorney-client relationship. For complex matters, particularly involving discipline, expulsion, or significant tuition reimbursement, consider consulting a licensed special education attorney. | Esta herramienta no es un bufete de abogados y no brinda asesoría legal. Los borradores y la orientación que produce esta herramienta son plantillas y contenido informativo basados en lo que usted le cuenta — no crean una relación abogado-cliente. Para asuntos complejos, particularmente los que involucran disciplina, expulsión o un reembolso de matrícula significativo, considere consultar a un abogado con licencia en educación especial. |

*Note:* "Terms of Use" / "Privacy Policy" links translate as labels, but the linked
pages stay English (permanent, by design). "in plain English" is adapted to "en
lenguaje sencillo" (dropping "English", which no longer makes sense in a Spanish sentence).

### 6.8 Hero chat demo (`HERO_DEMO_*`)

| key | English | Español (draft) |
|---|---|---|
| `demo.greeting` | Hi. I'm here to help you make sense of what's going on with your child's special education — just tell me what's going on in your own words, and if you've got a document like the IEP, you can attach it any time and I'll take a look.<br><br>To start — how old is your child, and what's been worrying you? | Hola. Estoy aquí para ayudarle a entender lo que está pasando con la educación especial de su hijo — solo cuénteme qué está pasando con sus propias palabras, y si tiene un documento como el IEP, puede adjuntarlo en cualquier momento y le echaré un vistazo.<br><br>Para empezar — ¿qué edad tiene su hijo y qué le ha estado preocupando? |
| `demo.b1.user` | My son is 10 and I don't think his services are enough — he gets 30 minutes of speech a week. | Mi hijo tiene 10 años y no creo que sus servicios sean suficientes — recibe 30 minutos de terapia del habla a la semana. |
| `demo.b1.reply` | That's worth pushing on. First question: is he making progress toward his IEP goals, or… | Vale la pena insistir en eso. Primera pregunta: ¿está progresando hacia las metas de su IEP, o… |
| `demo.b2.user` | I asked the district to evaluate my daughter in September and nothing's happened. | Le pedí al distrito que evaluara a mi hija en septiembre y no ha pasado nada. |
| `demo.b2.reply` | That's time-sensitive — districts have deadlines to respond to evaluation requests. Let's pin down where your request stands… | Eso es urgente — los distritos tienen plazos para responder a las solicitudes de evaluación. Vamos a precisar en qué punto está su solicitud… |
| `demo.b3.user` | My daughter has dyslexia and has fallen significantly behind — I'm thinking of moving her to a private school. Can the district pay for it? | Mi hija tiene dislexia y se ha atrasado bastante — estoy pensando en cambiarla a una escuela privada. ¿Puede pagarla el distrito? |
| `demo.b3.reply` | Sometimes, yes — it's called tuition reimbursement, and notice and timing matter a lot. Before anything else… | A veces, sí — se llama reembolso de matrícula, y la notificación y los plazos importan mucho. Antes que nada… |
| `demo.b4.user` | My son has an IEP but the district just isn't delivering the services. I've been pressing them on it and they're ignoring me. Can you draft a due process complaint for me? | Mi hijo tiene un IEP pero el distrito simplemente no está brindando los servicios. Los he estado presionando y me están ignorando. ¿Puede redactar una queja de debido proceso para mí? |
| `demo.doc.title` | Due Process Complaint | Queja de debido proceso |
| `demo.input.placeholder` | Ask about your child's situation… | Pregunte sobre la situación de su hijo… |

*(The demo header brand "Be Heard" stays as-is — it's the product name.)*

### 6.9 Live chat greeting (`OPENING_ES`, item 5)

**English `OPENING` (unchanged, for reference):**
> Hi. I'm here to help you make sense of what's going on with your child's special
> education — what their documents actually say, where the district may be falling
> short, and what you can do about it, whether that's pushing back, getting
> something in writing, or filing if it comes to that.
>
> No form to fill out. Just tell me what's going on in your own words, and if
> you've got a document like the IEP, you can attach it any time and I'll take a look.
>
> To start — what's your child's first name, and what's been worrying you?

**`OPENING_ES` (draft):**
> Hola. Estoy aquí para ayudarle a entender lo que está pasando con la educación
> especial de su hijo — lo que realmente dicen sus documentos, dónde el distrito
> podría estar fallando, y qué puede hacer al respecto, ya sea reclamar, obtener
> algo por escrito, o presentar una queja si llega a eso.
>
> No hay ningún formulario que llenar. Solo cuénteme qué está pasando con sus
> propias palabras, y si tiene un documento como el IEP, puede adjuntarlo en
> cualquier momento y le echaré un vistazo.
>
> Una nota: los documentos legales que preparemos — la queja de debido proceso,
> las cartas al distrito, el aviso por escrito de 10 días — los redactaré en inglés,
> porque así es como los distritos y el Departamento de Educación del Estado los
> procesan. Pero le explicaré todo sobre ellos en español, en cada paso.
>
> Un consejo de privacidad: puede usar solo los nombres de pila — el suyo y el de
> su hijo. Puede agregar el nombre completo a cualquier documento que yo cree, fuera
> de esta herramienta, cuando esté listo para presentarlo. Si lo prefiere, también
> puede tachar el nombre completo, la fecha de nacimiento y otros datos en cualquier
> IEP o evaluación que suba.
>
> Para empezar — ¿cuál es el nombre de su hijo y qué le ha estado preocupando?

*Added on branch `privacy-nudges` (privacy-nudge feature): the "Un consejo de
privacidad…" paragraph immediately before the closing question. **Draft-for-review**
— this and its EN counterpart join the Spanish-review list. The EN `OPENING` got
the parallel "A quick privacy tip: …" paragraph in the same spot.*

---

## 7. Terminology (terms of art) — VERIFIED against NYSED

Owner verified these against **NYSED's official Spanish Procedural Safeguards
Notice (May 2024, nysed.gov)** and they are wired verbatim. Note the correction
from the earlier draft: **"reunión de resolución"** (NOT "sesión de resolución").

| Term of art | Wired rendering | Status |
|---|---|---|
| due process complaint | **queja de debido proceso** | ✔ verified |
| due process hearing | **audiencia de debido proceso** | ✔ verified |
| impartial hearing (IHO) | **audiencia imparcial** (IHO = "oficial de audiencia imparcial") | ✔ verified |
| resolution session | **reunión de resolución** *(corrected from "sesión")* | ✔ verified |
| resolution period | **plazo de resolución** | ✔ verified |
| mediation | **mediación** | ✔ verified |
| procedural safeguards notice | **aviso de garantías procesales** | ✔ verified |
| IDEA | **Ley de Educación para Personas con Discapacidades (IDEA)** | ✔ verified |
| FAPE | **educación pública gratis y apropiada (FAPE)** | ✔ verified |
| IEP | **Programa de Educación Individualizada (IEP)** | ✔ verified |
| CSE | **comité de educación especial (CSE)** | ✔ verified |
| IEE | **evaluación educativa independiente (IEE)** | ✔ verified |
| pendency | **pendencia** | ✔ verified |
| placement | **colocación** | ✔ verified |
| state complaint | **queja estatal** | ✔ verified |
| manifestation determination | **determinación de manifestación** | ✔ verified |
| pro se / self-represented | **sin un abogado / representarse a sí mismo** (descriptive — the notice doesn't use the Latin) | ✔ verified |
| 10-day notice | **aviso por escrito de 10 días** | ⏳ **the one term still pending** verbatim NYSED confirmation — rendered consistently everywhere so a single find-replace updates it |

Source: NYSED Spanish Procedural Safeguards Notice (May 2024), nysed.gov.

---

## 8. Build sequence (once §5–§7 are signed off)

1. Add `TRANSLATIONS`, `LangProvider`/`useLang`, wrap `App`.
2. Add `LangToggle` + CSS; place in header; apply the ≤500px responsive rule.
3. Swap `Header` + `Footer` literals → `t(...)`.
4. Swap `HomePage` literals → `t(...)` (incl. the split-markup keys, §2).
5. Localize `HeroChatDemo` (beats + greeting read from `t(...)`/table by `lang`).
6. `OPENING_ES` + the §5b system-prompt append in `processCall` (lang=ES).
7. `<html lang>` verified switching live.

## 9. Verification before merge (owner-gated)

- Deploy-preview exercise (not diff-reading) per our workflow.
- Toggle flips **everything** visible with no reload: nav, hero, demo, footer, `<html lang>`.
- Reload persists the choice (`beheard:lang`); ES restored on load.
- Responsive gate at **375 / 768 / 1280px**: toggle visible + tappable at all
  widths incl. <500px; no horizontal overflow; no nav-wrap; mobile keeps headline
  + primary CTA above the fold.
- Chat on `/start` with lang=ES: opens in Spanish, states the English-docs caveat,
  converses in Spanish; a generated draft is still **English**.
- Other pages/bodies remain English; `/terms` + `/privacy` remain English.

---

## 10. Open decisions for you

- **D1 — Chat greeting:** ✅ **DECIDED — static `OPENING_ES`** (§5a).
- **D2 — Mobile login link:** ✅ **DECIDED — auth-aware footer link** (`My account`
  / `Log in`) in the footer's "Get help" column. Wired; header link hides at ≤500px.
- **D3 — Generated `/start` outputs (checklist, action recs):** ✅ **DECIDED —
  stay English in Phase 1** (chat explains them in Spanish).
- **D4 — Terminology:** ✅ **DECIDED — do not guess.** Owner will supply the exact
  Spanish renderings for the ★ terms from **NYSED's Spanish Procedural Safeguards
  Notice**. The ★ rows in §7 are placeholders until then; **no wiring** of any
  terminology-bearing string until they're signed off.
