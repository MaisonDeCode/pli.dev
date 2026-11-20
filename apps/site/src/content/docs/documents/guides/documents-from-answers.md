---
title: Make documents from answers
description: "Write a template once with placeholders, conditions and repeating rows, then make a finished document from any set of answers, whether they come from a form, a questionnaire or a database row."
---

A template is an ordinary Pli document with `{{ placeholders }}` in the text. Hand it some answers and `generateDocument` gives back a finished document: the placeholders filled in, the parts that don't apply left out, and rows repeated for each item in a list.

The answers can come from anywhere. Pli doesn't ask you to use its own form. A form in your app, a survey tool, a row from your database, a reply from a model: if you can turn it into a plain object, you can make a document from it.

```ts
import { generateDocument, fromDocx, toDocx } from "@pli.dev/docs";

const template = fromDocx(templateFile).doc;   // or a Pli document you saved earlier

const { doc, issues, missing } = generateDocument(template, {
  client: { name: "Ana Reyes", email: "ana@example.com" },
  plan: "team",
  seats: 8,
  start: "2026-12-01",
  services: [
    { name: "Brand workshop", fee: 2400 },
    { name: "Website design", fee: 6800 },
  ],
});

download(toDocx(doc));
```

You can try it in the playground, under **Documents from answers**: fill in the questions and the document is made as you type, and you can edit the template itself in the same editor.

## Writing a template

Write the template in the editor, or in Word and import the file. In the editor, turn on `placeholders` (see below) and the tags are easier to see and to add. Type a placeholder where an answer should go:

> This agreement starts on `{{ start | date }}` between Northfield Studio and `{{ client.name }}`.

A placeholder takes the look of the text where it sits, so a bold `{{ client.name }}` comes out bold. They work anywhere there is text: paragraphs, headings, table cells, headers, footers, footnotes, the document title, the web address of a link and the address of a picture.

Names are looked up in the answers. Use a dot for a group of answers (`client.name`) and a number for a place in a list (`contacts[0].email`).

### Parts that are only sometimes there

Put `{{#if …}}` and `{{/if}}` on lines of their own, around what should appear only when the condition is true:

```text
{{#if plan == "team"}}
The Team plan includes shared workspaces.
{{#elseif plan == "enterprise"}}
The Enterprise plan includes a named contact.
{{else}}
The Starter plan covers up to {{ seats }} seats.
{{/if}}
```

`{{#unless paid}} … {{/unless}}` is the opposite. Conditions nest, and `{{else}}` and `{{#elseif …}}` are optional.

A condition can also sit inside a line:

> Dear `{{#if title}}{{ title }} {{/if}}{{ name }}`,

A paragraph that held only placeholders and came out empty is removed, so an optional address line leaves no gap. To keep it, pass `dropEmpty: false`.

### Parts that repeat

Put `{{#each …}}` and `{{/each}}` around what should be repeated for each item in a list:

```text
{{#each services as s}}
{{ s.name }}: {{ s.fee | currency }}
{{/each}}
```

Inside, `s` is the current item. Leave out `as s` and the item's own fields can be used by name, or the item itself as `this`. A few extras are there too: `@number` (1, 2, 3…), `@index` (0, 1, 2…), `@count`, `@first` and `@last`. Answers from outside the loop are still reachable.

### Rows of a table

To repeat a table row, open the list in the **first cell** of the row and close it in the **last cell**, each on a line of its own:

| Service | Fee |
|---|---|
| `{{#each services as s}}`<br>`{{ s.name }}` | `{{ s.fee \| currency }}`<br>`{{/each}}` |
| **Total** | `{{ services \| sum:"fee" \| currency }}` |

The same works for `{{#if}}` to leave a row out. A row with merged cells can't be repeated.

### What is left as it is

- **Code blocks** are never changed, so a template can show a placeholder as an example.
- To write `{{` as plain text, use a quoted string: `{{ "{{" }}`.
- Curly quotes, which Word types in place of straight ones, are read as quotes inside a tag.

## What goes inside the braces

Values, comparisons, `and`, `or`, `not`, a little arithmetic, and filters:

| You write | It means |
|---|---|
| `client.name`, `items[0].price` | A value from the answers |
| `"text"`, `42`, `true`, `null` | A fixed value |
| `plan == "pro"`, `plan != "pro"` | Equal, not equal. A number and the same number written as text are equal |
| `seats > 5`, `<`, `>=`, `<=` | Compare numbers, dates or text |
| `a and b`, `a or b`, `not a` | Combine conditions (`&&`, `\|\|` and `!` work too) |
| `"b" in tags`, `"c" not in tags` | A value is in a list, or a piece of text is in some text |
| `price * seats`, `+ - / %` | Arithmetic. `+` joins text if either side is text |
| `nickname \|\| name` | The first one that has an answer |
| `n ?? 0` | A fallback for nothing at all |
| `@today` | The date, taken from `now` if you pass it |

