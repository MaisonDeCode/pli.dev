import type { PliUser } from "./users";

/**
 * @mentions. A comment's `body` is plain text and a mention in it is just `@` and the person's name, so every
 * export, store and notification shows something a person can read. The ids of the people mentioned are listed
 * beside it, in `Comment.mentions`, which is what an app uses to notify them.
 */

/** What is typed for a mention of `user`. */
export function mentionText(user: Pick<PliUser, "name">): string {
  return `@${user.name}`;
}

/** Whether the character can be part of a name, so `@Ben` isn't found inside `@Benjamin`. */
const isNameChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}_]/u.test(char);

/** The places in `body` where `user` is mentioned: `@Name`, not directly followed by more of a name, and not part of a word before it. */
function mentionRanges(body: string, user: Pick<PliUser, "name">): { start: number; end: number }[] {
  const needle = mentionText(user).toLowerCase();
  const haystack = body.toLowerCase();
  const found: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) return found;
    const end = start + needle.length;
    if (!isNameChar(body[start - 1]) && !isNameChar(body[end])) found.push({ start, end });
    from = start + 1;
  }
}

/** The ids of the people in `candidates` who are mentioned in `body`, in the order they first appear. */
export function mentionsIn(body: string, candidates: readonly Pick<PliUser, "id" | "name">[]): string[] {
  const first = new Map<string, number>();
  for (const user of candidates) {
    const at = mentionRanges(body, user)[0];
    if (at && !first.has(user.id)) first.set(user.id, at.start);
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

export type MentionPart = { text: string } | { mention: PliUser };

/**
 * Cuts `body` into plain text and mentions of the people in `mentioned`, for showing the mentions
 * differently. When one name is part of another ("Ben" and "Ben Ito"), the longer one wins.
 */
export function splitMentions(body: string, mentioned: readonly PliUser[]): MentionPart[] {
  const hits: { start: number; end: number; user: PliUser }[] = [];
  for (const user of [...mentioned].sort((a, b) => b.name.length - a.name.length)) {
    for (const range of mentionRanges(body, user)) {
      if (!hits.some((h) => range.start < h.end && h.start < range.end)) hits.push({ ...range, user });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const parts: MentionPart[] = [];
  let at = 0;
  for (const hit of hits) {
    if (hit.start > at) parts.push({ text: body.slice(at, hit.start) });
    parts.push({ mention: hit.user });
    at = hit.end;
  }
  if (at < body.length) parts.push({ text: body.slice(at) });
  return parts;
}

/** The mention being typed at the caret: where its `@` is and what has been typed after it. */
export interface MentionQuery {
  start: number;
  query: string;
}

const LONGEST_QUERY = 30;

/**
 * Whether the caret is in the middle of typing a mention. The `@` has to start a word, and the text after it
 * can hold spaces (names do) but not a line break or another `@`.
 */
export function activeMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1]!)) return null;
  const query = before.slice(start + 1);
  if (query.length > LONGEST_QUERY || /[\n]/.test(query) || query.startsWith(" ")) return null;
  return { start, query };
}

/** Replaces the mention being typed with the whole name of `user` and a space. Returns the new text and where the caret goes. */
export function insertMention(text: string, mention: MentionQuery, caret: number, user: Pick<PliUser, "name">): { text: string; caret: number } {
  const inserted = `${mentionText(user)} `;
  return { text: text.slice(0, mention.start) + inserted + text.slice(caret), caret: mention.start + inserted.length };
}
