---
title: Build your own UI
description: Use the engine, the editing surface or the React hooks to build exactly the interface you want.
---

There are three levels, from most help to least.

| Level | Use | You build |
|-------|-----|-----------|
| 1. Custom toolbar | `PliEditor` + `useSelectionState` + session methods | Toolbar, menus, side panels |
| 2. Custom surface | `DocumentView` + your own input handling | The editing surface itself |
| 3. Headless | `@pli.dev/docs` only | All UI, in any framework or platform |

## What the pieces are

| Piece | What it gives you |
|-------|-------------------|
| `PliEditor` | The editing surface. With `pagination` it also keeps content clear of page boundaries |
| `PageCanvas` | Page sheets, the header and footer, zoom, and pageless mode, around a `PliEditor` |
| `EditorToolbar` | The formatting toolbar for a session |
| `MenuBar`, `Dropdown`, `MenuList`, `ColorPicker` | Menus and pickers, with no knowledge of documents |
| `LinkDialog`, `ImageDialog`, `PageSetupDialog` | Ready-made dialogs |
| `FindPanel`, `OutlinePanel`, `StatusBar` | The panels around the page |
| `DocumentView` | Renders a document to DOM that the selection helpers understand, for previews |
| `paginate` | The layout algorithm on its own: give it measurements, get page gaps back |

`PliDocument` is these pieces put together.

## 1. Your own toolbar around `PliEditor`

`PliEditor` handles typing, selection, shortcuts, clipboard and IME. You supply the controls. `useSelectionState` tells you what is active, so buttons can show their state.

```tsx
import { PliEditor, useDocumentSession, useSelectionState, type PliEditorHandle } from "@pli.dev/react";
import { useRef } from "react";

export function MyEditor() {
  const session = useDocumentSession();
  const editor = useRef<PliEditorHandle>(null);
  const state = useSelectionState(session);

  return (
    <div>
      <button
        aria-pressed={state.marks.bold}
        // Keep the editor's selection: don't let the button take focus on mouse down.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          session.toggleMark("bold");
          editor.current?.focus();
        }}
      >
        Bold
      </button>

      <button disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => session.undo()}>
        Undo
      </button>

      <PliEditor ref={editor} session={session} />
    </div>
  );
}
```

`useSelectionState(session)` returns:

| Field | Meaning |
|-------|---------|
| `marks` | `{ bold, italic, underline, strike, code, superscript, subscript }`, each true when the whole selection has it (or, for a caret, when new text would) |
| `fontFamily`, `fontSize`, `color`, `highlight`, `link` | `{ value, mixed }`: the value of the first selected character, and whether the selection has more than one |
| `format` | Line height, spacing and indents of the first selected paragraph |
| `image` | The image block the caret is on, if any |
| `table` | The table the caret is in: its size, the current row and column, how many rows and columns are selected, header row, borders, the current cell's shading and vertical alignment, the row height, and whether the selection can be merged or split. Null outside a table |
| `block` | The block type of every selected block, such as `{ type: "heading", level: 2 }`, or `null` if they differ |
| `align` | The alignment, or `null` if they differ |
| `canIndent`, `canOutdent` | Whether a list indent or outdent would do anything |

### Session methods for controls

Every command is a method on the session and returns `false` if there was nothing to do. See [Selection and commands](/documents/concepts/selection-and-commands/) for the full list: `toggleMark`, `setMarks`, `setBlockType`, `toggleBlockType`, `indent`, `outdent`, `setAlign`, `undo`, `redo` and more.

For things the toolbar doesn't cover, such as setting a link or a text color, use `setMarks`:

```ts
session.setMarks({ link: "https://pli.dev" });  // link the selected text
session.setMarks({ link: null });               // remove it
session.setMarks({ color: "#b91c1c" });
```

### Re-rendering

`useSelectionState` and `useSessionRevision(session)` re-render your component when the document, selection or pending format changes. Outside React, use `session.subscribe` and `session.onSelectionChange`.

## 2. Your own editing surface

`DocumentView` renders a document to DOM that the selection helpers understand. Each block gets a `data-block-id`, and its DOM text equals the block's text. For a different editing experience, render with `DocumentView` and call the same session commands from your own events. `PliEditor`'s source shows how input events map to commands.

`DocumentView` also works on its own for a read-only preview.

## 3. Headless

`@pli.dev/docs` has no UI dependencies and runs anywhere JavaScript does. Drive it from any framework:

```ts
import { DocumentSession, createDoc, heading, paragraph, caret } from "@pli.dev/docs";

const p = paragraph("Hello");
const session = new DocumentSession(createDoc("Notes", [heading(1, "Notes"), p]));

session.select(caret(p.id, 5));
session.typeText(", world");
session.toggleMark("bold");          // caret only: sets the format for the next typing

session.subscribe(({ state }) => render(state));
session.onSelectionChange((selection) => updateToolbar(selection));
```

Map your platform's input to these calls: key presses to `typeText`, `splitBlock` and `backspace`, taps on buttons to `toggleMark`, and so on. The [Swift](/documents/swift/) and [Kotlin](/documents/kotlin/) packages wrap this same engine and add native text, toolbar and menus.
