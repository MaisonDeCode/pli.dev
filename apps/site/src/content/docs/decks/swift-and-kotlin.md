---
title: Swift and Kotlin
description: Open, edit and save decks in an iPhone, iPad, Mac or Android app with PliDeck, including PPTX and PDF files, comments and live editing.
---

`PliDeck` is Pli.Decks as an engine for Swift and Kotlin. It reads and writes the same decks and files as the [JavaScript package](/decks/getting-started/), and runs in JavaScriptCore and QuickJS. You can read the slides and elements and draw them yourself, or build, change and convert decks inside an app. Install and setup are on the [Swift and Kotlin reference](/platform/swift-and-kotlin/), which also covers people, comments, live editing, storage and scripts for every editor.

**Swift**

```swift
import Pli

let deck = try PliDeck(title: "Launch")
let slide = try deck.slides()[0].id
let box = try deck.addTextBox(slide: slide, x: 40, y: 200, w: 400, h: 40, text: "Quarterly review")
try deck.formatText(slide: slide, ids: [box], patch: ["bold": true, "fontSize": 32, "color": "#c00000"])
try deck.setNotes(slide: slide, notes: "Open with the numbers")

let second = try deck.addSlide(after: slide)
try deck.addChart(slide: second.id, chartType: "column")

let pptx = try deck.exportPptx()                 // Data
let pdf = try deck.exportPdf()                   // one page per slide
```

**Kotlin**

```kotlin
import dev.pli.*

PliDeck(title = "Launch").use { deck ->
    val slide = deck.slides()[0].id
    val box = deck.addTextBox(slide, 40.0, 200.0, 400.0, 40.0, "Quarterly review")
    deck.formatText(slide, listOf(box), mapOf("bold" to true, "fontSize" to 32, "color" to "#c00000"))
    deck.setNotes(slide, "Open with the numbers")

    val second = deck.addSlide(after = slide)
    deck.addChart(second.id, "column")

    val pptx: ByteArray = deck.exportPptx()
    val pdf: ByteArray = deck.exportPdf()
}
```

Sizes and positions are in points from the top left of the slide. A slide's `title` is the text of its title placeholder, and `elements(slide)` gives each element's type, frame, text and placeholder (a placeholder that takes its position from its layout has nil for `x`, `y`, `w` and `h`).

## Editing

Slides (`addSlide`, `duplicateSlides`, `moveSlides`, `deleteSlides`, `setLayout`, `setBackground`, `setTransition`, `setSkipped`), elements (`addTextBox`, `addShape`, `addImage`, `addTable`, `addChart`, `setText`, `formatText`, `setFrame`, `moveBy`, `setFill`, `arrange`, `align`, `group`, `deleteElements`), find and replace across slides and notes, and `undo()` and `redo()`. `setText` keeps the look of the first run, so replacing the words doesn't strip their formatting. For the rest (animations, masters and layouts, table cells), `call("method", arguments)` runs any method of the deck session, and `apply(operations)` applies the JSON operations the editor and live editing use.

## Files

| | Swift | Kotlin |
|---|---|---|
| Open | `PliDeck(pptx:)`, `PliDeck(json:)` | `PliDeck.fromPptx(…)`, `PliDeck(json = …)` |
| Save | `exportPptx()`, `exportPdf(slides:)`, `documentJSON()` | `exportPptx()`, `exportPdf(…)`, `documentJson()` |
| Replace | `importPptx(_:)` | `importPptx(…)` |
| What was lost | `warnings()` | `warnings()` |

The files are the ones the web package reads and writes, with the same [limits](/decks/files/). The PDF has the slides drawn as vectors with text; slides marked skipped are left out unless you list them.

## Comments

A thread is about a slide, an element, or words inside an element, and keeps its place when slides are reordered, duplicated or deleted. In the file, threads are kept in the deck (and in `.pptx` as comments PowerPoint and Google Slides show) unless your own comment store is given.

```swift
let deck = try PliDeck(user: PliUser(id: "ada", name: "Ada"))
let slide = try deck.slides()[0].id
try deck.commentOnSlide(slide: slide, body: "The title is long")
let box = try deck.addTextBox(slide: slide, x: 0, y: 0, w: 10, h: 10, text: "x")
let thread = try deck.commentOnElement(slide: slide, element: box, body: "Too small", mentions: ["grace"])
print(try deck.threadsOn(slide: slide).count)      // 2
print(try deck.threadsOn(slide: slide, element: box).count)   // 1
```

```kotlin
val thread = deck.commentOnElement(slide, box, "Too small", listOf("grace"))
deck.comments.resolve(thread.id)
```

## Live editing

```swift
let deck = try PliDeck(json: saved, user: me)
try deck.sync.start(room: "launch", transport: MySocket())
```

Two people editing different slides, or different elements of one slide, both keep their changes. The sequencer on your server is `createAuthority` with `deckSyncModel`. See [Live editing](/platform/live-editing/).
