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
