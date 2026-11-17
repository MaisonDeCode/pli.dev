import { PliError } from "./errors";
import type { PliUser, Role, Users } from "./users";

/**
 * Who a file is shared with, and how. Like comments, it is the same for every editor and keeps nothing of its own: your
 * app already has an idea of who may open what, and `SharingStore` is how Pli reads and writes it. The `ShareClient` here
 * is what the Share dialog works on; `roleOf` is what you hand a server (or `UserDirectory.role`) to decide what a person
 * may do.
 */

/** One person (or one invitation to an address) with a role. */
export interface Grant {
  /** The `PliUser.id`, for a person your directory knows. */
  userId?: string;
  /** An address, for someone invited who has no account yet. */
  email?: string;
  role: Role;
  /** Who gave it. */
  by?: string;
  at: number;
}

/** Access for anyone who has the link. */
export interface LinkAccess {
  enabled: boolean;
  /** What a person who opens the link may do. Never more than `editor`. */
  role: Role;
  /** Who may use it: anyone at all, or only signed-in people. */
  audience?: "anyone" | "signed-in";
}

/** Everything about who has access, as one JSON value. */
export interface ShareSettings {
  /** The owner always has full access and can't be removed. */
  owner?: string;
  grants: Grant[];
  link: LinkAccess;
}

/** One change to the settings. Applying the same change twice leaves the same settings. */
export type ShareChange =
  | { type: "grant"; grant: Grant }
  | { type: "revoke"; userId?: string; email?: string }
  | { type: "link"; link: LinkAccess }
  | { type: "owner"; userId: string };

export const NOBODY: ShareSettings = { grants: [], link: { enabled: false, role: "viewer" } };

const same = (a: Grant, b: { userId?: string; email?: string }) => (a.userId !== undefined && a.userId === b.userId) || (a.email !== undefined && b.email !== undefined && a.email.toLowerCase() === b.email.toLowerCase());

/** Applies one change, returning the new settings. */
export function applyShareChange(settings: ShareSettings, change: ShareChange): ShareSettings {
  switch (change.type) {
    case "grant":
      return { ...settings, grants: [...settings.grants.filter((g) => !same(g, change.grant)), change.grant] };
    case "revoke":
      return { ...settings, grants: settings.grants.filter((g) => !same(g, change)) };
    case "link":
      return { ...settings, link: change.link };
    case "owner":
      return { ...settings, owner: change.userId };
  }
}

/** Where sharing settings are kept. Only `load` and `save` are required. */
export interface SharingStore {
  load(file: string): ShareSettings | Promise<ShareSettings>;
  save(file: string, change: ShareChange): void | Promise<void>;
  subscribe?(file: string, listener: (change: ShareChange) => void): () => void;
}

export function memorySharingStore(initial: Record<string, ShareSettings> = {}): SharingStore & { settings(file: string): ShareSettings } {
  const files = new Map<string, ShareSettings>(Object.entries(initial));
  const listeners = new Map<string, Set<(change: ShareChange) => void>>();
  return {
    settings: (file) => files.get(file) ?? NOBODY,
    load: (file) => JSON.parse(JSON.stringify(files.get(file) ?? NOBODY)) as ShareSettings,
    save(file, change) {
      files.set(file, applyShareChange(files.get(file) ?? NOBODY, change));
      for (const listener of listeners.get(file) ?? []) listener(change);
    },
    subscribe(file, listener) {
      const set = listeners.get(file) ?? new Set();
      listeners.set(file, set);
      set.add(listener);
      return () => set.delete(listener);
    },
  };
}

/** What a person may do with the sharing of a file. */
export type ShareAction = "view" | "invite" | "changeRole" | "remove" | "link";

export interface ShareClientOptions {
  file: string;
  /** Who is sharing, and the directory used to look people up (`UserDirectory.search`). */
  users: Users;
  store?: SharingStore;
  /** Starting settings, shown at once; the store's replace them when loaded. */
  initial?: ShareSettings;
  /** The address of the file, for "Copy link". Without it there is no link to copy. */
  linkUrl?: (file: string) => string;
  /** Decides who may do what where the default (the owner and editors manage sharing) is not right. Return undefined to leave it to the default. */
  permissions?(action: ShareAction, context: { user: { id: string; role: Role }; settings: ShareSettings }): boolean | undefined;
  onError?(error: PliError, change: ShareChange): void;
}

type Listener = () => void;

/** The sharing of one file as the Share dialog sees it. Changes show at once and are then handed to the store; one it refuses is taken back. */
export class ShareClient {
  readonly file: string;
  readonly users: Users;
  readonly #options: ShareClientOptions;
  #confirmed: ShareSettings;
  #pending: ShareChange[] = [];
  #settings: ShareSettings;
  #listeners = new Set<Listener>();
  #status: "loading" | "ready" | "error" = "ready";
  #queue: Promise<void> = Promise.resolve();
  #ready: Promise<void>;
  #unsubscribe: (() => void) | null = null;

  constructor(options: ShareClientOptions) {
    this.#options = options;
    this.file = options.file;
    this.users = options.users;
    this.#confirmed = options.initial ?? NOBODY;
    this.#settings = this.#confirmed;
    this.#ready = options.store ? this.reload() : Promise.resolve();
    this.#unsubscribe = options.store?.subscribe?.(options.file, (change) => this.receive(change)) ?? null;
  }

  get settings(): ShareSettings {
    return this.#settings;
  }

  get status(): "loading" | "ready" | "error" {
    return this.#status;
  }

