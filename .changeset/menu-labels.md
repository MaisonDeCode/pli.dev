---
"@pli.dev/react": minor
"@pli.dev/sheets-react": minor
"@pli.dev/decks-react": minor
"@pli.dev/pdf-react": minor
---

Rename or remove the built-in menus and items. `menuLabels` on `PliDocument`, `PliSheet`, `PliDeck` and `PliPdf` takes the text a menu or item has now and what to show instead, or `false` to remove it: `menuLabels={{ "File > Download": "Export", "DOCX document (.docx)": "Word file", "Insert > Page break": false }}`. A key is the text as it is, which applies wherever it appears, or a path (`"File > Download"`) for one item. Renamed items keep their action, shortcut and state; removing a submenu's last item removes the submenu, and the lines left over are tidied. It is also the way to translate the menus. `relabelMenus` and the `MenuLabels` type are exported, and `extendMenus` takes the labels as a third argument.
