# test-fixtures

Sample IEP PDFs and verification scripts for exercising the upload pipeline
locally without going through the live site.

## What goes here

- **Sample IEPs (`.pdf`)** — real or synthetic NY IEPs that exercise different
  shapes: typed single-column (the easy case), multi-column NYC DOE forms,
  scanned/photographed pages, mixed scanned+typed, rotated pages, very long
  IEPs with many goals/services. These are useful for manual end-to-end
  testing in the browser.
- **Verification scripts (`verify-*.js`)** — Node scripts that exercise
  individual pieces of the pipeline (e.g., the PDF quality detection logic)
  against mock inputs, without needing a live PDF or the Anthropic API.

## Privacy

Do not commit real IEPs — they contain student PII. Either:
1. Use synthetic IEPs you've assembled yourself, or
2. Strip names/DOBs/addresses from real ones before saving here, or
3. Keep them locally and add the filename to `.gitignore`.

The scripts in this directory should work with any sample PDF — they don't
hardcode filenames.

## Running verification scripts

```
node test-fixtures/verify-detection.js
```

The scripts print PASS/FAIL per case and exit non-zero on any failure.