  get ready(): Promise<void> {
    return this.#ready;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
  }

  reload(): Promise<void> {
    const store = this.#options.store;
    if (!store) return Promise.resolve();
    this.#status = "loading";
    this.#emit();
    this.#ready = Promise.resolve(store.load(this.file)).then(
      (loaded) => {
        this.#confirmed = loaded;
        this.#status = "ready";
        this.#rebuild();
      },
      () => {
        this.#status = "error";
        this.#emit();
      },
    );
    return this.#ready;
  }

  /** Takes in a change made elsewhere. It is not saved again. */
  receive(change: ShareChange): void {
    this.#confirmed = applyShareChange(this.#confirmed, change);
    this.#rebuild();
  }

  /**
   * What a person may do with this file: the owner and anyone with a grant, else what the link gives. `null` means no access
   * at all. Use it for `UserDirectory.role` on the client, and on your server to refuse what a role doesn't allow.
   */
  roleOf(user: Pick<PliUser, "id" | "email"> | null): Role | null {
    const s = this.#settings;
    if (user && s.owner === user.id) return "editor";
    const grant = user ? s.grants.find((g) => same(g, { userId: user.id, email: user.email })) : undefined;
    const link = s.link.enabled && (s.link.audience !== "signed-in" || !!user) ? s.link.role : null;
    return best(grant?.role ?? null, link);
  }

  /** Whether the current user may do this. Use it to hide controls; the methods below check it too. */
  can(action: ShareAction): boolean {
    const user = this.users.current;
    if (!user) return action === "view" ? this.roleOf(null) !== null : false;
    const role = this.roleOf(user) ?? this.users.role;
    const decided = this.#options.permissions?.(action, { user: { id: user.id, role }, settings: this.#settings });
    if (decided !== undefined) return decided;
    if (action === "view") return true;
    return role === "editor";
  }

  /** Gives people access. People are users from the directory, or addresses of people with no account. */
  invite(people: readonly (PliUser | string)[], role: Role): void {
    const by = this.#need("invite");
    const at = Date.now();
    for (const person of people) {
      const grant: Grant = typeof person === "string" ? { email: person.trim(), role, by, at } : { userId: person.id, ...(person.email ? { email: person.email } : {}), role, by, at };
      if (typeof person === "string" && !/^\S+@\S+\.\S+$/.test(grant.email!)) throw new PliError("invalid_operation", `"${person}" doesn't look like an email address`);
      if (grant.userId === this.#settings.owner) continue;
      this.#local({ type: "grant", grant });
    }
  }

  /** Changes a person's role. */
  setRole(who: { userId?: string; email?: string }, role: Role): void {
    const by = this.#need("changeRole");
    const old = this.#settings.grants.find((g) => same(g, who));
    if (!old) throw new PliError("not_found", "That person has no access to change");
    this.#local({ type: "grant", grant: { ...old, role, by, at: Date.now() } });
  }

  /** Takes a person's access away. The owner can't be removed. */
  remove(who: { userId?: string; email?: string }): void {
    this.#need("remove");
    if (who.userId !== undefined && who.userId === this.#settings.owner) throw new PliError("invalid_operation", "The owner always has access");
    this.#local({ type: "revoke", ...who });
  }

  /** Turns the link on or off, or changes what it gives. */
  setLink(patch: Partial<LinkAccess>): void {
    this.#need("link");
    this.#local({ type: "link", link: { ...this.#settings.link, ...patch } });
  }

  /** The address to share, if the link is on and the app told us where files live. */
  get linkUrl(): string | null {
    return this.#settings.link.enabled && this.#options.linkUrl ? this.#options.linkUrl(this.file) : null;
  }

  /** Finds people to invite from the directory, leaving out those who already have access. */
  async search(query: string): Promise<PliUser[]> {
    const found = await this.users.search(query);
    const have = new Set(this.#settings.grants.flatMap((g) => (g.userId ? [g.userId] : [])));
    if (this.#settings.owner) have.add(this.#settings.owner);
    return found.filter((u) => !have.has(u.id) && u.id !== this.users.current?.id);
  }

  #need(action: ShareAction): string {
    const user = this.users.current;
    if (!user) throw new PliError("invalid_operation", "Sign in to share");
    if (!this.can(action)) throw new PliError("invalid_operation", `Not allowed to ${action === "link" ? "change the link" : action}`);
    return user.id;
  }

  #local(change: ShareChange): void {
    this.#pending.push(change);
    this.#rebuild();
    if (!this.#options.store) {
      this.#pending = this.#pending.filter((c) => c !== change);
      this.#confirmed = applyShareChange(this.#confirmed, change);
      return;
    }
    this.#queue = this.#queue.then(async () => {
      if (!this.#pending.includes(change)) return;
      try {
        await this.#options.store!.save(this.file, change);
        this.#pending = this.#pending.filter((c) => c !== change);
        this.#confirmed = applyShareChange(this.#confirmed, change);
        this.#rebuild();
      } catch (cause) {
        this.#pending = this.#pending.filter((c) => c !== change);
        this.#rebuild();
        this.#options.onError?.(new PliError("storage", "Couldn't save the sharing settings", { cause }), change);
      }
    });
  }

  #rebuild(): void {
    this.#settings = this.#pending.reduce(applyShareChange, this.#confirmed);
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

const order: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2 };
function best(a: Role | null, b: Role | null): Role | null {
  if (a === null) return b;
  if (b === null) return a;
  return order[a] >= order[b] ? a : b;
}
