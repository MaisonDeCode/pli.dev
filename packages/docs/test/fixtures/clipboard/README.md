# Clipboard fixtures

What other applications really put on the clipboard, for the rich paste tests (`clipboard-fixtures.test.ts`).

To add one: select some content in the application, copy it, then from the repository root run

```sh
swift scripts/capture-clipboard.swift word-heading-list-table
```

Name it `<application>-<what>`: `word-...`, `google-docs-...`, `excel-range`, `numbers-range`, `pages-...`. Copy only content that is fine to keep in a public repository. A good sample has a heading, a bulleted and a numbered list, bold, italic, a colored word, a link and a small table.