For a condition, **nothing, `false`, `0`, empty text and an empty list** count as no. Everything else counts as yes.

### Filters

A filter changes a value: `{{ price | currency }}`. Chain them, and give arguments after a colon: `{{ due | date:"short" }}`.

| Filter | What it does |
|---|---|
| `upper`, `lower`, `title`, `capitalize`, `trim` | Change the case or trim spaces |
| `truncate:40`, `replace:"-"," "`, `initials` | Shorten, replace, take the initials |
| `default:"N/A"` | Use this when there is no answer or it is empty |
| `number`, `number:2` | A number with separators, and a set number of decimals |
| `currency`, `currency:"EUR"`, `currency:"USD",0` | Money. The currency is `USD` unless you pass the `currency` option |
| `percent`, `percent:1` | `0.256` becomes 26%, or 25.6% |
| `round:2`, `ordinal`, `plural:"item","items"` | Round, 22nd, and choose a word by the count |
| `date`, `date:"short"` | A date. Styles: `full`, `long` (default), `medium`, `short`, `iso`, `year`, `month`, `monthYear`, `day`, `weekday`, `time` |
| `yesno`, `yesno:"Signed","Unsigned"` | A yes or no as words |
| `join:" / "`, `sentence`, `sentence:"or"` | A list as text: `a, b, c` or `a, b, and c` |
| `first`, `last`, `length`, `reverse`, `sort:"name"` | Work on a list |
| `pluck:"name"`, `sum:"fee"` | Take one field from each item; add them up |

A date can be a `Date`, a number of milliseconds, or text like `2026-11-18`. Dates and numbers are written in the reader's language unless you pass `locale`, such as `"fr-FR"`.

Add your own with the `filters` option. A filter gets the value, its arguments, and how the document should read:

```ts
generateDocument(template, answers, {
  locale: "en-GB",
  currency: "GBP",
  filters: {
    postcode: (value) => String(value).toUpperCase().replace(/\s+/g, " "),
  },
});
```

Throw an `Error` from a filter when the value is no good. The placeholder stays in the document and the problem is reported.

## When something is missing or wrong

A placeholder with no answer is **highlighted and left as written**, so whoever reads the document can see what is still to fill in. That also makes a live preview useful while a form is half done. Choose another with the `missing` option:

| `missing` | A placeholder with no answer |
|---|---|
| `"mark"` (default) | Stays as written, highlighted |
| `"keep"` | Stays as written |
| `"blank"` | Becomes nothing |

`generateDocument` returns three things:

- **`doc`**: the document. Every block has a new id, so it can replace what is in a session with `session.replaceDocument(doc)`.
- **`missing`**: the names that had no answer, each once. Handy for "3 questions left".
- **`issues`**: everything that wasn't right, each with its `type`, a `message`, the `tag` as it was written and the `block` it is in. The types are `missing`, `syntax` (a tag that can't be read, or a condition or list that is never closed), `filter` (a filter that doesn't exist or can't use its value) and `type` (a group of answers shown as text, or text looped over as a list).

A condition with no answer isn't an issue: it is simply no. An unanswered optional question is a normal thing.

To make a document only when everything is right, pass `strict: true`. It throws a `PliError` that lists the problems, with the full list in its `cause`.

The template and the answers are never changed.

## Editing a template in the editor

Pass `placeholders` to `PliDocument` while someone is writing a template:

```tsx
<PliDocument
  session={templateSession}
  placeholders={{
    fields: [
      "client.name",
      { path: "start", label: "Start date" },
      { path: "services", label: "Services" },
    ],
  }}
/>
```

- **Chips.** Each `{{ … }}` is drawn with a tinted background in a code font: blue for an answer, green for `{{#if}}`, `{{else}}`, `{{#each}}` and their closing tags, and red with a wavy underline for one that can't be read (hover it to see why). It is only drawing. The text is the same as without it, so typing, selecting and Word files behave as usual, and a tag that runs over bold or italic text is drawn as one chip.
- **Insert > Field** lists your answers by name and puts `{{ client.name }}` at the caret. An answer whose name isn't a plain word, such as `answer.q-id`, goes in as `{{ answer["q-id"] }}`, which is how it has to be written to be read back, and the chip finds its name whichever way you list it. `placeholderPath(path)` gives that form if you build tags yourself.
- **Insert > Only if…** and **Repeat for each…** put the opening and closing tag on lines of their own, with an empty line between them for the text that goes inside, and split the paragraph first when the caret is in the middle of one. They list your answers too, so you pick the one the condition or list is about. Only a list can be repeated, so Repeat for each… offers the answers that have `fields` (what each item has) or `list: true`; with none of those it puts in a list with a word to replace.

`placeholders` on its own (`true`) gives the chips, and Only if… and Repeat for each… with a word to replace. `templateFields(template).fields` gives the `fields` for a template that already has some, and the answers your own questionnaire asks are a good list for a new one.

