// Verifies the PDF-quality detection logic from index.html against mock
// per-page item arrays. Run with: node test-fixtures/verify-detection.js
//
// The functions below are copied from the script block in index.html (which
// runs in the browser via Babel-standalone and has no module system). If you
// change analyzePdfPages / looksMultiColumn / pdfQualityBlocker /
// describePageList there, update them here too. The duplication is the cost
// of keeping the production code in a single inlined script.

// ---------- BEGIN: copy of detection logic from index.html ----------

function analyzePdfPages(pages) {
  const pageCount = pages.length;
  const perPageChars = [];
  const perPageText = [];
  const issues = {
    scannedPages: [],
    rotatedPages: [],
    multiColumnPages: [],
  };
  let totalChars = 0;

  for (let i = 0; i < pageCount; i++) {
    const { rotate, items } = pages[i];
    const pageNum = i + 1;

    if (rotate && rotate !== 0) {
      issues.rotatedPages.push(pageNum);
    }

    let lastY = null;
    let pageText = "";
    const lineStartXs = [];
    let lineHasContent = false;
    for (const item of items) {
      if (!item.str) continue;
      const y = item.y;
      const x = item.x;
      const isNewLine = lastY !== null && y !== null && Math.abs(y - lastY) > 2;
      if (isNewLine) {
        pageText += "\n";
        lineHasContent = false;
      }
      if (!lineHasContent && x !== null && item.str.trim().length > 0) {
        lineStartXs.push(x);
        lineHasContent = true;
      }
      pageText += item.str + " ";
      lastY = y;
    }
    const trimmed = pageText.trim();
    perPageText.push(trimmed);
    perPageChars.push(trimmed.length);
    totalChars += trimmed.length;

    if (trimmed.length < 30) {
      issues.scannedPages.push(pageNum);
    }

    if (looksMultiColumn(lineStartXs)) {
      issues.multiColumnPages.push(pageNum);
    }
  }

  const fullText = perPageText
    .map((t, i) => "\n\n--- Page " + (i + 1) + " ---\n" + t)
    .join("")
    .trim();

  const hadTextLayer = totalChars > 80;
  return { text: fullText, pageCount, hadTextLayer, perPageChars, issues };
}

function looksMultiColumn(lineStartXs) {
  if (lineStartXs.length < 10) return false;
  let minX = Infinity, maxX = -Infinity;
  for (const x of lineStartXs) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const range = maxX - minX;
  if (range < 100) return false;

  const bins = [0, 0, 0, 0, 0];
  for (const x of lineStartXs) {
    let idx = Math.floor(((x - minX) / range) * 5);
    if (idx > 4) idx = 4;
    bins[idx]++;
  }
  const total = lineStartXs.length;
  const leftHeavy = bins[0] > total * 0.2;
  const rightHeavy = bins[3] + bins[4] > total * 0.2;
  const middleLight = bins[2] < total * 0.1;
  return leftHeavy && rightHeavy && middleLight;
}

function pdfQualityBlocker(extractionResult) {
  const { pageCount, issues } = extractionResult;
  if (pageCount === 0) return null;
  const lines = [];

  if (issues.scannedPages.length > 0) {
    const fraction = issues.scannedPages.length / pageCount;
    if (fraction > 0.15 || issues.scannedPages.length >= 2) {
      lines.push(
        issues.scannedPages.length +
          " of " +
          pageCount +
          " pages had no readable text (" +
          describePageList(issues.scannedPages) +
          ") — those pages are likely scans or images, and I'd have to skip them entirely."
      );
    }
  }

  if (issues.rotatedPages.length > 0) {
    lines.push(
      issues.rotatedPages.length +
        " page(s) are rotated (" +
        describePageList(issues.rotatedPages) +
        ") — text on rotated pages often comes out in the wrong order."
    );
  }

  if (issues.multiColumnPages.length > 0) {
    const fraction = issues.multiColumnPages.length / pageCount;
    if (fraction > 0.3) {
      lines.push(
        "Most pages (" +
          describePageList(issues.multiColumnPages) +
          ") use a multi-column layout, which I can't reliably read in order — the text often comes out jumbled."
      );
    }
  }

  if (lines.length === 0) return null;
  return (
    "I'm worried I'd misread this IEP rather than give you nothing:\n\n• " +
    lines.join("\n• ") +
    "\n\nRather than risk a confidently wrong analysis, I'd rather you tell me about the IEP in the chat — services, goals, classification, placement — and I'll work from that."
  );
}

function describePageList(pages) {
  if (!pages || pages.length === 0) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) { prev = n; continue; }
    ranges.push(start === prev ? String(start) : start + "-" + prev);
    start = n;
    prev = n;
  }
  ranges.push(start === prev ? String(start) : start + "-" + prev);
  return "page" + (sorted.length === 1 ? " " : "s ") + ranges.join(", ");
}

// ---------- END: copy of detection logic ----------

// ---------- Mock helpers ----------

