// Storage cross-user RLS gate for the Step 3 `generated-docs` bucket.
//
// Hard gate (same status as the Step 2 table RLS matrix): proves that user B
// cannot list/download/upload/delete anything in user A's folder, that an
// anonymous (no-session) caller is denied all four, and that user A CAN do all
// four in its own folder. Must pass and be shown to the owner BEFORE any real
// file is written to the bucket (Commit 4).
//
// No secrets in this file — credentials come from env. Run server-side, e.g.:
//   SUPABASE_URL=... PUB_KEY=... \
//   A_EMAIL=... A_PASS=... B_EMAIL=... B_PASS=... \
//   node scripts/storage-rls-gate.mjs
//
// Uses the raw Storage REST API (Node 18+ global fetch) so there is no
// supabase-js dependency. Cleans up its own test objects on the way out.

const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.PUB_KEY;
const BUCKET = "generated-docs";

const accounts = {
  A: { email: process.env.A_EMAIL, pass: process.env.A_PASS },
  B: { email: process.env.B_EMAIL, pass: process.env.B_PASS },
};

function need(name, val) {
  if (!val) { console.error(`Missing env: ${name}`); process.exit(2); }
}
need("SUPABASE_URL", URL_);
need("PUB_KEY", PUB);
for (const k of ["A", "B"]) {
  need(`${k}_EMAIL`, accounts[k].email);
  need(`${k}_PASS`, accounts[k].pass);
}

const results = [];
function record(actor, op, target, status, ok, raw) {
  const verdict = ok ? "PASS" : "FAIL";
  results.push({ actor, op, target, status, verdict });
  const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);
  console.log(
    `[${verdict}] ${actor} ${op} ${target} -> HTTP ${status}\n` +
    `        raw: ${(rawStr || "").slice(0, 300)}`
  );
}

async function signIn(email, pass) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    console.error(`Sign-in failed for ${email}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    process.exit(2);
  }
  return { token: j.access_token, uid: j.user.id };
}

// authMode: "user" -> Bearer user token; "anon" -> apikey only, no Authorization.
function headers(token, authMode, extra = {}) {
  const h = { apikey: PUB, ...extra };
  if (authMode === "user") h.Authorization = `Bearer ${token}`;
  return h;
}

async function uploadObj(token, authMode, path, body) {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: headers(token, authMode, { "Content-Type": "text/plain", "x-upsert": "true" }),
    body,
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text };
}

async function listPrefix(token, authMode, prefix) {
  const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: headers(token, authMode, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefix, limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  let j; try { j = await r.json(); } catch (e) { j = []; }
  return { status: r.status, ok: r.ok, body: j, names: Array.isArray(j) ? j.map((o) => o.name) : [] };
}

async function downloadObj(token, authMode, path) {
  const r = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${path}`, {
    method: "GET",
    headers: headers(token, authMode),
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text };
}

async function deleteObj(token, authMode, path) {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: headers(token, authMode),
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text };
}

// True if A's canonical object is visible in A's own folder right now.
async function aFileExists(A, path) {
  const r = await listPrefix(A.token, "user", `${A.uid}/`);
  return r.names.includes(path.split("/").slice(1).join("/"));
}

