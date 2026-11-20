# Responder Review (harness)

Flywheel extension app: review derm efficacy photos across visits, record consent-gated marketing decisions, export great-responder images as a PDF.

- Live: launch from a Flywheel project (Viewer app, project match). Reads subjects matching `subject_filter` (default `^SYN-`), parses image filenames `{study}_{subject}_{visit}_D{day}_{lighting}_{view}.{ext}`, writes `subject.info.marketing.{review,review_history}`, uploads PDF reports to project attachments and logs them in `project.info.responder_review.exports`.
- Demo: open `index.html#demo` (synthetic images drawn in the browser).
- Build: copy the Flywheel Vision Design System files into `vds/` (bundle.css, bundle.js, colors.css, fonts/Flywheel-Vision-Icons.woff), then `npm ci && REPO=<url> node build.mjs` → `dist/responder-review.html` (published as `index.html`).
- Tests: `node test/smoke.cjs`, `node test/pdf.cjs`, `node test/live-stub.cjs` (Playwright, stubbed SDK).

Contains no data. Prototype harness; not for marketing or clinical use.
