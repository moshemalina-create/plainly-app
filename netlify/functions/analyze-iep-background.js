// Netlify Background Function — IEP analysis.
//
// Background functions can run up to 15 minutes (vs 30s for regular functions),
// which is what the two-stage IEP analysis (extract PDF -> flag) needs.
//
// Because background functions return 202 immediately and run detached, they
// can't return the result to the caller directly. Instead this function writes
// the result to Netlify Blobs keyed by a jobId the browser generated. The
// browser then polls iep-result.js until the result appears.
//
// File MUST be named with the "-background" suffix for Netlify to treat it as
// a background function: analyze-iep-background.js
//
// Requires ANTHROPIC_API_KEY in the environment.

const { getStore } = require("@netlify/blobs");

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

async function callAnthropic(apiKey, payload) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

// Pull text out of a Claude response and parse JSON (handles fenced blocks)
function parseClaudeJSON(data) {
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  // Try direct parse, then fenced, then first balanced object
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === "{") depth++;
      if (c === "}") { depth--; if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch {}
        break;
      } }
    }
  }
  throw new Error("Could not parse JSON from model response");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let jobId, store;

  try {
    const body = JSON.parse(event.body || "{}");
    jobId = body.jobId;
    const pdfBase64 = body.pdfBase64;
    const extractPrompt = body.extractPrompt;
    const flagPrompt = body.flagPrompt;
    const parentContext = body.parentContext || {};

    if (!jobId) {
      return { statusCode: 400, body: "Missing jobId" };
    }

    store = getStore("iep-jobs");

    if (!apiKey) {
      await store.setJSON(jobId, {
        status: "error",
        error: "Server configuration error: API key not set.",
      });
      return { statusCode: 202, body: "accepted" };
    }

    // Mark as processing
    await store.setJSON(jobId, { status: "processing", stage: "extracting" });

    // Stage A — extraction (PDF input)
    const extractData = await callAnthropic(apiKey, {
      model: MODEL,
      max_tokens: 4000,
      system: extractPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            {
              type: "text",
              text: "Extract this IEP into the structured schema described in the system prompt. Return ONLY the JSON object.",
            },
          ],
        },
      ],
    });
    const extraction = parseClaudeJSON(extractData);

    await store.setJSON(jobId, { status: "processing", stage: "flagging", extraction });

    // Stage B — flagging (text input)
    const flagData = await callAnthropic(apiKey, {
      model: MODEL,
      max_tokens: 4000,
      system: flagPrompt,
      messages: [
        {
          role: "user",
          content:
            "Identify the most relevant facts in this IEP that could support a colorable due process claim, and pair each with a question for the parent.\n\n" +
            "iep_extraction:\n" + JSON.stringify(extraction, null, 2) +
            "\n\nparent_context:\n" + JSON.stringify(parentContext, null, 2),
        },
      ],
    });
    const flags = parseClaudeJSON(flagData);

    // Store the final result
    await store.setJSON(jobId, { status: "done", extraction, flags });

    return { statusCode: 202, body: "done" };
  } catch (e) {
    try {
      if (store && jobId) {
        await store.setJSON(jobId, {
          status: "error",
          error: (e && e.message) || "IEP analysis failed.",
        });
      }
    } catch {}
    // Background functions: return 202 regardless; the error is recorded in the store
    return { statusCode: 202, body: "error" };
  }
};
