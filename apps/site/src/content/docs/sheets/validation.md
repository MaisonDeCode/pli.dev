---
title: Data validation
description: Rules for what may be typed into cells, with messages, lists and limits read from cells (in other workbooks too), rules that fill carries along, and a way to find the cells that break them, in the model, the grid editor and XLSX files.
---

A validation says what may be typed into some cells. Entries that break it are refused, or asked about, with a message you write or one Pli makes from the rule. Validations are part of the workbook, so they are saved in its JSON, undone with the cells, and written to and read from Excel files.

The playground's **Formatting** sheet has an order form (columns I to L) with one of each: try typing a 12 into Quantity, or a colour that isn't in the list.

## The rules

`sheet.validations` is a list; for a cell, the first rule that covers it counts. A rule applies to one or more `ranges` and is one of:

| `kind` | Allows | Also has |
|---|---|---|
| `whole`, `decimal` | a whole number, or any number, compared with `values` | `op`, `values` |
| `date`, `time` | a date or a time (as a serial number) compared with `values` | `op`, `values` |
| `textLength` | text of a length compared with `values` | `op`, `values` |
| `list` | a value that is in the cells `source` points at (a reference, a defined name, or a range in [another workbook](#formulas-and-lists-that-read-other-workbooks)), without regard to capitals | `hideArrow` leaves out the arrow in the cell; [`multiple` and `separator`](#lists-with-several-choices-in-a-cell) allow several items in one cell |
| `custom` | an entry where `formula` is true, worked out with the entry in the cell | `formula` |

`op` is `between`, `notBetween`, `equal`, `notEqual`, `greaterThan`, `greaterThanOrEqual`, `lessThan` or `lessThanOrEqual`, and `values` has two items for the first two and one for the rest. Values and formulas are written without `=`; a value can be a number, a date formula such as `DATE(2024,1,1)`, or a cell (in [another workbook](#formulas-and-lists-that-read-other-workbooks) too), and a cell reference is relative to the top-left cell of the first range, as in Excel.

Every rule can also have:

- `noBlank: true`, to refuse emptying the cell (a blank is let through otherwise).
- `alert`: `stop` refuses the entry (the default), `warning` and `information` ask first and keep the entry if the person says so, `none` lets it in without a word.
- `errorTitle` and `error`, the words said about a refused entry (the rule is described in a sentence when `error` is missing: "Enter a whole number between 1 and 10.").
- `promptTitle` and `prompt`, a note shown beside the cell while it is selected.

```ts
session.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2:B20"], prompt: "From 1 to 10" });
session.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$5", ranges: ["C2:C20"] });
session.addValidation("Sheet1", { kind: "custom", formula: "COUNTIF($D$2:$D$20,D2)=1", ranges: ["D2:D20"], alert: "warning", error: "That is already used." });

session.setCell("Sheet1", "B3", 11);          // throws "Enter a whole number between 1 and 10."
session.setCell("Sheet1", "B3", 11, { validate: false }); // puts it in anyway
session.checkEntry("Sheet1", "B3", 11);       // { alert: "stop", title: "Invalid entry", message: "…" }, or null if it is fine
session.invalidCells("Sheet1");               // the cells that already break their rule: ["B3"]
session.validationChoices("Sheet1", "C2");    // the values a list offers
```

`setCell` and `setCells` refuse an entry only for a `stop` rule, as a strict dropdown does; `warning` and `information` are for the caller to ask about (`checkEntry` says which), and `setValues`, pasting, filling and copying put values in without checking unless you ask for [that](#checking-what-a-paste-brings-in), as Excel does. A formula typed into a cell is checked by what it works out to (Excel doesn't check formulas): `=5*5` is refused in a cell that allows 1 to 10, while an error result or an empty one is let through.

Validations follow inserted rows and renamed sheets like formulas do, and a rule whose cells are all deleted goes. `clearValidation(sheet, range)` takes the rules off a range, and `updateValidation`, `deleteValidation` and `addValidation` (with an `index`) change the list.

Choices typed straight in, such as `red, green, blue`, are a [dropdown cell](/sheets/grid/#checkboxes-dropdowns-and-badges) rather than a validation rule: they can have colours, several choices (with [a separator of your own](#a-separator-for-dropdown-cells)) and a picture, and are written to Excel as a list.

## Lists with several choices in a cell

Excel has no setting for this, but Google Sheets does, and so does a Pli dropdown cell. A list rule with `multiple: true` lets a cell hold several of the list's items joined with `separator` (", " when missing); every item is checked against the list, so `red, green` passes and `red, pink` doesn't. An item that itself holds the separator is also fine when it is the whole entry.

```ts
session.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$5", ranges: ["C2:C20"], multiple: true, separator: "; " });
session.pickChoice("Sheet1", "C2", "red");     // C2 is "red"
session.pickChoice("Sheet1", "C2", "green");   // C2 is "red; green"
session.pickChoice("Sheet1", "C2", "red");     // picking a chosen item takes it off: "green"
session.validationSelection("Sheet1", "C2");   // ["green"]
```

This is the same thing a [dropdown cell](/sheets/grid/#checkboxes-dropdowns-and-badges) does with **Allow choosing several** (`pickChoice` works for both). Pick the dropdown cell when you want colours and a picture for each choice; pick the list rule when the choices live in cells, or you want an alert that asks instead of refusing. In the grid the arrow opens the list with a tick against each chosen item; picking toggles an item and the list stays open until **Done**. The Data validation dialog has **Allow choosing several in a cell** and a separator for lists read from cells (typed choices become a dropdown cell, whose separator is always a comma and a space).

In an XLSX file the rule is written as the plain list it is, so Excel shows it as an ordinary dropdown. Excel would refuse a cell holding two items, so Pli writes such a list with the **Information** alert whatever its own alert is (Excel then only informs, and Continue keeps the entry). What Excel has no place for goes in an extension of the sheet that Excel ignores (`ext` with the uri `{7D0F9A2E-5C1B-4E83-9A47-3B6E1F2C8D55}`, a `validations` list of `validation` elements keyed by the rule's `sqref` with `multiple`, `separator`, the rule's real `alert` and, for external lists, the `read` day). Pli reads it back; a file saved by Excel loses it, and the rule becomes a plain list.

## A separator for dropdown cells

A dropdown cell that allows several choices joins them with `, ` unless its control says otherwise. `separator` (one to eight characters) is the text between the choices kept in the cell; `badge` controls that allow several have it too.

```ts
session.setControl("Sheet1", "A2:A9", { type: "dropdown", options: [{ value: "Red" }, { value: "Green" }, { value: "Blue" }], multiple: true, separator: "; " });
session.pickChoice("Sheet1", "A2", "Red");
session.pickChoice("Sheet1", "A2", "Blue");    // A2 is "Red; Blue"
```

Spaces around the separator are not part of the choices (`Red;Green` and `Red; Green` both hold the same two), a strict dropdown checks every choice in the cell, and a workbook with a separator on a control that does not allow several choices, or one longer than eight characters, is refused when it is loaded. In the grid, **Insert > Dropdown…** (and the typed choices in **Data > Data validation…**) show a Separator field once **Allow choosing several** is ticked.

In an XLSX file the choices are written as the plain list Excel has, and Excel does not complain about what is in the cell, because the list never refuses (`showErrorMessage` is off, so `Red; Blue` is fine). What Excel has no place for goes in the extension of the sheet that Excel ignores, as for list rules: that the cells take several choices, the separator and whether other entries are refused. Pli reads them back; a file saved by Excel loses them and the cells become ordinary one-choice dropdowns. The choices' colours, descriptions and pictures are not in the file, as for every dropdown.

## Formulas and lists that read other workbooks

Validation rules can read cells of other workbooks, and so can cell formulas and defined names. A list rule's `source` can name a range in another workbook, written as Excel shows it: `[Prices.xlsx]Sheet1!$A$1:$A$10`, or `'[Price list.xlsx]My sheet'!$A$1:$A$10` when a name has a space. Pli never opens that workbook itself. The host gives the session a **resolver**, which is asked for the workbook's name and the rest of the source (`Sheet1!$A$1:$A$10`) and answers with the cells' values, row by row (or `null` when it can't find them). It may answer later, so it can fetch a file or ask a server.

```ts
const session = new SheetSession(workbook, {
  externalLists: async (book, ref) => (await loadBook(book))?.cells(ref) ?? null,
});
session.addValidation("Orders", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$10", ranges: ["B2:B50"] });

await session.refreshExternalLists();          // { updated: 1, unchanged: 0, failed: [], offline: false }
session.validationChoices("Orders", "B2");     // the items it read
session.externalListStatus("Orders", "B2");    // { book, ref, items, state: "fresh", read: "2025-12-09" }
```

In `<PliSheet externalLists={…} />` the same resolver is given as a prop, and the lists are read when the editor opens and from **Data > Refresh links to other workbooks** (it is greyed out when nothing in the workbook reads another workbook). What is read is kept **in the workbook**: the rule gets a `snapshot` with the items (blank cells as `""`, so the cells line up) and the day they were read. It is stored without a step of its own in the undo history, and only when the items changed.

When the resolver is missing, or can't find the workbook, or hasn't been asked yet, the list still works from the snapshot. `externalListStatus` then says `stale` (and why: "This workbook can't read Prices.xlsx, so the list is the copy saved on 2025-12-09."), or `missing` when there is no snapshot either and the list is empty. The grid's list shows "From Prices.xlsx" when it was just read, and "From Prices.xlsx, read 2025-12-09 (may be out of date)" otherwise, and the Data validation dialog says the same for the active cell.

### Limits, custom formulas and cells

The same spelling works anywhere a formula is written. A limit (`values`), a `custom` formula, a defined name and a cell formula can all name a sheet of another workbook, and read its cells like any other range:

```ts
session.setExternalCells("Prices.xlsx", "Sheet1", { A2: "Pens", B2: 2.5, A3: "Paper", B3: 4 }); // or let the host's resolver do it
session.addValidation("Orders", { kind: "decimal", op: "lessThanOrEqual", values: ["[Prices.xlsx]Sheet1!$B$2"], ranges: ["C2:C9"] });
session.addValidation("Orders", { kind: "custom", formula: "COUNTIF([Prices.xlsx]Sheet1!$A$2:$A$9,B2)>0", ranges: ["B2:B9"] });
session.defineName("Items", "[Prices.xlsx]Sheet1!$A$2:$A$9");     // a list rule's source can be this name
session.setCell("Orders", "E1", "=SUM([Prices.xlsx]Sheet1!B2:B3)");
```

A reference such as `[Prices.xlsx]Sheet1!B2` reads a sheet of that name, written the way Excel writes it (`'[Price list.xlsx]My sheet'!B2` when a name has a space), and everything that reads ranges works on it: `SUM`, `COUNTIF`, `VLOOKUP`, `INDEX`, `XLOOKUP`, a defined name, relative references in a rule (they move with the cell, as everywhere), copying and filling. What it reads is the copy the workbook keeps: `Workbook.externalBooks`, one entry for each file, with the `path` the file named, the day it was `read` and its `sheets` as `{ address: value }` (numbers stay numbers; blank cells are left out). Nothing is read from the file itself.

- `session.setExternalCells(book, sheet, cells, { path, read, history })` puts cells in (a `null` takes one away). It is an undo step unless `history` is false; the workbook recalculates, and bad addresses or values are refused.
- The host's `externalLists` resolver also fills it: **Data > Refresh links to other workbooks** and `session.refreshExternalLists()` ask it for every range that formulas, names and rules read (as `Sheet1!$B$2` or `Sheet1!$B$2:$C$9`, a list of values row by row) and store the answers with today's date, without a step of their own in the undo history. The result counts these ranges with the lists; one that could not be read is in `failed` with the `ref` that was asked for, and its copy stays in use.
- `session.externalReferences()` lists every range of another workbook that something reads, with `by` (`cell`, `name` or `validation`), a `state` (`fresh`: read in this session; `stale`: the copy kept in the workbook is used; `missing`: nothing is kept, so a formula gives `#REF!`) and, for a stale one, why. The Data validation dialog says the same for the rules on the active cell.
- A reference to a workbook that has not been read is `#REF!` in a cell formula. A validation limit, a custom formula or a list that cannot be read is not held against the entry: it goes in, as Excel does when it cannot get at a link.
- A range of a whole column or row, or of more than 10,000 cells, can be read from the kept copy but cannot be asked of the resolver.

In an XLSX file Excel keeps this the way it keeps any reference to another workbook: the workbook lists its `externalReferences`, each an `externalLink` part that names the file (`Prices.xlsx`, or the path Excel wrote) and holds the cells that were read from it, and a formula, a defined name or a rule says `[1]Sheet1!$B$2`, where 1 counts the references. Pli writes those parts from what the workbook keeps (and from the copies kept by list rules), numbering the files in the order it meets them, so Excel shows the values before the other workbook is opened (it may show its bar about links being disabled), and reads them back, with the path and the cell types (numbers, text and true/false). Excel can't resolve a validation source outside the workbook when it is written in the sheet's extension list (`[1]Sheet1!…`, `'[Prices.xlsx]Sheet1'!…` and a full path all came back from Excel as `…!#REF!`), so a rule that reads another workbook is written from the values Pli keeps: a list as a plain list of the items it has (when none has a comma or quote and they fit in 255 characters), a limit as the value of the cell it reads, with the same `type`, `operator`, alert and messages as any other rule. A rule with a formula over a range (`custom`) has no such form and is left out of the part of the file Excel reads. Pli's extension (`pli:external`) holds every such rule whole, so Pli reads the file back as the rule that reads the other workbook, not as a plain list. Cell formulas and defined names are written in the usual places. The day the cells were read is kept in Pli's extension of the link, with the table places of [tables in other workbooks](/sheets/tables/#tables-in-other-workbooks).

## Filling carries the rule

Excel's Fill Down, Fill Right and the fill handle copy a cell's data validation along with its value, and so do `fill` and `autofill`. Each cell filled gets the rule that covers the cell it was copied from, replacing the rule it had, or none when the cell copied has none (as a paste does). A rule that already covers the cell copied grows over the cells filled, so its relative references keep meaning the same; when a fill upward or to the left moves the rule's top-left corner, its formulas are rewritten from the new corner (a rule `H6>=I6` on H6, filled up to H3, becomes the rule `H3>=I3` on H3:H6, which still reads `H4>=I4` on H4). A fill from several cells repeats each cell's own rule. A rule left with no cells is removed, and one that nothing changes is not touched.

```ts
session.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2"] });
session.fill("Sheet1", "B2:B8", "down");              // the rule now covers B2:B8
session.autofill("Sheet1", "B2", "B2:D2");            // the fill handle: and C2:D2
```

The rules change in the same step as the cells, so one undo takes both back, and the change goes through the same checks as the fill (`validatePaste`, locked cells, merged cells). The grid's Ctrl+D, Ctrl+R, fill handle and selection handles all fill this way.

## Checking what a paste brings in

Excel checks only what is typed. A paste, a move, a fill or a sort puts values in as they are, and a paste over a validated cell brings its own validation along (or none), unless it is **Paste special > Values**. Pli does the same by default, and **Circle invalid data** finds the result. If you want more, set `validatePaste`:

| `validatePaste` | What happens to cells that break the rule that covers them |
|---|---|
| `"off"` (the default) | Nothing: as in Excel. |
| `"warn"` | Everything goes in; a report says which cells break their rule. |
| `"refuse"` | A cell whose new content breaks a **`stop`** rule keeps what it had, and the rest of the paste goes in. A move, a cut copy or a sort can't be done in part, so it is refused as a whole and throws (`Nothing was moved: 2 cells would break a data validation rule (D2, D3).`). Rules that only warn are reported and kept. |

Set it with the `validatePaste` session option, `session.validatePaste = "warn"` at any time, or the `validatePaste` prop of `<PliSheet>`. It covers pasting text, pasting an HTML table, `pasteValues` (Paste special > Values), `copy`, `move`, `fill`, `autofill`, `sort` and `sortTable`; one undo step undoes the whole operation, refused cells included. A formula is checked by what it works out to. An alert of `none` is never reported, and blank and error cells are left alone, as **Circle invalid data** does.

```ts
const session = new SheetSession(workbook, { validatePaste: "refuse" });
session.onPasteReport((report) => console.log(report.refused, report.invalid)); // ["B3"], [{ address: "B3", alert: "stop", value: "50", message: … }]
session.pasteText("Sheet1", "B2", "5\n50\n7");
session.lastPasteReport;                       // the same report; null when the last check found nothing
session.pasteValues({ sheet: "Sheet1", range: "A1:A3" }, { sheet: "Sheet1", at: "B2" }); // Paste special > Values
```

A report has the `action` (`paste`, `copy`, `move`, `fill`, `sort`), the `range` written, the `invalid` cells (address, alert, message, value), the `refused` ones and whether the whole operation was `cancelled`. Cells that were already wrong before a copy, move or sort are not blamed again: a value that was invalid in a sorted range is only being moved about. A copy or move brings its own rules with it (a rule is copied or moved with the cells, and replaces the rules where they land), so a plain copy meets its own rules; **Paste values** is the paste that meets the rules already there. A fill checks what it writes against the rules of the cells it fills, which are the rules of the cells it copies (see [Filling](#filling-carries-the-rule)).

In the grid, **Edit > Paste values** (and the right-click menu) pastes values only. When a checked operation finds cells, a notice under the toolbar says so ("2 cells pasted break a data validation rule (B3, B4). Data > Circle invalid data shows them.") with **Circle** to switch the circles on and **Dismiss**.

## In the grid editor

**Data > Data validation…** sets the rules for the selected cells: what to allow, the limits, whether blanks are ignored, an input message, and what to do with something else. Typed choices in the list's source make a dropdown cell; a range or a name makes a list rule. **Clear all** takes the rules off. **Data > Circle invalid data** draws a red oval round every cell that breaks its rule, until you switch it off.

- Pressing Enter on a refused entry keeps it in the editor, with the reason shown, so it can be corrected; Escape drops it.
- A warning or an information alert asks "Keep the entry anyway?" and keeps the editor open if the answer is no.
- A list shows an arrow in the active cell (and Alt+Down opens it); picking puts the value in the cell. A list that allows several keeps the list open, with ticks, until **Done**.
- The input message appears under the active cell while it is selected.
- Filling (Ctrl+D, Ctrl+R, the fill handle) carries the rule of the cell it copies.
- A limit, a custom formula or a name can read another workbook (`[Prices.xlsx]Sheet1!$B$2`); the dialog says how the copy kept of it stands. **Data > Refresh links to other workbooks** reads them again through the `externalLists` prop.

## In XLSX files

Each rule is a `dataValidation`, with its kind in `type`, the comparison in `operator`, the limits in `formula1` and `formula2`, and the messages as attributes; titles are cut to Excel's 32 characters and messages to 255. A list that reads a range comes back as a list rule. A list typed into the rule (`"a,b,c"`) comes back as a dropdown cell. Lists with several items, dropdown cells with several choices and a separator, and rules, formulas and names that read other workbooks are described above. Excel's "any value" rules (which only carry a message) are ignored, and a rule that is missing its limits or is of a kind Pli doesn't have is left out and named in `warnings`. LibreOffice opens Pli's rules and writes them back as the same rules, and opens the files with formulas that read other workbooks and keeps their links, and the test suite checks that. Excel read the lists and limits on the sheet, and kept the cell formulas and defined names that read another workbook (kit files 23 and 34); what it does with a source outside the workbook is above.

## Not there yet

- Excel has not been seen to resolve any validation source outside its own workbook when it reads a file: every form Pli tried (kit files 23 and 34) came back `#REF!`, so the file holds the values kept (see above) and what Excel would write for a list typed against an open workbook is not known; kit file 53 says what to type in Excel and send back.
- Formulas that read another workbook use the copy kept in the workbook (`externalBooks`) or what the host's resolver answers when asked; nothing updates by itself while the editor is open, and Pli never opens the file. In an XLSX file a reference with a folder in front (`'C:\data\[Prices.xlsx]Sheet1'!A1`, which Excel writes for a link it can't find) is read as the file name alone; typed in the editor it is not read. Two workbooks with the same file name in different folders are one. Conditional formats, charts and pivot tables cannot read another workbook; table formulas can name [a table of one](/sheets/tables/#tables-in-other-workbooks).
- A whole column or row, or a range of more than 10,000 cells, of another workbook can be read from the kept copy but cannot be asked of the resolver.