(async () => {
  console.log(`=== Storage cross-user RLS gate :: bucket "${BUCKET}" ===\n`);
  const A = await signIn(accounts.A.email, accounts.A.pass);
  const B = await signIn(accounts.B.email, accounts.B.pass);
  console.log(`A uid: ${A.uid}\nB uid: ${B.uid}\n`);

  const A_PATH = `${A.uid}/gate-A.txt`;
  const A_REL = "gate-A.txt";
  const B_INTRUSION = `${A.uid}/gate-B-intrusion.txt`;
  const ANON_INTRUSION = `${A.uid}/gate-anon-intrusion.txt`;

  // ---- SETUP / A-own happy path: A uploads into its own folder. ----
  console.log("--- A on its OWN folder (all four must SUCCEED) ---");
  {
    const r = await uploadObj(A.token, "user", A_PATH, "owned-by-A");
    record("A", "UPLOAD", A_PATH, r.status, r.ok, r.body);
  }
  {
    const r = await listPrefix(A.token, "user", `${A.uid}/`);
    record("A", "LIST", `${A.uid}/`, r.status, r.ok && r.names.includes(A_REL), r.names);
  }
  {
    const r = await downloadObj(A.token, "user", A_PATH);
    record("A", "DOWNLOAD", A_PATH, r.status, r.ok && r.body.includes("owned-by-A"), r.body);
  }

  // ---- B against A's folder (all four must be DENIED). ----
  console.log("\n--- B against A's folder (all four must be DENIED) ---");
  {
    const r = await listPrefix(B.token, "user", `${A.uid}/`);
    // Denied = RLS filters A's rows out: B sees an empty list (no A object).
    record("B", "LIST", `${A.uid}/`, r.status, !r.names.includes(A_REL), r.names);
  }
  {
    const r = await downloadObj(B.token, "user", A_PATH);
    record("B", "DOWNLOAD", A_PATH, r.status, !r.ok, r.body);
  }
  {
    const r = await uploadObj(B.token, "user", B_INTRUSION, "B-tried-to-write-here");
    record("B", "UPLOAD", B_INTRUSION, r.status, !r.ok, r.body);
  }
  {
    await deleteObj(B.token, "user", A_PATH);
    const stillThere = await aFileExists(A, A_PATH);
    // Denied = A's file still exists after B's delete attempt.
    record("B", "DELETE", A_PATH, "(verify-after)", stillThere, `A's file still present: ${stillThere}`);
  }

  // ---- Anonymous (no session) against A's folder (all four DENIED). ----
  console.log("\n--- ANON (no session, apikey only) against A's folder (all four must be DENIED) ---");
  {
    const r = await listPrefix(null, "anon", `${A.uid}/`);
    record("anon", "LIST", `${A.uid}/`, r.status, !r.names.includes(A_REL), r.names);
  }
  {
    const r = await downloadObj(null, "anon", A_PATH);
    record("anon", "DOWNLOAD", A_PATH, r.status, !r.ok, r.body);
  }
  {
    const r = await uploadObj(null, "anon", ANON_INTRUSION, "anon-tried-to-write-here");
    record("anon", "UPLOAD", ANON_INTRUSION, r.status, !r.ok, r.body);
  }
  {
    await deleteObj(null, "anon", A_PATH);
    const stillThere = await aFileExists(A, A_PATH);
    record("anon", "DELETE", A_PATH, "(verify-after)", stillThere, `A's file still present: ${stillThere}`);
  }

  // ---- A deletes its own file (the 4th A-own success + primary cleanup). ----
  console.log("\n--- A deletes its OWN file (must SUCCEED; also cleanup) ---");
  {
    const r = await deleteObj(A.token, "user", A_PATH);
    const gone = !(await aFileExists(A, A_PATH));
    record("A", "DELETE", A_PATH, r.status, r.ok && gone, `${r.body} | gone: ${gone}`);
  }

  // ---- Defensive cleanup: remove any stray intrusion objects if a FAIL let
  // them through (they would live in A's folder, which A owns). ----
  console.log("\n--- Cleanup (remove any stray test objects) ---");
  for (const p of [B_INTRUSION, ANON_INTRUSION, A_PATH]) {
    const r = await deleteObj(A.token, "user", p);
    console.log(`        cleanup DELETE ${p} -> HTTP ${r.status}`);
  }
  const leftover = await listPrefix(A.token, "user", `${A.uid}/`);
  console.log(`        A folder after cleanup: ${JSON.stringify(leftover.names)}`);

  // ---- Summary ----
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`  [${r.verdict}] ${r.actor.padEnd(4)} ${r.op.padEnd(9)} ${r.target}`);
  }
  const failed = results.filter((r) => r.verdict === "FAIL");
  console.log(`\n${failed.length === 0 ? "GATE PASSED ✓ — all cells correct." : `GATE FAILED ✗ — ${failed.length} cell(s) wrong.`}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error("Gate crashed:", e); process.exit(3); });
