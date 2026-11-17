import { Users, type PliUser, type UserDirectory } from "@pli.dev/docs";

/** The visitor, who is the "current user" of the demo document. */
export const YOU: PliUser = { id: "u_you", name: "You", color: "#4f46e5" };
/** The teammate who comments on the draft and has a cursor in it. */
export const MAYA: PliUser = { id: "u_maya", name: "Maya Chen", color: "#c2255c" };

const EVERYONE = [YOU, MAYA];

/**
 * The people of the demo: a directory whose current user can be switched for a moment, so a comment can be written "as" the
 * teammate through the same `session.comment` call a real app would make for her. `as(user, fn)` restores the visitor after.
 */
export function createPeople() {
  let current: PliUser = YOU;
  const directory: UserDirectory = {
    get current() {
      return current;
    },
    role: "editor",
    lookup: (ids) => EVERYONE.filter((p) => ids.includes(p.id)),
    search: (query) => EVERYONE.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
  };
  const users = new Users(directory);
  users.add(EVERYONE);
  return {
    users,
    as<T>(user: PliUser, fn: () => T): T {
      const before = current;
      current = user;
      try {
        return fn();
      } finally {
        current = before;
      }
    },
  };
}

export type People = ReturnType<typeof createPeople>;