// A typical typed IEP page: ~40 lines of text down the left margin, each
// line a few words. Y decreases as we move down the page (PDF convention).
function typedPage({ lines = 40, startY = 750, leftX = 72, lineHeight = 14, rotate = 0 } = {}) {
  const items = [];
  for (let i = 0; i < lines; i++) {
    items.push({ str: "This is a sample IEP line of text " + i + " ", x: leftX, y: startY - i * lineHeight });
  }
  return { rotate, items };
}

// A scanned/image-only page: no extractable text items, or near-none.
function scannedPage({ rotate = 0 } = {}) {
  return { rotate, items: [] };
}

// A multi-column page: lines start at TWO X positions (left column + right
// column), with no text starting in between.
function multiColumnPage({ rotate = 0, linesPerColumn = 20, startY = 750, lineHeight = 14, leftX = 72, rightX = 320 } = {}) {
  const items = [];
  // Interleave so column order in source roughly matches reading order
  for (let i = 0; i < linesPerColumn; i++) {
    items.push({ str: "Left col line " + i + " ", x: leftX, y: startY - i * lineHeight });
  }
  for (let i = 0; i < linesPerColumn; i++) {
    items.push({ str: "Right col line " + i + " ", x: rightX, y: startY - i * lineHeight });
  }
  return { rotate, items };
}

// A page laid out like a table: every row's first item starts at the left,
// then more items at higher X on the same Y. Should NOT trigger the multi-
// column heuristic.
function tablePage({ rotate = 0, rows = 25, startY = 750, lineHeight = 14, columnsX = [72, 200, 350, 500] } = {}) {
  const items = [];
  for (let r = 0; r < rows; r++) {
    for (const x of columnsX) {
      items.push({ str: "cell ", x, y: startY - r * lineHeight });
    }
  }
  return { rotate, items };
}

// ---------- Test harness ----------

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log("  FAIL  " + label + (detail ? "  (" + detail + ")" : ""));
  }
}

function group(name, fn) {
  console.log("\n" + name);
  fn();
}

// ---------- Cases ----------

group("Case 1: 30-page typed single-column IEP (should pass clean)", () => {
  const pages = Array.from({ length: 30 }, () => typedPage());
  const result = analyzePdfPages(pages);
  assert("hadTextLayer true", result.hadTextLayer);
  assert("pageCount 30", result.pageCount === 30);
  assert("no scanned pages flagged", result.issues.scannedPages.length === 0,
    "got: " + JSON.stringify(result.issues.scannedPages));
  assert("no rotated pages flagged", result.issues.rotatedPages.length === 0);
  assert("no multi-column pages flagged", result.issues.multiColumnPages.length === 0,
    "got: " + JSON.stringify(result.issues.multiColumnPages));
  assert("pdfQualityBlocker returns null (no blocker)", pdfQualityBlocker(result) === null);
});

group("Case 2: image-only PDF (should fail hadTextLayer)", () => {
  const pages = Array.from({ length: 10 }, () => scannedPage());
  const result = analyzePdfPages(pages);
  assert("hadTextLayer false", result.hadTextLayer === false);
  assert("all 10 pages flagged as scanned", result.issues.scannedPages.length === 10);
});

group("Case 3: mixed scanned + typed (3 scanned out of 20 typed pages)", () => {
  const pages = [
    typedPage(), typedPage(), typedPage(), typedPage(), typedPage(),
    scannedPage(), // p6
    typedPage(), typedPage(), typedPage(),
    scannedPage(), // p10
    typedPage(), typedPage(), typedPage(),
    scannedPage(), // p14
    typedPage(), typedPage(), typedPage(), typedPage(), typedPage(), typedPage(),
  ];
  const result = analyzePdfPages(pages);
  assert("hadTextLayer true (typed pages have plenty of text)", result.hadTextLayer);
  assert("3 scanned pages detected", result.issues.scannedPages.length === 3,
    "got: " + JSON.stringify(result.issues.scannedPages));
  assert("flagged pages are 6, 10, 14", JSON.stringify(result.issues.scannedPages) === JSON.stringify([6, 10, 14]));
  const blocker = pdfQualityBlocker(result);
  assert("pdfQualityBlocker returns a blocker string", typeof blocker === "string" && blocker.length > 0);
  assert("blocker mentions the specific pages", blocker && /pages 6, 10, 14/.test(blocker),
    "got: " + blocker);
});

group("Case 4: one scanned cover page out of 20 (should NOT block)", () => {
  // 1/20 = 5%, below the 15% threshold AND only 1 page → not a blocker
  const pages = [
    scannedPage(),
    ...Array.from({ length: 19 }, () => typedPage()),
  ];
  const result = analyzePdfPages(pages);
  assert("1 scanned page detected", result.issues.scannedPages.length === 1);
  assert("pdfQualityBlocker returns null (single scanned page below threshold)",
    pdfQualityBlocker(result) === null);
});

