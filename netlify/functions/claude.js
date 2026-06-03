// Netlify Function that proxies requests to Anthropic's API.
//
// The browser sends the same JSON body it would send to Anthropic directly.
// This function adds the API key from the ANTHROPIC_API_KEY env var,
// rate-limits per IP, and forwards the response back.
// Also validates/normalises the model to protect against stale cached clients.
//
// Configure ANTHROPIC_API_KEY in Netlify: Site settings → Environment variables.

const RATE_LIMIT_PER_IP_PER_HOUR = 100;
const ipRequestCounts = new Map();

// Known-good model names as of June 2025.
// If the client sends an unknown/deprecated model we substitute the default.
const VALID_MODELS = [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ];
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

function getClientIP(headers) {
    return (
          headers["x-nf-client-connection-ip"] ||
          (headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          headers["client-ip"] ||
          "unknown"
        );
}

function checkRateLimit(ip) {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const entry = ipRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
        ipRequestCounts.set(ip, { count: 1, resetAt: now + HOUR });
        return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_PER_IP_PER_HOUR) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
    return { allowed: true };
}

// Fetch this user's stored case narrative (the chat-facing "memory" briefing)
// for server-side injection on authenticated turns. Posture (see the Step 2/3
// plan, Section D):
//   * Validate the token via Supabase's /auth/v1/user — NOT a local JWT verify.
//     The project uses asymmetric signing keys, so verifying the JWT locally
//     would be wrong; let Supabase validate it.
//   * Read the row AS THE USER, under RLS, with the user's token + the public
//     publishable key. The secret/service-role key is NEVER used here (it isn't
//     even read), so there is no admin/cross-user read path.
// Returns the narrative string, or null (→ no injection; chat proceeds normally).
async function fetchCaseNarrative(userToken) {
    const url = process.env.SUPABASE_URL;
    const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !pub) return null; // env not configured → behave as anonymous
    const authHeaders = { apikey: pub, Authorization: "Bearer " + userToken };
    try {
          // 1. Validate the user (key-format-agnostic; 401 if token is bad/expired).
          const userResp = await fetch(url + "/auth/v1/user", { headers: authHeaders });
          if (!userResp.ok) return null;
          // 2. Read context_narrative for this user's own row (RLS returns only it).
          const caseResp = await fetch(url + "/rest/v1/cases?select=context_narrative", {
                  headers: authHeaders,
          });
          if (!caseResp.ok) return null;
          const rows = await caseResp.json();
          const narrative = Array.isArray(rows) && rows[0] && rows[0].context_narrative;
          return narrative ? String(narrative) : null;
    } catch (e) {
          return null; // network/parse failure → no injection, chat still works
    }
}

// ---------------------------------------------------------------------------
// Commit 4: lazy, incremental regeneration of recap + context_narrative.
// ---------------------------------------------------------------------------
const REGENERATE_PROMPT = `You maintain the running memory of a New York special-education advocacy case between chat sessions. You receive: the PRIOR NARRATIVE (your last briefing, possibly empty on the first run), the structured INTAKE (validated facts — names, services, dates, remedy), and the MOST RECENT SESSION TRANSCRIPT. Produce two things via the save_case_summary tool.

recap — 1-2 sentences, addressed to the parent, plain and warm, describing what's been done so far in their own terms. Honest and DESCRIPTIVE, never prescriptive: report what happened in the conversation; do NOT assert real-world procedural status you can't verify (e.g., don't say a complaint was "filed" unless the parent said they filed it).

narrative — a fuller briefing (a short paragraph or two) for YOUR next session, so a fresh advocate can pick up intelligently. Prose only. Capture the situation, the parent's concerns and goals, what was discussed or produced, open threads, and tone. Do NOT enumerate the structured facts that already live in intake (services, dates, names, remedy) — they're provided separately and read live; reference them only as the story needs. Be honest about uncertainty: you know what was said, not what the parent did between sessions.

INCREMENTAL: fold the most recent session INTO the prior narrative — extend and update it; don't rewrite the whole case from scratch or drop earlier context. If the prior narrative is empty, write it fresh from the transcript.`;

const SUMMARY_TOOL = {
    name: "save_case_summary",
    description: "Return the regenerated parent-facing recap and the fuller chat-facing narrative.",
    input_schema: {
          type: "object",
          properties: {
                  recap: { type: "string", description: "1-2 sentences, parent-facing, plain, descriptive — never prescriptive." },
                  narrative: { type: "string", description: "Short prose briefing for the next session; fold the most recent session into the prior narrative; prose only, no enumerated intake facts." },
          },
          required: ["recap", "narrative"],
    },
};

