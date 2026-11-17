// A CommonJS file can load the packages with import(): they are ES modules and say so.
(async () => {
  for (const name of ["@pli.dev/core", "@pli.dev/docs", "@pli.dev/sheets", "@pli.dev/decks", "@pli.dev/pdf", "@pli.dev/react", "@pli.dev/react/collab", "@pli.dev/sheets-react", "@pli.dev/decks-react", "@pli.dev/pdf-react", "@pli.dev/pdf-react/pdfjs", "@pli.dev/pdf-react/testing"]) {
    const mod = await import(name);
    if (Object.keys(mod).length === 0) throw new Error(`${name} exports nothing`);
  }
  for (const css of ["@pli.dev/react/styles.css", "@pli.dev/sheets-react/styles.css", "@pli.dev/decks-react/styles.css", "@pli.dev/pdf-react/styles.css"]) require.resolve(css);
  console.log("cjs import ok");
})().catch((error) => { console.error(error); process.exit(1); });