`PliEditor` takes `placeholders` too, and the functions behind the menu, `insertValue(session, "client.name")` and `insertSnippet(session, "if", "nda")`, are exported for your own buttons. `placeholdersIn(text)` in `@pli.dev/docs` finds the tags in a text, if you draw your own.

### For people who don't write code

Add `labels: true` and each tag is shown by its name, with the code hidden:

```tsx
<PliDocument
  session={templateSession}
  placeholders={{
    labels: true,
    fields: [
      { path: "client.name", label: "Client name" },
      { path: "plan", label: "Plan", options: [{ value: "team", label: "Team" }, { value: "starter", label: "Starter" }] },
      { path: "services", label: "Services", fields: [{ path: "name", label: "Service" }, { path: "fee", label: "Fee" }] },
    ],
  }}
/>
```

| In the text | Shown as |
|---|---|
| `{{ client.name }}` | Client name |
| `{{ start \| date }}` | Start date |
| `{{#if plan == "team"}}` | Only if Plan is team |
| `{{#elseif …}}`, `{{else}}`, `{{/if}}` | Otherwise, if …, Otherwise, End |
| `{{#each services as s}}`, `{{/each}}` | For each item in Services, End of list |

The names come from `fields`. An answer you didn't list is named from its own name, so `clientCity` is "Client city". A tag that can't be read is shown as written, in red, so it can be fixed.

It is only how the editor draws the text, so nothing changes underneath: the same template works in `generateDocument`, in other apps and in Word. Each tag counts as one character for the caret. The arrow keys jump over it, a click next to it puts the caret beside it, and Backspace or Delete removes the whole tag. Tab with the caret against a tag steps over it (Shift+Tab steps back), and anywhere else Tab works as usual, so nobody is stuck. A selection that touches a tag takes in all of it. Hover a tag to see the code.

Giving each field its `options` lets *Insert > Only if…* offer "is Team" and "is Starter" for that answer, and giving a list its `fields` offers the list's items under it. To change a tag, delete it and insert another.

`describePlaceholder(tag, names)` in `@pli.dev/docs` gives the words for any tag, if you draw your own. The playground's **Templates without code** shows all of this: a list of questions to click in, the Insert menu, and a *Show the code* switch.

## Which answers a template needs

`templateFields` reads a template and says what it asks for, without any answers:

```ts
const { fields, issues } = templateFields(template);
// [
//   { path: "client.name", type: "text",    uses: ["value"] },
//   { path: "plan",        type: "text",    uses: ["condition"], options: ["starter", "team", "enterprise"] },
//   { path: "seats",       type: "number",  uses: ["value"] },
//   { path: "nda",         type: "boolean", uses: ["condition"] },
//   { path: "start",       type: "date",    uses: ["value"] },
//   { path: "services",    type: "list",    uses: ["list"], fields: [{ path: "name", … }, { path: "fee", type: "number", … }] },
// ]
```

The `type` comes from how the answer is used: a `date` filter means a date, `currency` or a comparison with a number means a number, and an answer used only in conditions is a yes or no. `options` collects the values a condition compares with, so `plan == "team"` and `plan == "enterprise"` tell you the choices.

Use it to:

- **Build a questionnaire from a template**, so the questions can't fall behind the document.
- **Check a questionnaire you already have** against a template, and find the answers it never asks for.
- **Show what is wrong with a template** before anyone fills it in. `issues` has the tags that can't be read and the conditions that are never closed.

## A live preview

Generation is quick, so you can run it on every change and show the result as people answer:

```tsx
const session = useDocumentSession(() => generateDocument(template, answers).doc);

useEffect(() => {
  session.replaceDocument(generateDocument(template, answers).doc);
}, [template, answers]);

return <PliDocument session={session} readOnly menu={false} toolbar={false} />;
```

The playground's demo does exactly this, with the form on the left and the document on the right.

## Fitting it to your app

- **Where the template lives** is up to you: a file in storage, a record in a database, a document in the editor. People who make templates can use the ordinary editor, or Word and import the file.
- **Where the answers come from** is up to you too. Pli has no questionnaire of its own, so you don't have to move your forms into it.
- **After generating**, everything else works: edit the result in the editor, export it to [DOCX, PDF, HTML or Markdown](/documents/guides/exporting/), keep versions of it, comment on it.

## Limits

- Templates are for Documents. Sheets, Decks and PDF don't read `{{ }}` yet.
- The templating functions are in `@pli.dev/docs`. The Swift and Kotlin packages don't have them yet.
- A document can't grow past 50,000 blocks while it is made (set `maxBlocks` to change that), so a list that is much longer than expected stops with an error instead of using all the memory.
- Placeholders are plain text in the document, which is why a template written in Word works. The chips and the Insert menu are only in how the editor draws and adds them.
- Tags shown by name have been tried in Chrome only so far: not yet in Safari or Firefox, with a touch screen or with an input method that composes text.
- The editor doesn't yet list a template's problems (a condition never closed, say) while it is being written. Red chips show tags that can't be read; `templateFields(template).issues` has the rest.
