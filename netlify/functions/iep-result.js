// Polling endpoint for IEP analysis jobs.
//
// The browser calls this with ?jobId=XXX to check whether the background
// function has finished. Returns:
//   { status: "processing", stage: "extracting" | "flagging" }
//   { status: "done", extraction, flags }
//   { status: "error", error }
//   { status: "pending" }   (job not found yet — background fn hasn't written)

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const jobId = (event.queryStringParameters || {}).jobId;
  if (!jobId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing jobId" }),
    };
  }

  try {
    const store = getStore("iep-jobs");
    const result = await store.get(jobId, { type: "json" });

    if (!result) {
      // Job hasn't been written yet — background fn may still be starting
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "error", error: (e && e.message) || "Lookup failed" }),
    };
  }
};
