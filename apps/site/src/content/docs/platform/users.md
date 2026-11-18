---
title: Users and permissions
description: Tell Pli who is signed in and how to find other people, and decide what each person may do with comments.
sidebar:
  order: 3
---

Pli does not have accounts. Your app has them, so you hand Pli what it needs to **show** people: a name, a picture, a color. Anything that belongs to a person (a comment, a cursor) stores only their `id`; the name and picture are looked up when they are drawn, so a user who renames themselves is renamed everywhere.

:::note
The code on this page imports from `@pli.dev/core`. Install it next to your editor: `npm install @pli.dev/core`.
:::


## A user

```ts
interface PliUser {
  id: string;        // your own id; this is what is saved with comments
  name: string;
  avatar?: string;   // a URL; without it their initials are shown
  color?: string;    // a hex color for their cursor; without it one is chosen from the id
  email?: string;
}
```

## Giving Pli your users

The simplest case is just the signed-in user:

```ts
import { Users } from "@pli.dev/docs";

const users = new Users({ id: "u_42", name: "Ana Reyes" });
```

To show the authors of other people's comments, add a `lookup`. Pli collects every id it needs and calls it **once** with all of them:

```ts
const users = new Users({
  current: { id: "u_42", name: "Ana Reyes" },
  role: "editor",
  lookup: async (ids) => (await fetch(`/api/users?ids=${ids}`)).json(),
  search: async (query) => (await fetch(`/api/users?q=${query}`)).json(), // for @mentions
});
```

| Field | What it is for |
|-------|----------------|
| `current` | The signed-in user, or `null` for an anonymous visitor, who can read comments but not write them |
| `role` | What the current user may do (below). Default `editor` |
| `lookup(ids)` | Returns the users with these ids. May be synchronous or return a promise |
| `search(query, context)` | Finds users by name, for [@mentions](/documents/features/comments/#mentions). Without it, typing `@` offers nothing. `context.file` says which file the comment is in |
| `open(user)` | Called when someone clicks a person's name in a comment, or an @mention. Open your profile card or start a chat. Without it, names are plain text |

Until `lookup` answers, a person is shown by their id. If it fails, they stay that way; comments keep working.

**Who can be mentioned.** Whoever `search` returns can be mentioned, so leave out anyone who shouldn't be tagged. It is told the file, so you can offer only the people who can open it:

```ts
search: async (query, { file } = {}) => (await fetch(`/api/files/${file}/people?q=${query}`)).json(),
```

To tell those people, see [Notifying people](/platform/comments/#notifying-people).

People in the same room (see [Realtime](/platform/realtime/)) are added automatically from what they announce, so you do not need to look them up.

**If you build your own interface**, `users.get(id)` returns a user at once (a placeholder until looked up) and `users.subscribe(fn)` tells you when the real one arrives.

## Roles

| Role | Can |
|------|-----|
| `viewer` | Read comments |
| `commenter` | Start threads, reply, resolve and reopen, and edit or delete **their own** comments |
| `editor` | Everything, including deleting anyone's comments and threads |

Where this is not right for your app, decide for yourself:

```ts
new DocumentSession(doc, {
  comments: {
    users,
    permissions(action, { user, thread, comment }) {
      // action: "comment" | "reply" | "edit" | "delete" | "resolve" | "deleteThread"
      if (action === "resolve") return thread?.comments[0]?.author === user.id || user.role === "editor";
      return undefined; // anything else: use the default
    },
  },
});
```

Return `true` or `false` to decide, or `undefined` to leave it to the default for the role.

:::caution
These checks decide what the **interface offers**. They run in the browser, so they are not security. Your server must check who may write what, in your `CommentStore.save`.
:::

## Sharing

Who may open a file, and what they may do, is the same question in every editor, so it is answered once. `ShareClient` holds the **sharing settings** of a file and `SharingStore` is where your app keeps them, like a `CommentStore`:

```ts
import { ShareClient } from "@pli.dev/core";

const share = new ShareClient({
  file: doc.id,
  users,                                     // the directory: `search` finds people to invite
  store: mySharingStore,                     // load(file) and save(file, change); optional `subscribe`
  linkUrl: (file) => `https://app.example/open/${file}`,
});

share.invite([ben, "cy@example.com"], "commenter");   // a person from the directory, or an address
share.setRole({ userId: "u_7" }, "editor");
share.remove({ email: "cy@example.com" });
share.setLink({ enabled: true, role: "viewer", audience: "signed-in" });

share.roleOf(user);       // "viewer" | "commenter" | "editor" | null: what this person may do, from the owner, the grants and the link
share.can("invite");      // may the current user change sharing? (editors; override with `permissions`)
```

The dialog (`ShareDialog`, see [Shared interface](/platform/shared-ui/)) works on a `ShareClient` and needs no server of its own. `PliDocument` takes it as `share={share}`.

Everything is plain JSON. The settings:

```json
{
  "owner": "u_42",
  "grants": [
    { "userId": "u_7", "role": "commenter", "by": "u_42", "at": 1767225600000 },
    { "email": "cy@example.com", "role": "viewer", "by": "u_42", "at": 1767225700000 }
  ],
  "link": { "enabled": true, "role": "viewer", "audience": "signed-in" }
}
```

and what your store is asked to save, one change at a time (each is safe to apply twice):

```jsonc
{ "type": "grant",  "grant": { "userId": "u_7", "role": "editor", "at": 1767225800000 } }
{ "type": "revoke", "userId": "u_7" }                       // or { "email": "…" }
{ "type": "link",   "link": { "enabled": false, "role": "viewer" } }
{ "type": "owner",  "userId": "u_8" }
```

An address with no `userId` is an invitation: your server sends the email, and when the person signs up, turns it into a grant with their id. The owner always has full access and cannot be removed.

Wire it to the rest: give the editor's `UserDirectory` the role `share.roleOf(currentUser)`, and have your server check the same settings when it joins a socket to a room and in `createAuthority`'s `authorize`.

:::caution
As with comments, `can()` decides what the **interface offers**. Your server must check the grants itself: a browser can send anything.
:::
