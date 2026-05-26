// Netlify Function that proxies requests to Anthropic's API.
//
// The browser sends the same JSON body it would send to Anthropic directly.
// This function adds the API key from the ANTHROPIC_API_KEY env var,
// rate-limits per IP, and forwards the response back.
//
// Configure ANTHROPIC_API_KEY in Netlify: Site settings → Environment variables.

const RATE_LIMIT_PER_IP_PER_HOUR = 100;
const ipRequestCounts = new Map();

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

exports.handler = async (event) => {
  // CORS for any preflight (shouldn't happen since same-origin, but defensive)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
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
