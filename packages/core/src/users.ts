/**
 * Who is using the editor. Pli doesn't own accounts: your app already knows who the user is, so you tell
 * Pli, and Pli shows it. Anything that carries a user (a comment, a cursor) stores only the user's `id`.
 * The name, avatar and color are looked up from this directory when they are drawn.
 */
export interface PliUser {
  /** Your own id for the user. Stable across sessions; it's what gets saved with comments. */
  id: string;
  name: string;
  /** A URL for the user's picture. Without it, their initials are shown. */
  avatar?: string;
  /** A hex color for their comments and cursor. Without it, one is chosen from the id. */
  color?: string;
  email?: string;
}

/** What the current user may do. `viewer` can read comments, `commenter` can add them, `editor` can also moderate them. */
export type Role = "viewer" | "commenter" | "editor";

/** What you give Pli to describe the people in the room. Every part but `current` is optional. */
export interface UserDirectory {
  /** The signed-in user, or null for an anonymous visitor (who can read, but not comment). */
  current: PliUser | null;
  /** What the current user may do. Defaults to `editor`. */
  role?: Role;
  /** Looks up users by id, for the authors of comments written by other people. */
  lookup?(ids: string[]): PliUser[] | Promise<PliUser[]>;
  /** Finds users by name, for @mentions. */
  search?(query: string): PliUser[] | Promise<PliUser[]>;
}

const COLORS = ["#d9480f", "#1c7ed6", "#2f9e44", "#9c36b5", "#c2255c", "#0c8599", "#e67700", "#5f3dc4"];

/** A color for a user who has none of their own: the same id always gets the same one. */
export function userColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** One or two letters to stand in for a user with no picture. */
export function userInitials(user: Pick<PliUser, "name">): string {
  const parts = user.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0]![0]! : parts[0]![0]! + parts[parts.length - 1]![0]!;
  return letters.toUpperCase();
}

function isUser(value: PliUser | UserDirectory): value is PliUser {
  return typeof (value as PliUser).id === "string" && typeof (value as PliUser).name === "string";
}

/**
 * The users of one editor. `get` answers at once: a user it doesn't know yet comes back as a placeholder
 * named by their id, the directory is asked, and `subscribe` listeners run when the real user arrives.
 * Pass `Users` a single user, or a `UserDirectory`.
 */
export class Users {
  #directory: UserDirectory;
  #cache = new Map<string, PliUser>();
  #asked = new Set<string>();
  #wanted = new Set<string>();
  #scheduled = false;
  #listeners = new Set<() => void>();

  constructor(source: PliUser | UserDirectory | null = null) {
    this.#directory = source === null ? { current: null } : isUser(source) ? { current: source } : source;
    if (this.#directory.current) this.#cache.set(this.#directory.current.id, this.#directory.current);
  }

  get current(): PliUser | null {
    const user = this.#directory.current;
    return user ? this.#complete(user) : null;
  }

  get role(): Role {
    return this.#directory.role ?? "editor";
  }

  /** The user with this id, complete with a color. A placeholder until the directory has answered. */
  get(id: string): PliUser {
    const known = this.#cache.get(id);
    if (known) return this.#complete(known);
    this.prefetch([id]);
    return this.#complete({ id, name: id });
  }

  /** Asks the directory about users not seen yet. Ids asked for in the same moment go in one call. */
  prefetch(ids: readonly string[]): void {
    if (!this.#directory.lookup) return;
    for (const id of ids) if (!this.#cache.has(id) && !this.#asked.has(id)) this.#wanted.add(id);
    if (this.#wanted.size === 0 || this.#scheduled) return;
    this.#scheduled = true;
    Promise.resolve().then(() => {
      this.#scheduled = false;
      const missing = [...this.#wanted];
      this.#wanted.clear();
      for (const id of missing) this.#asked.add(id);
      Promise.resolve(this.#directory.lookup!(missing))
        .then((found) => {
          for (const user of found) this.#cache.set(user.id, user);
          this.#emit();
        })
        // A directory that fails leaves placeholders; the user can still read and write comments.
        .catch(() => {
          for (const id of missing) this.#asked.delete(id);
        });
    });
  }

  /** Remembers users you already have, such as the ones in the room. */
  add(users: readonly PliUser[]): void {
    let changed = false;
    for (const user of users) {
      const old = this.#cache.get(user.id);
      if (!old || old.name !== user.name || old.avatar !== user.avatar || old.color !== user.color) {
        this.#cache.set(user.id, user);
        changed = true;
      }
    }
    if (changed) this.#emit();
  }

  /** Finds users by name, for @mentions. Empty when the directory has no `search`. */
  async search(query: string): Promise<PliUser[]> {
    const found = (await this.#directory.search?.(query)) ?? [];
    this.add(found);
    return found.map((user) => this.#complete(user));
  }

  get canSearch(): boolean {
    return !!this.#directory.search;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #complete(user: PliUser): PliUser {
    return user.color ? user : { ...user, color: userColor(user.id) };
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