function jsonResponse(statusCode, obj) {
    return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

// Reads (as the user, under RLS) the prior narrative + intake + ONLY the most
// recent session's transcript — cost is O(1) per return, never O(n) over all
// history — asks Anthropic to fold that session into the prior narrative, and
// writes the new recap + narrative back. The secret key is never used.
async function handleRegenerate(event, apiKey) {
    const url = process.env.SUPABASE_URL;
    const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !pub) return jsonResponse(500, { error: "Supabase env not configured" });
    const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
    if (authz.indexOf("Bearer ") !== 0) return jsonResponse(401, { error: "Sign-in required" });
    const token = authz.slice(7);
    const authHeaders = { apikey: pub, Authorization: "Bearer " + token };

    // Validate the user and get the uid (used to scope the write-back).
    const userResp = await fetch(url + "/auth/v1/user", { headers: authHeaders });
    if (!userResp.ok) return jsonResponse(401, { error: "Invalid or expired session" });
    const userJson = await userResp.json();
    const uid = userJson && userJson.id;
    if (!uid) return jsonResponse(401, { error: "Could not resolve user" });

    // Prior narrative + live intake from the case row.
    let intake = {}, priorNarrative = "";
    const caseResp = await fetch(url + "/rest/v1/cases?select=intake,context_narrative", { headers: authHeaders });
    if (caseResp.ok) {
          const rows = await caseResp.json();
          if (rows[0]) { intake = rows[0].intake || {}; priorNarrative = rows[0].context_narrative || ""; }
    }

    // ONLY the most recent session's transcript (cost control: limit=1).
    let transcript = [];
    const sessResp = await fetch(url + "/rest/v1/sessions?select=transcript&order=created_at.desc&limit=1", { headers: authHeaders });
    if (sessResp.ok) { const s = await sessResp.json(); if (s[0]) transcript = s[0].transcript || []; }

    if ((!transcript || transcript.length === 0) && !priorNarrative) {
          return jsonResponse(200, { recap: "", narrative: "", note: "nothing to summarize yet" });
    }

    const transcriptText = (transcript || [])
          .map((m) => (m.role === "user" ? "Parent" : "Advocate") + ": " + (m.content || ""))
          .join("\n\n");
    const userMsg =
          "PRIOR NARRATIVE (your last briefing — may be empty on the first run):\n" +
          (priorNarrative || "(none yet)") +
          "\n\nINTAKE (validated structured facts — ground against these; do NOT re-list them):\n" +
          JSON.stringify(intake) +
          "\n\nMOST RECENT SESSION TRANSCRIPT (fold THIS into the prior narrative):\n" +
          (transcriptText || "(no messages)");

    let aData;
    try {
          const aResp = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
                  body: JSON.stringify({
                            model: DEFAULT_MODEL,
                            max_tokens: 1500,
                            system: REGENERATE_PROMPT,
                            messages: [{ role: "user", content: userMsg }],
                            tools: [SUMMARY_TOOL],
                            tool_choice: { type: "tool", name: "save_case_summary" },
                  }),
          });
          aData = await aResp.json();
    } catch (e) {
          return jsonResponse(502, { error: "Couldn't reach the language model" });
    }
    const tool = aData && aData.content && aData.content.find((b) => b.type === "tool_use" && b.name === "save_case_summary");
    if (!tool || !tool.input) return jsonResponse(502, { error: "Regeneration produced no summary" });
    const recap = tool.input.recap || "";
    const narrative = tool.input.narrative || "";

    // Write back: upsert this user's row under RLS (preserves intake/formal_fields).
    const writeResp = await fetch(url + "/rest/v1/cases?on_conflict=user_id", {
          method: "POST",
          headers: { apikey: pub, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ user_id: uid, recap, context_narrative: narrative, last_session_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    if (!writeResp.ok) {
          const t = await writeResp.text();
          return jsonResponse(500, { error: "Write-back failed", detail: t.slice(0, 200) });
    }
    return jsonResponse(200, { recap, narrative });
}

exports.handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
          return {
                  statusCode: 204,
                  headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "POST, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type, Authorization",
                  },
                  body: "",
          };
    }

    if (event.httpMethod !== "POST") {
          return {
                  statusCode: 405,
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ error: "Method not allowed" }),
          };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
          console.error("ANTHROPIC_API_KEY is not set in Netlify environment variables.");
          return {
                  statusCode: 500,
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                            error: "Server configuration error: API key not set. The site owner needs to add ANTHROPIC_API_KEY in Netlify site settings.",
                  }),
          };
    }

    const ip = getClientIP(event.headers || {});
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
          return {
                  statusCode: 429,
                  headers: {
                            "Content-Type": "application/json",
                            "Retry-After": String(rateCheck.retryAfter),
                  },
                  body: JSON.stringify({
                            error: `Too many requests. Please wait ${Math.ceil(rateCheck.retryAfter / 60)} minutes and try again.`,
                  }),
          };
    }

    let body;
    try {
          body = JSON.parse(event.body || "{}");
    } catch (e) {
          return {
                  statusCode: 400,
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ error: "Invalid JSON in request body" }),
          };
    }

    // Action router: the chat proxy is the default; "regenerate" rebuilds this
    // user's recap + context_narrative server-side (Commit 4).
    if (body.action === "regenerate") {
          return await handleRegenerate(event, apiKey);
    }

    // Normalise model: if client sends an unknown/deprecated model, substitute default.
    if (!body.model || !VALID_MODELS.includes(body.model)) {
          body.model = DEFAULT_MODEL;
    }

    // Server-side context assembly (authenticated turns only): if the request
    // carries a valid user token, append this parent's stored case narrative to
    // the system prompt. No token / invalid / expired → unchanged anonymous path.
    const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
    if (authz.indexOf("Bearer ") === 0) {
          const narrative = await fetchCaseNarrative(authz.slice(7));
          if (narrative) {
                  body.system =
                            (body.system || "") +
                            "\n\n--- CASE MEMORY (what you learned in earlier conversations with this parent; treat it as known context, but you do NOT know what they've done since — ask) ---\n" +
                            narrative;
          }
    }

    try {
          const upstream = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                            "Content-Type": "application/json",
                            "x-api-key": apiKey,
                            "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify(body),
          });

      const responseText = await upstream.text();

      return {
              statusCode: upstream.status,
              headers: { "Content-Type": "application/json" },
              body: responseText,
      };
    } catch (e) {
          console.error("Upstream API call failed:", e);
          return {
                  statusCode: 502,
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                            error: "Couldn't reach the language model. Please try again in a moment.",
                  }),
          };
    }
};
