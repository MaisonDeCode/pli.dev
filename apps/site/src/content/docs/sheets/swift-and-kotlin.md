---
title: Swift and Kotlin
description: "Open, edit and save workbooks in an iPhone, iPad, Mac or Android app with PliWorkbook: cells that recalculate, XLSX, CSV and PDF files, comments on cells, and live editing."
---

`PliWorkbook` is Pli.Sheets as an engine for Swift and Kotlin: the same workbook, formulas and files as the [JavaScript package](/sheets/getting-started/), running in JavaScriptCore and QuickJS. There is no grid to draw yet; you read the cells and draw them as you like, or use it to read, calculate, change and convert workbooks inside an app. Install and setup are on the [Swift and Kotlin reference](/platform/swift-and-kotlin/), which also covers people, comments, live editing, storage and scripts for every editor.

**Swift**

```swift
import Pli

let book = try PliWorkbook(title: "Budget")
try book.setCells(sheet: "Sheet1", inputs: ["A1": "Item", "B1": "Cost", "A2": "Pens", "B2": 12.5, "A3": "Paper", "B3": 30, "B4": "=SUM(B2:B3)"])
try book.setFormat(sheet: "Sheet1", range: "B2:B4", format: "$#,##0.00")
try book.setStyle(sheet: "Sheet1", range: "A1:B1", style: ["bold": true, "fill": "#ffeeaa"])

let total = try book.cell(sheet: "Sheet1", address: "B4")
print(total.value, total.text, total.formula)    // 42.5, "$42.50", "=SUM(B2:B3)"
print(try book.values(sheet: "Sheet1", range: "A1:B4"))

let xlsx = try book.exportXlsx()                 // Data
let again = try PliWorkbook(xlsx: xlsx)          // and back
```

**Kotlin**

```kotlin
import dev.pli.*

PliWorkbook(title = "Budget").use { book ->
    book.setCells("Sheet1", mapOf("A1" to "Item", "B1" to "Cost", "A2" to "Pens", "B2" to 12.5, "A3" to "Paper", "B3" to 30, "B4" to "=SUM(B2:B3)"))
    book.setFormat("Sheet1", "B2:B4", "$#,##0.00")
    book.setStyle("Sheet1", "A1:B1", mapOf("bold" to true, "fill" to "#ffeeaa"))

    val total = book.cell("Sheet1", "B4")
    println("${total.value} ${total.text} ${total.formula}")   // 42.5 $42.50 =SUM(B2:B3)

    val xlsx: ByteArray = book.exportXlsx()
    PliWorkbook.fromXlsx(xlsx).use { /* and back */ }
}
```

A sheet is named by its name (any case) or its id. Cells are typed as a person would type them: text that starts with `=` is a formula, and numbers, dates and percentages in text become what they look like. A cell comes back as `PliCellInfo`: `value` (JSON; nil when empty or an error), `error` (such as `#DIV/0!`), `text` (the value with its number format applied), `formula` and `format`.

## Editing

Rows and columns, sorting, merges, notes, filters, defined names, sheets and charts are methods too (`insertRows`, `sort`, `mergeCells`, `setNote`, `setFilter`, `defineName`, `addSheet`, `insertChart`), as are `fill`, `autofill` and `copy`, which move formulas' references as a spreadsheet does. `undo()` and `redo()` work on the steps you made. For anything else, `call("method", arguments)` runs any method of the editor's session, and `apply(operations)` applies the JSON operations the editor and live editing use:

```swift
let id = try book.sheets()[0].id
try book.apply([["type": "set_cells", "sheet": .string(id), "cells": ["A1": ["v": 5], "A2": ["f": "A1*2"]]]])
```

`onChange` tells you what changed (the operations, and whether it was yours, undo, redo or someone else's), so a grid you draw can redraw just that:

```swift
book.onChange { change in
    for op in change.operations where op["type"]?.stringValue == "set_cells" { /* redraw those cells */ }
}
```

## Files

| | Swift | Kotlin |
|---|---|---|
| Open | `PliWorkbook(xlsx:)`, `PliWorkbook(csv:)`, `PliWorkbook(json:)` | `PliWorkbook.fromXlsx(…)`, `PliWorkbook.fromCsv(…)`, `PliWorkbook(json = …)` |
| Save | `exportXlsx()`, `exportCsv(sheet:delimiter:)`, `exportPdf(sheet:)` (async), `documentJSON()` | `exportXlsx()`, `exportCsv(…)`, `exportPdf(…)` (suspend), `documentJson()` |
| Replace | `importXlsx(_:)`, `importCsv(_:delimiter:)` | `importXlsx(…)`, `importCsv(…)` |
| What was lost | `warnings()` | `warnings()` |

The XLSX and CSV files are the ones the web package reads and writes, with the same [limits](/sheets/files/). `exportPdf` lays out a sheet the way it prints: its page setup, print area and repeated titles.

## Comments

A comment thread is anchored to a cell or range, by the sheet's id, so renaming the sheet changes nothing:

```swift
let book = try PliWorkbook(user: PliUser(id: "ada", name: "Ada"))
let thread = try book.commentOnRange(sheet: "Sheet1", range: "B2:C3", body: "Is this right? @Grace", mentions: ["grace"])
print(thread.anchor)                               // {"sheet": "...", "cell": "B2", "range": "B2:C3"}
print(try book.threadsAt(sheet: "Sheet1", address: "C3").count)   // 1: the thread's range holds C3
try book.comments.reply(to: thread.id, "Yes")
```

```kotlin
val thread = book.commentOnRange("Sheet1", "B2:C3", "Is this right? @Grace", listOf("grace"))
book.comments.reply(thread.id, "Yes")
```

Roles, your own comment store and `onChange` are on the [reference](/platform/swift-and-kotlin/#comments).

## Live editing

```swift
let book = try PliWorkbook(json: saved, user: me)
try book.sync.start(room: "budget", transport: MySocket())
```

Two people changing different cells, rows or sheets both keep their changes, and they see each other in `sync.peers()`. The sequencer on your server is `createAuthority` with `sheetSyncModel`; see [live editing](/platform/live-editing/).
