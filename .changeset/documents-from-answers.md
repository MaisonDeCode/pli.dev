---
"@pli.dev/docs": minor
"@pli.dev/react": minor
---

Make documents from answers. A template is an ordinary document with `{{ placeholders }}`, `{{#if}}` parts that appear only when something is true, and `{{#each}}` parts (or table rows) that repeat for each item in a list. `generateDocument(template, answers)` returns the finished document, with the answers coming from any form, questionnaire or database. Filters write dates, money, numbers and lists, and you can add your own. `templateFields(template)` reports which answers a template asks for, with their types and choices, so a questionnaire can be built from it or checked against it.

In the editor, the new `placeholders` option on `PliDocument` (and `PliEditor`) draws each `{{ … }}` as a chip, red when it can't be read, and adds Insert > Field, Only if… and Repeat for each… so a template is easy to write. `placeholdersIn(text)` finds the tags in a text.

`placeholders={{ labels: true, fields }}` is for people who don't write code: each tag is shown by a plain name ("Client name", "Only if Plan is team", "End") with the code hidden, and the caret, Backspace and Delete treat a tag as one character. Fields can give `options` (Insert > Only if… then offers "is Team") and, for a list, the `fields` of its items. `describePlaceholder(tag, names)` gives the words for a tag.
