---
title: Collaboration
description: Threaded comments on cells, people and presence, live editing, version history and file storage in Pli.Sheets, with code for each.
---

Comments, people, presence, live editing and file storage are shared by every Pli editor. They live in `@pli.dev/core` and know nothing about spreadsheets. An editor tells them three things: where a comment is anchored, how its operations combine, and where its files are stored.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


| Shared part | What Pli.Sheets adds |
|---|---|
| Comments (`CommentClient`, stores, permissions, @mentions) | `CellAnchor`: which sheet and cell (and range) a thread is about. The cell carries the thread's id, so the thread goes where the cell goes |
| People (`Users`) | Comment authors and the people in the room |
| Presence (`CollabRoom`) | What a person is doing: `{ sheet, selection, editing }` |
| Live editing (`SyncClient`, `createAuthority`) | `sheetSyncModel`: how workbook operations merge |
| Version history (`VersionHistory`) | `sheetVersionSupport`: how a version is restored and summarised |
| File storage (`StorageClient`) | `saveWorkbook`, `loadWorkbook`, `pictureStore`, `storageData`: the workbook, its pictures and its data blocks |

In the editor, all of it is four props: `<PliSheet session={session} users={users} room={room} comments sync />`.

## Comments

Excel has two kinds of comment: the classic yellow **note** (see [Notes](/sheets/grid/#links-and-notes)) and the **threaded comment**, a conversation with replies, @mentions and a resolved state. Pli keeps them separate too, and supports both.

```ts
import { Users } from "@pli.dev/core";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";

const users = new Users({ current: { id: "u_1", name: "Sam" }, search: (q) => directory.find(q) });
const session = new SheetSession(createWorkbook("Budget"));
const comments = session.comments.enable({ users });     // a CommentClient<CellAnchor>

const thread = session.comments.commentOn("Sheet1", "B2", "Is this the final price? @Ana", ["u_2"]);
comments.reply(thread.id, "Yes, see the contract.");
comments.resolve(thread.id);                              // comments.reopen(thread.id) brings it back

session.comments.commentOnRange("Sheet1", "B2:D9", "Check this block");   // sits on B2, remembers the range
session.comments.threadAt("Sheet1", "B2");                // the thread on a cell
session.comments.threadsOn("Sheet1");                     // in reading order
session.comments.placeOf(thread.id);                      // { sheet, cell, range? }: where it is now
```

`session.comments.enable({ users, store?, permissions?, onError? })` returns the same `CommentClient` as the other editors, with `createThread`, `reply`, `editComment`, `deleteComment`, `deleteThread`, `resolve`, `reopen`, `thread(id)`, `subscribe`, and the same roles and permissions (viewers read; commenters add, reply and resolve; editors moderate). `sheetEditorSession(session)` reports `supportsComments` and `comments` once they are on.

A thread's anchor is a `CellAnchor`, plain JSON:

```ts
interface CellAnchor {
  sheet: string;    // the sheet's id, so renaming the sheet changes nothing
  cell: string;     // "B2": where the thread was last seen (the top left cell of range)
  range?: string;   // "B2:D9": the range it was made on
  quote?: string;   // what the cell held when the thread was made
}
```

### How a thread follows its cell

The anchor saved in a thread is a hint. The thread's real place is **the cell that carries its id** (`Cell.thread`), so the thread follows the cell however it moves:

| What happens | What the thread does |
|---|---|
| Rows or columns are inserted or deleted | It moves with its cell. |
| The cells are sorted, or dragged and dropped (cut and paste) | It goes with its cell. |
| The cell is copied | The copy goes without the thread: a thread belongs to one cell. |
| New content is typed over the cell, or *Clear contents* is used | It stays. |
| The sheet is renamed or moved | It stays (sheets are named by id). |
| The cell's row, column or sheet is deleted | It is **detached**: listed in the panel under "The cell was deleted", and attached again if the deletion is undone. `session.comments.detached()` lists them; `attach(id, sheet, cell)` puts one on another cell. |
| The start of the thread is undone | The thread is taken off, and comes back when it is redone. |

A range thread sits on the range's top left cell and keeps the range it was made on for the outline (`placeOf(id).range` is that range from the cell's current place); the range is not stretched when rows are inserted inside it.

### Notes and comments together

A cell can have a note or a thread, as in Excel. The model allows both, but a file can hold only one (see below). `session.comments.noteToComment(sheet, cell)` turns a note into a thread (its text is the first comment) and `commentToNote(sheet, cell)` turns a thread into a note (one line per comment); both are one undo step. In the editor they are *Convert note to comment* and *Convert to note* in the cell menu and the Review menu.

### Where comments are kept

| `store` | Use it when |
|---|---|
| `"document"` (the default) | Comments should travel with the file. They are saved **in the workbook** (`Workbook.comments`), shared with other people by live editing, and written to `.xlsx` files as threaded comments |
| A `CommentStore` of your own | Comments belong to your app and live in your database (the same two functions, `load` and `save`, as in [Comments](/platform/comments/#what-your-store-receives)) |

With your own store the workbook holds only each cell's thread id. To write them into an Excel file anyway, pass them to the writer: `toXlsx(wb, { threads: comments.threads, users: (id) => users.get(id) })`.

### In the editor

`<PliSheet comments users={users} />` turns it on:

- **Comment** in the cell menu, the Insert menu and the Review menu, and **Ctrl+Alt+M** (Cmd+Option+M on a Mac), starts a comment on the selected cell (or range) or opens the one it has.
- A purple mark in the corner of every cell that has a thread (grey when resolved). Pointing at the cell, or selecting it, shows the conversation in a card with replies and Resolve.
- The **Comments** button in the title row opens a panel at the right: every thread of the workbook in sheet order then reading order, filters (Open, Resolved, Mine, Mentions, All), the cell each is about (`Budget!B2`), and the detached ones. Choosing a thread goes to its cell. The panel is `CommentThreads` from `@pli.dev/react/collab`.

### In `.xlsx` files

Threads are written the way Excel 365 writes them and read back the same way:

- `xl/threadedComments/threadedComment1.xml` has each thread's first comment and its replies (`parentId`), with the time, the person (`personId`), `done="1"` for a resolved thread and a `mention` element (where `@Name` starts, and how long it is) for each person mentioned.
- `xl/persons/person.xml` lists the people. The comment's `author` is kept as the person's `userId`; the name is the `displayName` (give `toXlsx` a `users` function to name them). `fromXlsx` returns the people of the file in `people`, so you can add them to your `Users` and see names instead of ids.
- For versions of Excel that don't have threaded comments, each thread also has a classic note that says `[Threaded comment]` and holds the text, written by the author `tc={id}`, as Excel does. Pli leaves those out when it reads, so they don't turn into notes.
- Google Sheets writes and reads threaded comments in the same parts when it exports and imports `.xlsx` files.

What is not kept: Excel has no "who resolved it" (a resolved thread is read back as resolved by its last commenter), and a cell can hold a note or a thread in a file, not both (the thread is written; its cell's note is not). No file with threaded comments written by Pli has been opened in Excel 365 yet; that check is on the [roadmap](/sheets/roadmap/).

## People and presence

```ts
import { CollabRoom, Users, socketTransport } from "@pli.dev/core";

const room = new CollabRoom({ room: "sheet:budget-2026", transport: socketTransport(socket), users });
```

```tsx
<PliSheet session={session} users={users} room={room} comments sync />
```

The editor connects the room, attaches the comments to it, and says what this person is doing through `room.setPresence({ sheet, selection, editing })`:

```ts
interface SheetPresence {
  sheet: string | null;                                   // the sheet shown (its id)
  selection: { active: string; ranges: string[] } | null; // "B3", ["B3:C5", "E7"]
  editing: string | null;                                 // the cell being typed in
}
```

What other people see: avatars in the title row (`AvatarStack`), a dot in their colour on the **tab** of the sheet they are on, a coloured outline with their name round their **selected cells**, and a **"Ana is typing…"** outline on the cell they are editing. **Scrolling is not shared**: everyone looks where they like. Their selections stay on their cells when someone inserts or deletes rows above (`mapSheetPresence`, called by the sync client).

## Live editing

```ts
import { SyncClient, createAuthority, memoryDocumentStore } from "@pli.dev/core";
import { sheetSyncModel } from "@pli.dev/sheets";

// On the client (or just <PliSheet sync />): the session's core is what the client works on
const sync = new SyncClient({ session: sheet.core, room, model: sheetSyncModel });
sync.start();

// On your server: the sequencer, over any DocumentStore
const authority = createAuthority({ store, model: sheetSyncModel, create: (room) => createWorkbook(room) });
```

`attachSync(sheetEditorSession(session), …)` does the same in one call, with a socket's `connect` and `disconnect` events. Register `sheetEditor` with an `EditorRegistry` to serve `sheet:` rooms from a server that serves every editor. `<PliSheet sync>` shows "Saved", "Saving…" and "Offline" beside the people and keeps changes made offline.

Pli.Sheets operations are plain JSON and invertible (see `SheetOp`). Formulas are never sent as values. Only the formula text travels, and every client works out the values from the merged cells.

### What merges, and how conflicts resolve

The sequencer puts changes in one order; where two changes meet, this is what happens (the later one in that order is "later"):

| Two people at the same moment | Result |
|---|---|
| Edit **different cells**, sizes, objects or settings | Both stand. |
| Edit the **same cell** | The later one wins, as a whole cell. The earlier author's value stays in their undo history: undoing their own edit puts back what the cell held before it, not what was overwritten. |
| Set the same size field (width, hidden) of a row or column | The later wins field by field: a width and a "hide" made at once both stand. |
| **Insert or delete rows or columns** while the other edits | Every address in the other change moves: cells, merges, ranges of rules and validations, tables, charts, pictures, slicers, filters, print areas, names, the references inside formulas (also formulas on other sheets that point at that sheet), and the cell a comment thread sits on. Cells written into deleted rows go with them. |
| Insert rows in the middle of rows someone else deletes (or right after them) | The inserted rows go with the deleted ones: that is the only reading in which every formula that spans them says the same on both sides. |
| **Two row or column changes** at once | Both apply, shifted past each other. |
| Add **sheets**, rename, delete, move tabs | Sheets are named by id. A sheet deleted by one takes the other's changes to it away (two people deleting the last two sheets, one each, leave none: the editor refuses to delete the last sheet you can see, and a workbook with none gets an empty `Sheet1` when it is saved), and formulas that pointed at it become `#REF!`; formulas that name a sheet someone renames are rewritten. **Two sheets given the same name at once** (added or renamed, either way round, case ignored): the one the server accepted later is called `Name (2)` on every client, and every formula that pointed at it follows (a sheet added with `Totals`, with formulas that read `Totals!A1`, ends up with formulas that read `'Totals (2)'!A1`). Tab positions and tab moves are merged like any list (below). |
| Add or delete objects (charts, pictures, rules, validations, tables, slicers, pivots) and tabs | Each list is merged position by position (the algorithm the Decks lists use, `listot.ts`, checked on every pair of changes to a list of four): two items put at one place go in the order the server accepted them, a deletion shifts the positions of the others, and two people deleting neighbours, or one adding next to what another deletes while a third adds beside it, always give one list. |
| Change or delete the **same object** (a chart, a rule…) | The later change wins; a change to an object someone deleted is dropped. The **same object put back by two people** (each undid its deletion): one copy, with the later person's version, in the place the earlier one put it. |
| A **conditional format, validation, table or sparkline** whose every range goes | Rows and columns that take the last of an object's ranges away take the object away as an explicit deletion, written first, so that every other change to that list counts it. A change someone else made to that object at the same moment (the edit of a rule, say) is dropped, on every client. When two people's changes together take a rule's last range (each took only one column of it), a shared workbook keeps the rule with nothing to cover instead of removing it in one copy and not the other, so every position in the list stays the same for everyone; it is invisible (`conditionalFormats` leaves it out), and saving the workbook, to JSON or `.xlsx`, leaves it out. |
| **Tables**: create, rename, resize, add or delete columns, header row and totals row switched, convert to range | A table is one object in its sheet's list, and its range moves with rows and columns like any range. A table whose header row, or every column, another person deletes is taken away as an explicit deletion, written first (the same as a rule above). A table that one person widened while another deleted every column it had *in the other copy* is put back by the widening (`update_table` is applied as "add it if it's gone"), so every copy ends with the widened table. Header cells and calculated-column formulas that a table fills in are written into the change as ordinary cell changes, so they do not depend on which copy filled them. Two columns added at one place in a table with no header row both stay, and the names of such columns stay as people typed them. Two tables over the same cells, or a filter or sort on a column someone deleted, stay as leftovers that cover nothing (below). |
| **Slicers and timelines**: create, delete, connect to a table or pivot table | They hold the id of a table and the name of a column. When another person's change takes that table or column away (deleting the column, switching off the header row, deleting the table), the slicer or timeline stays as a leftover: invisible (`session.slicers()` and `session.timelines()` leave it out, and so does the panel the React editor draws), and left out when the workbook is saved to JSON or `.xlsx`. It is never removed in one copy and kept in another. The slicers and timelines of a pivot table move with the pivot table. |
| A **pivot table** whose source range loses rows or columns | The source address follows the cells like any range (it becomes `#REF!` when every row or column of it goes, on every copy). A change to a pivot table another person deleted is dropped. |
| A **pivot table** that rows or columns are inserted into or deleted through | The change wins and the pivot table that was being added is taken away (a pivot table cannot be cut through). |
| Reply to the same thread, resolve, reopen | Replies are merged change by change, so two replies made at once both stay, in the order they were written. Resolve and reopen go to the later one. |
| Two edits to the same table or pivot table (`update_table`, `update_pivot`) | **Last one wins** as a whole object: the later definition replaces the earlier one. |
| Undo | Per person. Undoing your row insertion deletes those rows and nothing else, and what others did in the meantime stays; undoing the deletion of rows puts back the cells that were in them (not the workbook as it was). Everything an undo does is an ordinary operation, merged like any other. |

The client also sends a fingerprint of the workbook now and then (`hashWorkbook`) as a check that the copies agree. The fuzzers (up to five people making every kind of change, sheets and list deletes included, at 100 and 200 times the default number of cases) have never needed it.

**Not merged:** the values of formulas (never sent), selections and scrolling (presence only), a person's open dialogs.

### Testing it

`packages/sheets/test/convergence.test.ts` is the convergence fuzzer: random changes from random people go through the transform and are applied in both orders, over thousands of pairs and over simulated clients and a server, with named cases for each row above (and the fuzzers make tables, slicers, timelines and pivot tables too: create, rename, resize, add and delete columns, header and totals toggles, convert to range, connect and delete, and source ranges that lose rows and columns, in pairs, in three- and five-person simulations and over real `SyncClient`s, including undo and offline; clean at `FUZZ_RUNS=100` and `200`). `sync.test.ts` runs real `SheetSession`s with `SyncClient`s over a network stepped by hand (messages delayed, clients going offline and back, per-person undo) and checks that every client ends with the server's workbook. `FUZZ_RUNS=10 pnpm vitest run packages/sheets` runs ten times as many cases.

## Version history

```ts
import { VersionHistory } from "@pli.dev/core";
import { sheetSyncModel, sheetVersionSupport } from "@pli.dev/sheets";

const history = new VersionHistory({ file: "budget", session: { get state() { return session.state; }, transact: (ops) => session.transact(ops) }, storage, users, support: sheetVersionSupport, hash: sheetSyncModel.hash });
await history.save("Sent to the board");
await history.restore(version.id);       // one undoable step, sent to everyone
```

`restoreSheetOps(current, target)` turns one workbook into another with ordinary operations (cells, sheets added, deleted, renamed and reordered, objects, sizes), so a restore is undoable, merged with what others do and sent like any edit; comment threads are left as they are. `summarizeSheetDiff(from, to)` says what changed ("Sheet Budget: 12 cells changed"). The panel is the shared `VersionHistoryPanel`.

### Track changes

Excel's **Track Changes** (the shared-workbook feature, which Microsoft has retired in favour of co-authoring) and its **Show Changes** list record who changed which cell. Docs' suggestion mode does not carry over to cells. A suggestion in a document is a mark on a run of text (an insertion or a deletion that is not yet accepted, kept in the text itself). A cell holds one value that is replaced whole, with no run to mark and no place to keep a second pending value that formulas, sorting and filters would have to ignore. Pli.Sheets covers the same needs with:

- **who changed what, and when**: the log of a shared workbook (`DocumentStore` entries carry the author's connection and the operations) and named versions with *what changed since* (`summarizeSheetDiff`);
- **proposing a value for someone to approve**: a threaded comment on the cell, resolved when it is settled;
- **taking a change back**: per-person undo, and restoring a version.

## File storage

While a workbook is open its pictures are `data:` addresses, because the editor reads their bytes to size, crop and draw them. Storage changes the saved file:

```ts
import { StorageClient } from "@pli.dev/core";
import { loadWorkbook, saveWorkbook, storageData, SheetSession } from "@pli.dev/sheets";

const storage = new StorageClient(myAdapter);          // upload, resolve, and read for loading

const saved = await saveWorkbook(session.state, storage, { name: "plans/q1.sheet.json" });
// saved.ref        where the workbook went
// saved.data       where the rows of each data block went, by source
// saved.failed     pictures that could not be uploaded (they stay embedded)

const { workbook, data } = await loadWorkbook(saved.ref, storage);
const session2 = new SheetSession(workbook, { pivotData: storageData(storage, data) });
```

`saveWorkbook` uploads each picture once (pictures on the sheet, in cells, in note boxes, in headers and footers; the same picture is one file), puts the rows of each pivot-table **data block** in a file of its own, and then the workbook as JSON with short references in place of both. `loadWorkbook` reads it back and fetches what it refers to (`lenient: true` leaves out a picture it cannot fetch and lists it). `storageData` is a `pivotData` resolver that reads a data block's current rows from storage when a pivot table is refreshed. `pictureStore(storage)` is the `put`/`get` pair underneath, with a cache you can share between saves.

Pictures inside `.xlsx` files stay in the file; a workbook is saved with `toXlsx` and uploaded with `storage.upload` like any other file.

## Running the tests

```sh
pnpm vitest run packages/sheets/test/comments.test.ts packages/sheets/test/xlsx-threads.test.ts \
  packages/sheets/test/convergence.test.ts packages/sheets/test/sync.test.ts \
  packages/sheets/test/storage.test.ts packages/sheets/test/versions.test.ts packages/sheets-react/test/collab-ui.test.tsx
```
