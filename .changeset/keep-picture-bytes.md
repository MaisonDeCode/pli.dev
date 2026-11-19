---
"@pli.dev/sheets-react": patch
---

"Keep picture in cell" reads the fetched picture's bytes directly, so it works when the response's `Blob` comes from another realm (a web view, a test environment) and could not be wrapped in a `File`.