group("Case 5: 2 scanned pages out of 20 (SHOULD block — explicit floor)", () => {
  // 2/20 = 10% (still under 15%) but the >=2 absolute floor should fire.
  // Reason: missing 2 pages of an IEP is enough to mislead the parent.
  const pages = [
    scannedPage(),
    scannedPage(),
    ...Array.from({ length: 18 }, () => typedPage()),
  ];
  const result = analyzePdfPages(pages);
  assert("2 scanned pages detected", result.issues.scannedPages.length === 2);
  const blocker = pdfQualityBlocker(result);
  assert("pdfQualityBlocker returns a blocker (absolute-2-page floor)",
    typeof blocker === "string", "got: " + blocker);
});

group("Case 6: rotated pages flagged and blocked", () => {
  const pages = [
    typedPage(),
    typedPage({ rotate: 90 }),
    typedPage(),
    typedPage({ rotate: 270 }),
  ];
  const result = analyzePdfPages(pages);
  assert("2 rotated pages detected", result.issues.rotatedPages.length === 2);
  assert("rotated pages are 2 and 4", JSON.stringify(result.issues.rotatedPages) === JSON.stringify([2, 4]));
  const blocker = pdfQualityBlocker(result);
  assert("blocker fires for rotated pages", typeof blocker === "string");
  assert("blocker mentions rotation", blocker && /rotated/i.test(blocker));
});

group("Case 7: multi-column layout detected (5/5 pages)", () => {
  const pages = Array.from({ length: 5 }, () => multiColumnPage());
  const result = analyzePdfPages(pages);
  assert("all 5 pages flagged multi-column", result.issues.multiColumnPages.length === 5,
    "got: " + JSON.stringify(result.issues.multiColumnPages));
  const blocker = pdfQualityBlocker(result);
  assert("blocker fires (>30% multi-column)", typeof blocker === "string");
  assert("blocker mentions multi-column", blocker && /multi-column/i.test(blocker));
});

group("Case 8: table page should NOT trigger multi-column", () => {
  // 4-column table — every row's first item is at the leftmost X.
  // Detection should see only ONE line-start X cluster (the left).
  const pages = [tablePage()];
  const result = analyzePdfPages(pages);
  assert("table page NOT flagged multi-column", result.issues.multiColumnPages.length === 0,
    "got: " + JSON.stringify(result.issues.multiColumnPages));
});

group("Case 9: one multi-column cover in a 30-page IEP (should NOT block)", () => {
  const pages = [
    multiColumnPage(),
    ...Array.from({ length: 29 }, () => typedPage()),
  ];
  const result = analyzePdfPages(pages);
  assert("1 multi-column page detected", result.issues.multiColumnPages.length === 1);
  // 1/30 = 3% — well under the 30% blocking threshold
  const blocker = pdfQualityBlocker(result);
  assert("pdfQualityBlocker returns null (sub-threshold)", blocker === null,
    "got: " + (blocker || "null"));
});

group("Case 10: describePageList compacting", () => {
  assert("single page formatted",  describePageList([5]) === "page 5");
  assert("two adjacent pages",      describePageList([3, 4]) === "pages 3-4");
  assert("non-adjacent listed",     describePageList([2, 5, 7]) === "pages 2, 5, 7");
  assert("range + singles mixed",   describePageList([1, 2, 3, 7, 9, 10, 11]) === "pages 1-3, 7, 9-11");
  assert("unsorted input sorted",   describePageList([5, 2, 4, 3]) === "pages 2-5");
});

group("Case 11: extremely short typed IEP (1 page, 1 line) — edge case", () => {
  // A real edge case: a single page with a few words. Above the 30-char
  // threshold? Depends on the line. Make sure we don't crash and don't
  // erroneously block.
  const pages = [{
    rotate: 0,
    items: [
      { str: "Student Name: Sample Student ", x: 72, y: 750 },
      { str: "Classification: Speech or Language Impairment ", x: 72, y: 736 },
      { str: "Speech: 2x30 min individual ", x: 72, y: 722 },
    ],
  }];
  const result = analyzePdfPages(pages);
  assert("hadTextLayer true", result.hadTextLayer);
  assert("no scanned pages", result.issues.scannedPages.length === 0);
  assert("no blocker", pdfQualityBlocker(result) === null);
});

group("Case 12: text reconstruction preserves line breaks", () => {
  const pages = [typedPage({ lines: 5 })];
  const result = analyzePdfPages(pages);
  const page1 = result.text.split("--- Page 1 ---\n")[1];
  const lineCount = page1.split("\n").filter((l) => l.trim().length > 0).length;
  assert("5 input lines become 5 output lines", lineCount === 5, "got: " + lineCount + " — " + JSON.stringify(page1));
});

// ---------- Summary ----------

console.log("\n========================================");
console.log("Result: " + pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log("  - " + f.label + (f.detail ? "  (" + f.detail + ")" : ""));
  }
  process.exit(1);
}
process.exit(0);
