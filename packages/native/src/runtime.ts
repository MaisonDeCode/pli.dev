import {
  CollabRoom,
  CommentClient,
  PliError,
  StorageClient,
  SyncClient,
  ScriptHost,
  Users,
  createAuthority,
  decodeBase64,
  encodeBase64,
  memoryDocumentStore,
  type BlobLike,
  type CommentChange,
  type CommentStore,
  type EditorSession,
  type PliUser,
  type Role,
  type Session,
  type StorageAdapter,
  type SyncModel,
  type Thread,
  type Transport,
  type UserDirectory,
} from "@pli.dev/core";
import { utf8Bytes } from "./utf8";

export { utf8Bytes, utf8Text } from "./utf8";

/**
 * What every editor's native bridge shares: handles, replies, the queue of events for the app, calls from the engine to the
 * app (`hostCall`), timers, and the features of `@pli.dev/core` (users, comments, presence, live editing, files) wired to the
 * app through them. An editor (Documents, Sheets, Decks, PDF) describes itself with an `EditorDef`; `makeBridge` turns those
 * into the functions Swift and Kotlin call.
 *
 * The engine runs in JavaScriptCore and QuickJS with no DOM, no network and no timers of its own, and everything crosses as text.
 * So the engine never calls into the app. It leaves *events* in a queue, which ride back on the next reply (`events`) or are
 * fetched with `pump`, and the app answers a request with `hostResolve`. The app also calls `tick` now and then, which runs the
 * engine's timers (a room's heartbeat) and lets promises settle.
 */

export type Kind = "docs" | "sheets" | "decks" | "pdf";

/** One parameter or return type of a method, in the catalog's words: `string`, `int`, `double`, `bool`, `json`, `T?`, `[T]`, `map<T>`, or the name of a type or enum. */
export interface Param {
  name: string;
  type: string;
  doc?: string;
  /** The values an enum may take. */
  oneOf?: string[];
  /** The enum's name (the Swift and Kotlin types are made from it). */
  enum?: string;
}
export interface Method {
  name: string;
  params: Param[];
  returns: string;
  doc?: string;
}

/** Everything an open document, workbook, deck or PDF has: what the bridge keeps for one handle. */
export interface Ctx {
  id: number;
  kind: Kind;
  def: EditorDef;
  /** The editor's own session object (`DocumentSession`, `SheetSession`, `DeckSession`, `PdfSession`). */
  session: any;
  /** The `Session` of `@pli.dev/core` underneath, which live editing drives. */
  core: Session<any, any, any>;
  /** The id of the file, which comments and rooms are named by. */
  file: string;
  users: Users;
  directory: MutableDirectory;
  /** Which services the app provides: `directory`, `storage`, `comments`. */
  host: Set<string>;
  comments: CommentClient<any> | null;
  storage: StorageClient | null;
  room: CollabRoom<any> | null;
  sync: SyncClient<any, any, any> | null;
  receive: ((data: unknown) => void) | null;
  watching: Set<string>;
  cleanups: (() => void)[];
  /** Whatever the editor keeps beside the session. */
  extra: Record<string, unknown>;
}

export interface MutableDirectory extends UserDirectory {
  current: PliUser | null;
  role?: Role;
}

export interface OpenInput {
  /** `json` for what `document` gives; a file format for bytes. */
  format: string;
  /** Text for `json`, `csv` and the like; the bytes for a file. */
  text: string | null;
  bytes: Uint8Array | null;
}

export interface EditorDef {
  kind: Kind;
  /** The typed methods the app's wrapper has, from the catalog. */
  methods: Method[];
  /** What each method does. */
  run: Record<string, (ctx: Ctx, args: unknown[]) => unknown>;
  /** Makes the session. It sets `ctx.session`, `ctx.core` and `ctx.file`, and may use `ctx.users`, `ctx.host` and `ctx.storage`. */
  open(ctx: Ctx, input: OpenInput, options: Record<string, any>): void;
  /** Sets up comments for the editor (its own, or the generic one) and returns the client. */
  comments(ctx: Ctx, options: Record<string, any>, store: CommentStore<any> | undefined): CommentClient<any>;
  /** The state as JSON text: what `open` takes back as `json`. */
  serialize(ctx: Ctx): string;
  /** Replaces the whole state from JSON text (for the sequencer's first document). */
  parse(text: string): unknown;
  /** Takes the user into the editor (some stamp it on what they make). */
  userChanged?(ctx: Ctx): void;
  exportFile(ctx: Ctx, format: string, options: Record<string, any>): Uint8Array | string | Promise<Uint8Array | string>;
  importFile(ctx: Ctx, format: string, input: OpenInput, options: Record<string, any>): unknown;
  /** The model that says how this editor's operations combine, or null if the build has none. */
  model(): SyncModel<any, any> | null;
  /** The state the editor's presence carries to others by default (nothing). */
  presence?(ctx: Ctx): Record<string, unknown>;
  /** What the app can read about a handle in one go. */
  state(ctx: Ctx): Record<string, unknown>;
  /** A fresh, empty state for a room that has none (the sequencer). */
  create?(room: string): unknown;
  /** The editor's own reads, by name. */
  read?(ctx: Ctx, what: string, args: unknown[]): unknown;
  /** Called when a handle closes. */
  close?(ctx: Ctx): void;
  /** The editor-neutral view of the session (`@pli.dev/core`'s `EditorSession`), which scripts run against. */
  editorSession?(ctx: Ctx): EditorSession<any, any, any>;
  /** Told when live editing starts and stops, for editors that behave differently while shared. */
  syncing?(ctx: Ctx, on: boolean): void;
}

// ---- Replies ----------------------------------------------------------------------------------------------------

const queue: unknown[] = [];

/** Leaves an event for the app. It rides on the next reply. */
export const emit = (event: Record<string, unknown>): void => void queue.push(event);

const take = (): unknown[] | undefined => (queue.length ? queue.splice(0) : undefined);

/** JSON for the app: maps and sets become objects and lists, bytes base64, anything with no JSON form null. */
export function toJson(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value, (_key, v) => {
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return [...v];
    if (v instanceof Uint8Array) return encodeBase64(v);
    if (typeof v === "function" || typeof v === "symbol") return undefined;
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    if (typeof v === "bigint") return Number(v);
    return v;
  });
}

export const ok = (value: unknown, extra: Record<string, unknown> = {}): string => toJson({ ok: true, value: value === undefined ? null : value, ...extra, events: take() });

export const fail = (error: unknown): string => {
  const e = error as { code?: string; message?: string };
  return toJson({ ok: false, error: { code: e?.code ?? "error", message: e?.message ?? String(error) }, events: take() });
};

export function parseJson(text: string | null | undefined): unknown {
  if (text === null || text === undefined || text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new PliError("invalid_operation", "Not valid JSON", { cause });
  }
}

/** The comments of an editor that keeps none in its file: threads in memory (or in the app's store), with whatever anchor the editor gives them. */
export function genericComments(ctx: Ctx, options: Record<string, any>, store: CommentStore<any> | undefined): CommentClient<any> {
  return new CommentClient<any>({ file: ctx.file, users: ctx.users, store, initial: Array.isArray(options.comments) ? options.comments : undefined });
}

// ---- Calls to the app, tasks and timers ---------------------------------------------------------------------------

let hostSeq = 1;
const hostPending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>();

/** Asks the app for something and waits for its answer (`hostResolve`). The app sees it as an event `host`. */
export function hostCall<T = any>(ctx: Ctx | null, kind: string, payload: unknown): Promise<T> {
  const id = hostSeq++;
  return new Promise<T>((resolve, reject) => {
    hostPending.set(id, { resolve, reject });
    emit({ type: "host", handle: ctx?.id ?? 0, id, kind, payload });
  });
}

interface Task {
  done: boolean;
  value?: unknown;
  error?: unknown;
  failed?: boolean;
}
let taskSeq = 1;
const tasks = new Map<number, Task>();

/** Work that isn't finished when a call returns (it waits for the app, or for a promise): the app asks again with `taskResult`. */
function startTask(promise: Promise<unknown>, shape: (value: unknown) => unknown = (v) => v): string {
  const id = taskSeq++;
  const task: Task = { done: false };
  tasks.set(id, task);
  promise.then(
    (value) => {
      try {
        task.value = shape(value);
      } catch (error) {
        task.failed = true;
        task.error = error;
      }
      task.done = true;
    },
    (error) => {
      task.failed = true;
      task.error = error;
      task.done = true;
    },
  );
  return ok(null, { pending: id });
}

const isPromise = (value: unknown): value is Promise<unknown> => !!value && typeof (value as { then?: unknown }).then === "function";

/** A reply for what a method returned: its value, or a task if it is still working. */
function reply(value: unknown, shape?: (value: unknown) => unknown): string {
  return isPromise(value) ? startTask(value, shape) : ok(shape ? shape(value) : value);
}

interface Timer {
  at: number;
  every: number | null;
  fn: () => void;
}
const timers = new Map<number, Timer>();
let timerSeq = 1;
const g = globalThis as Record<string, unknown>;
// JavaScriptCore and QuickJS have no timers. These run when the app calls `tick`.
if (typeof g.setInterval !== "function") {
  g.setInterval = (fn: () => void, ms = 0) => {
    const id = timerSeq++;
    timers.set(id, { at: Date.now() + Math.max(1, ms), every: Math.max(1, ms), fn });
    return id;
  };
  g.setTimeout = (fn: () => void, ms = 0) => {
    const id = timerSeq++;
    timers.set(id, { at: Date.now() + Math.max(0, ms), every: null, fn });
    return id;
  };
  g.clearInterval = g.clearTimeout = (id: number) => void timers.delete(id);
}

function runTimers(): void {
  const now = Date.now();
  for (const [id, timer] of [...timers]) {
    if (timer.at > now || !timers.has(id)) continue;
    if (timer.every === null) timers.delete(id);
    else timer.at = now + timer.every;
    try {
      timer.fn();
    } catch {
      // A timer that throws must not stop the others.
    }
  }
}

// ---- Handles ----------------------------------------------------------------------------------------------------

const handles = new Map<number, Ctx>();
let nextHandle = 1;
const authorities = new Map<number, { kind: Kind; def: EditorDef; authority: ReturnType<typeof createAuthority<any, any>>; initial: string | null }>();

export function ctxOf(id: number): Ctx {
  const found = handles.get(id);
  if (!found) throw new PliError("not_found", `No open document ${id}`);
  return found;
}

export function allHandles(): ReadonlyMap<number, Ctx> {
  return handles;
}

/** A user with what the app sent: it must have an id and a name. */
function userOf(value: unknown): PliUser {
  const u = value as Partial<PliUser> | null;
  if (!u || typeof u.id !== "string" || typeof u.name !== "string") throw new PliError("invalid_operation", "A user has an id and a name");
  return u as PliUser;
}

// ---- What the app provides ----------------------------------------------------------------------------------------

function blobOf(bytes: Uint8Array, type: string): BlobLike {
  return { size: bytes.length, type, arrayBuffer: () => Promise.resolve(bytes.slice().buffer as ArrayBuffer) };
}

function storageAdapter(ctx: Ctx): StorageAdapter {
  return {
    async upload(file, info) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      info.onProgress(0.5);
      const result = await hostCall(ctx, "storage.upload", { name: info.name, type: info.type, data: encodeBase64(bytes) });
      info.onProgress(1);
      return result;
    },
    resolve: (ref) => hostCall<string>(ctx, "storage.resolve", { ref }),
    async read(ref) {
      const found = await hostCall<{ type: string; data: string }>(ctx, "storage.read", { ref });
      return blobOf(decodeBase64(found.data) ?? new Uint8Array(), found.type);
    },
    delete: async (ref) => void (await hostCall(ctx, "storage.delete", { ref })),
  };
}

function hostCommentStore(ctx: Ctx): CommentStore<any> {
  return {
    load: (file) => hostCall<Thread<any>[]>(ctx, "comments.load", { file }),
    save: async (file, change) => void (await hostCall(ctx, "comments.save", { file, change })),
  };
}

/** The transport that hands everything to the app, which carries it to the room (a socket, a hub). */
function nativeTransport(ctx: Ctx): Transport {
  return {
    async connect(room, receive) {
      ctx.receive = receive;
      await hostCall(ctx, "transport.connect", { room });
    },
    send: (data) => void emit({ type: "transport.send", handle: ctx.id, json: toJson(data) }),
    disconnect() {
      ctx.receive = null;
      emit({ type: "transport.disconnect", handle: ctx.id });
    },
  };
}

// ---- Checking arguments against the catalog -----------------------------------------------------------------------

function typeOk(type: string, value: unknown, def: EditorDef | null, param: Param): boolean {
  if (type.endsWith("?")) return value === null || value === undefined || typeOk(type.slice(0, -1), value, def, param);
  if (type.startsWith("[")) return Array.isArray(value) && value.every((v) => typeOk(type.slice(1, -1), v, def, param));
  if (type.startsWith("map<")) return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeOk(type.slice(4, -1), v, def, param));
  switch (type) {
    case "string":
      return typeof value === "string";
    case "bool":
      return typeof value === "boolean";
    case "int":
      return Number.isInteger(value);
    case "double":
      return typeof value === "number" && Number.isFinite(value);
    case "json":
    case "scalar":
      return value !== undefined;
    default:
      // An enum or a type of the catalog: an enum is one of its strings, a type is an object.
      if (param.oneOf) return typeof value === "string" && param.oneOf.includes(value);
      return value !== undefined;
  }
}

export function checkArgs(method: Method, args: unknown[]): void {
  if (!Array.isArray(args) || args.length !== method.params.length) {
    throw new PliError("invalid_operation", `${method.name} takes ${method.params.length} argument${method.params.length === 1 ? "" : "s"}`);
  }
  method.params.forEach((param, i) => {
    const value = args[i];
    const optional = param.type.endsWith("?");
    if (value === null || value === undefined) {
      if (!optional && param.type !== "json" && param.type !== "scalar") throw new PliError("invalid_operation", `${method.name}: ${param.name} is required`);
      return;
    }
    if (param.oneOf && !param.oneOf.includes(value as string)) throw new PliError("invalid_operation", `${method.name}: ${param.name} should be one of ${param.oneOf.join(", ")}`);
    if (!typeOk(param.type, value, null, param)) throw new PliError("invalid_operation", `${method.name}: ${param.name} should be ${param.type}`);
  });
}

// ---- Reaching into a session by name --------------------------------------------------------------------------------

/** `annots.add`, `pages.rotate`, `setCell`: a method of the session (or of one of its command groups), by a path with dots. */
function resolveMethod(root: any, path: string): { owner: any; fn: (...args: unknown[]) => unknown } {
  const parts = path.split(".");
  let owner = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(part) || part === "constructor" || part === "prototype") throw new PliError("not_found", `Nothing called "${path}"`);
    const next = owner?.[part];
    if (i === parts.length - 1) {
      if (typeof next !== "function") throw new PliError("not_found", `Nothing called "${path}" can be called`);
      return { owner, fn: next };
    }
    if (next === null || typeof next !== "object") throw new PliError("not_found", `Nothing called "${path}"`);
    owner = next;
  }
  throw new PliError("not_found", `Nothing called "${path}"`);
}

// ---- The bridge ----------------------------------------------------------------------------------------------------

function listen(ctx: Ctx, what: string, on: boolean): void {
  if (on === ctx.watching.has(what)) return;
  if (!on) {
    ctx.watching.delete(what);
    return;
  }
  ctx.watching.add(what);
  if (what === "change" && !ctx.extra._changeHooked) {
    ctx.extra._changeHooked = true;
    ctx.cleanups.push(
      ctx.core.subscribe((event) => {
        if (!ctx.watching.has("change")) return;
        emit({ type: "change", handle: ctx.id, origin: event.origin, reset: event.reset === true, ops: event.ops, canUndo: ctx.core.canUndo, canRedo: ctx.core.canRedo });
      }),
    );
  }
  if (what === "comments" && ctx.comments && !ctx.extra._commentsHooked) {
    ctx.extra._commentsHooked = true;
    ctx.cleanups.push(
      ctx.comments.onChange((change, origin) => {
        if (ctx.watching.has("comments")) emit({ type: "comments", handle: ctx.id, origin, change });
      }),
    );
  }
}

export interface BridgeOptions {
  /** The version of the engine. */
  version: string;
}

export function makeBridge(defs: EditorDef[], options: BridgeOptions) {
  const byKind = new Map<Kind, EditorDef>(defs.map((d) => [d.kind, d]));
  const methodsOf = new Map<Kind, Map<string, Method>>(defs.map((d) => [d.kind, new Map(d.methods.map((m) => [m.name, m]))]));
  const need = <T>(value: T | null | undefined, message: string): T => {
    if (value === null || value === undefined) throw new PliError("unsupported", message);
    return value;
  };
  const guard = (fn: () => string): string => {
    try {
      return fn();
    } catch (error) {
      return fail(error);
    }
  };

  function setUser(ctx: Ctx, user: PliUser | null, role?: Role): void {
    ctx.directory.current = user;
    if (role) ctx.directory.role = role;
    if (user) ctx.users.add([user]);
    ctx.def.userChanged?.(ctx);
  }

  function commentsOf(ctx: Ctx): CommentClient<any> {
    return need(ctx.comments, "Comments aren't turned on for this document");
  }

  function open(kind: Kind, input: OpenInput, optionsText: string | null | undefined): string {
    const def = need(byKind.get(kind), `This engine doesn't have ${kind}`);
    const opts = (parseJson(optionsText) ?? {}) as Record<string, any>;
    const directory: MutableDirectory = { current: null };
    const host = new Set<string>(Array.isArray(opts.host) ? opts.host : []);
    const ctx = { id: nextHandle, kind, def, directory, host, watching: new Set(), cleanups: [], extra: {}, comments: null, storage: null, room: null, sync: null, receive: null } as unknown as Ctx;
    if (host.has("directory")) {
      directory.lookup = (ids) => hostCall(ctx, "users.lookup", { ids });
      directory.search = (query) => hostCall(ctx, "users.search", { query });
    }
    ctx.users = new Users(directory);
    if (opts.user) setUser(ctx, userOf(opts.user), opts.user.role ?? opts.role ?? "editor");
    else if (opts.role) directory.role = opts.role;
    if (host.has("storage")) ctx.storage = new StorageClient(storageAdapter(ctx), opts.storage ?? {});
    const store = host.has("comments") ? hostCommentStore(ctx) : undefined;
    ctx.extra.commentStore = store;
    def.open(ctx, input, opts);
    ctx.comments = def.comments(ctx, opts, store);
    handles.set(nextHandle++, ctx);
    return ok(ctx.id);
  }

  const bridge = {
    version: options.version,

    /** The kinds of editor this engine has. */
    editors(): string {
      return ok([...byKind.keys()]);
    },

    /** The methods of an editor's typed API. */
    methods(kind: Kind): string {
      return guard(() => ok(need(byKind.get(kind), `No ${kind}`).methods.map((m) => m.name)));
    },

    /** Opens a document, workbook, deck or PDF. `format` is `json` or a file format; files are base64. Returns the handle. */
    openEditor(kind: Kind, format: string, data: string | null, optionsJson?: string | null): string {
      return guard(() => {
        const binary = !["json", "csv", "tsv", "html", "md", "markdown", "txt"].includes(format);
        let bytes: Uint8Array | null = null;
        if (data !== null && data !== undefined && binary) {
          bytes = decodeBase64(data);
          if (!bytes) throw new PliError("invalid_document", "The file isn't valid base64");
        }
        return open(kind, { format, text: binary ? null : data ?? null, bytes }, optionsJson);
      });
    },

    close(handle: number): string {
      return guard(() => {
        const ctx = handles.get(handle);
        if (!ctx) return ok(false);
        ctx.sync?.stop();
        ctx.room?.disconnect();
        for (const cleanup of ctx.cleanups.splice(0)) cleanup();
        ctx.comments?.dispose();
        ctx.def.close?.(ctx);
        handles.delete(handle);
        return ok(true);
      });
    },

    /** Runs a method of the typed API with its arguments as a JSON array. */
    invoke(handle: number, name: string, argsJson: string): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const method = methodsOf.get(ctx.kind)!.get(name);
        const run = ctx.def.run[name];
        if (!method || !run) throw new PliError("not_found", `No command called "${name}"`);
        const args = (parseJson(argsJson) ?? []) as unknown[];
        checkArgs(method, args);
        const value = run(ctx, args);
        return reply(value, method.returns === "void" ? () => null : undefined);
      });
    },

    /** Calls any method of the editor's session by name (`setCell`, `annots.add`) with a JSON array, for what the typed API doesn't cover. */
    call(handle: number, path: string, argsJson: string): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const args = (parseJson(argsJson) ?? []) as unknown[];
        if (!Array.isArray(args)) throw new PliError("invalid_operation", "The arguments are a JSON array");
        const { owner, fn } = resolveMethod(ctx.session, path);
        return reply(fn.apply(owner, args));
      });
    },

    /** Applies operations (the JSON each editor's operations are, the same that live editing sends) as one undoable step. */
    apply(handle: number, opsJson: string, optionsJson?: string | null): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const ops = parseJson(opsJson);
        if (!Array.isArray(ops)) throw new PliError("invalid_operation", "Operations are a JSON array");
        const options = (parseJson(optionsJson) ?? {}) as Record<string, unknown>;
        (ctx.session.transact ?? ctx.core.transact).call(ctx.session.transact ? ctx.session : ctx.core, ops, options);
        return ok(true);
      });
    },

    /** Reads something: `document`, `state`, or one of the editor's own reads. */
    read(handle: number, what: string, argsJson?: string | null): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        if (what === "document") return ok(ctx.def.serialize(ctx));
        if (what === "state") return ok({ canUndo: ctx.core.canUndo, canRedo: ctx.core.canRedo, ...ctx.def.state(ctx) });
        const args = (parseJson(argsJson) ?? []) as unknown[];
        if (!ctx.def.read) throw new PliError("not_found", `Nothing called "${what}" can be read`);
        return reply(ctx.def.read(ctx, what, args));
      });
    },

    /** The file in a format, as base64. Work that takes a while (a PDF) comes back as a task. */
    exportFile(handle: number, format: string, optionsJson?: string | null): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const out = ctx.def.exportFile(ctx, format, (parseJson(optionsJson) ?? {}) as Record<string, any>);
        const shape = (v: unknown) => encodeBase64(typeof v === "string" ? utf8Bytes(v) : (v as Uint8Array));
        return reply(out, shape);
      });
    },

    /** Replaces what is open with a file (`json`, or base64 for a file format). Returns what the editor says about it (warnings, authors). */
    importFile(handle: number, format: string, data: string, optionsJson?: string | null): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const binary = !["json", "csv", "tsv", "html", "md", "markdown", "txt"].includes(format);
        const bytes = binary ? decodeBase64(data) : null;
        if (binary && !bytes) throw new PliError("invalid_document", "The file isn't valid base64");
        return reply(ctx.def.importFile(ctx, format, { format, text: binary ? null : data, bytes }, (parseJson(optionsJson) ?? {}) as Record<string, any>));
      });
    },

    // ---- Events, tasks and time ---------------------------------------------------------------------------------

    /** Starts or stops sending an event kind for a handle: `change`, `comments`, `peers`, `sync`. */
    watch(handle: number, what: string, on: boolean): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        listen(ctx, what, on);
        return ok(true);
      });
    },

    /** Returns the events that are waiting (they also ride on every reply). */
    pump(): string {
      return ok(null);
    },

    /** Runs due timers and lets promises settle. The app calls it about once a second while a room is open. */
    tick(): string {
      runTimers();
      return ok(timers.size);
    },

    /** The answer to a call that came back pending: the same pending again, or the final reply. */
    taskResult(id: number): string {
      const task = tasks.get(id);
      if (!task) return fail(new PliError("not_found", `No task ${id}`));
      if (!task.done) return ok(null, { pending: id });
      tasks.delete(id);
      return task.failed ? fail(task.error) : ok(task.value);
    },

    /** The app's answer to a `host` event: a result as JSON, or an error. */
    hostResolve(id: number, resultJson: string | null, errorJson?: string | null): string {
      return guard(() => {
        const pending = hostPending.get(id);
        if (!pending) return ok(false);
        hostPending.delete(id);
        if (errorJson) {
          const e = (parseJson(errorJson) ?? {}) as { code?: string; message?: string };
          pending.reject(new PliError((e.code as never) ?? "storage", e.message ?? "The app couldn't do that"));
        } else {
          pending.resolve(parseJson(resultJson) ?? null);
        }
        return ok(true);
      });
    },

    // ---- Users ----------------------------------------------------------------------------------------------------

    setUser(handle: number, userJson: string | null, role?: string | null): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const user = userJson ? userOf(parseJson(userJson)) : null;
        setUser(ctx, user, (role ?? undefined) as Role | undefined);
        return ok(true);
      });
    },

    currentUser(handle: number): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        return ok({ user: ctx.users.current, role: ctx.users.role });
      });
    },

    addUsers(handle: number, usersJson: string): string {
      return guard(() => {
        const list = parseJson(usersJson);
        if (!Array.isArray(list)) throw new PliError("invalid_operation", "Users are a JSON array");
        ctxOf(handle).users.add(list.map(userOf));
        return ok(true);
      });
    },

    getUser(handle: number, id: string): string {
      return guard(() => ok(ctxOf(handle).users.get(id)));
    },

    searchUsers(handle: number, query: string): string {
      return guard(() => reply(ctxOf(handle).users.search(query)));
    },

    // ---- Comments -----------------------------------------------------------------------------------------------------

    comments(handle: number): string {
      return guard(() => ok(commentsOf(ctxOf(handle)).threads));
    },

    commentsCan(handle: number, action: string, threadId?: string | null): string {
      return guard(() => {
        const client = commentsOf(ctxOf(handle));
        const thread = threadId ? client.thread(threadId) : undefined;
        return ok(client.can(action as never, thread));
      });
    },

    commentsCreate(handle: number, body: string, anchorJson: string | null, mentionsJson?: string | null): string {
      return guard(() => {
        const client = commentsOf(ctxOf(handle));
        return ok(client.createThread(body, parseJson(anchorJson), undefined, (parseJson(mentionsJson) as string[] | undefined) ?? undefined));
      });
    },

    commentsReply(handle: number, threadId: string, body: string, mentionsJson?: string | null): string {
      return guard(() => ok(commentsOf(ctxOf(handle)).reply(threadId, body, (parseJson(mentionsJson) as string[] | undefined) ?? undefined)));
    },

    commentsEdit(handle: number, threadId: string, commentId: string, body: string, mentionsJson?: string | null): string {
      return guard(() => {
        commentsOf(ctxOf(handle)).editComment(threadId, commentId, body, (parseJson(mentionsJson) as string[] | undefined) ?? undefined);
        return ok(true);
      });
    },

    commentsDelete(handle: number, threadId: string, commentId: string | null): string {
      return guard(() => {
        const client = commentsOf(ctxOf(handle));
        if (commentId) client.deleteComment(threadId, commentId);
        else client.deleteThread(threadId);
        return ok(true);
      });
    },

    commentsResolve(handle: number, threadId: string, resolved: boolean): string {
      return guard(() => {
        const client = commentsOf(ctxOf(handle));
        if (resolved) client.resolve(threadId);
        else client.reopen(threadId);
        return ok(true);
      });
    },

    /** Takes in a change someone else made (from your own store's feed): it isn't saved or sent on. */
    commentsReceive(handle: number, changeJson: string): string {
      return guard(() => {
        commentsOf(ctxOf(handle)).receive(parseJson(changeJson) as CommentChange<any>);
        return ok(true);
      });
    },

    commentsReload(handle: number): string {
      return guard(() => reply(commentsOf(ctxOf(handle)).reload().then(() => null)));
    },

    // ---- Scripts ----------------------------------------------------------------------------------------------------------

    /**
     * Runs a script against the file, the way `ScriptHost` of `@pli.dev/core` does: `source` is the body of a function of `ctx`
     * (`ctx.state` to read, `ctx.apply(ops)` to change, `ctx.can(capability)`), and what it returns comes back as JSON. One run is one
     * undo step; a run that throws is taken back. Limits and grants come from the options: `grants` (`read`, `write`, `comments`,
     * `create`; default read and write), `maxOps` and `maxMs`.
     *
     * The script runs in the engine's own JavaScript world, which has no network or files, but it is not a barrier against hostile
     * code: run scripts your app wrote or has checked.
     */
    scriptRun(handle: number, source: string, optionsJson?: string | null): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const view = need(ctx.def.editorSession?.(ctx), "This editor can't run scripts");
        const options = (parseJson(optionsJson) ?? {}) as { grants?: string[]; maxOps?: number; maxMs?: number };
        let run: (context: unknown) => unknown;
        try {
          run = new Function("ctx", `"use strict";\n${source}`) as (context: unknown) => unknown;
        } catch (cause) {
          throw new PliError("invalid_operation", `The script has a mistake: ${(cause as Error).message}`, { cause });
        }
        const host = new ScriptHost<any, any, any>(view, { grants: options.grants as never, maxOps: options.maxOps, maxMs: options.maxMs });
        return ok(host.run((context) => run(context)));
      });
    },

    // ---- Files ----------------------------------------------------------------------------------------------------------

    storageUpload(handle: number, name: string, type: string, base64: string): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const storage = need(ctx.storage, "No storage: open the document with a storage adapter");
        const bytes = decodeBase64(base64);
        if (!bytes) throw new PliError("invalid_operation", "The file isn't valid base64");
        return reply(storage.upload(blobOf(bytes, type), { name, type }));
      });
    },

    storageResolve(handle: number, ref: string): string {
      return guard(() => reply(need(ctxOf(handle).storage, "No storage: open the document with a storage adapter").resolve(ref)));
    },

    storageRead(handle: number, ref: string): string {
      return guard(() =>
        reply(
          need(ctxOf(handle).storage, "No storage: open the document with a storage adapter")
            .read(ref)
            .then(async (blob) => ({ type: blob.type, data: encodeBase64(new Uint8Array(await blob.arrayBuffer())) })),
        ),
      );
    },

    storageDelete(handle: number, ref: string): string {
      return guard(() => reply(need(ctxOf(handle).storage, "No storage: open the document with a storage adapter").delete(ref).then(() => null)));
    },

    // ---- Live editing -----------------------------------------------------------------------------------------------------

    /** Joins a room: presence, comments and live editing travel through the app's transport (`host` events `transport.*`). */
    syncStart(handle: number, optionsJson: string): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        if (ctx.sync) throw new PliError("invalid_operation", "Already in a room: stop first");
        const opts = (parseJson(optionsJson) ?? {}) as { room?: string; version?: number | null; verifyEvery?: number; heartbeat?: number; timeout?: number; live?: boolean };
        const room = opts.room ?? ctx.file;
        const model = opts.live === false ? null : need(ctx.def.model(), `Live editing isn't available for ${ctx.kind} in this build`);
        const collab = new CollabRoom<any>({ room, transport: nativeTransport(ctx), users: ctx.users, comments: ctx.comments ?? undefined, heartbeat: opts.heartbeat, timeout: opts.timeout });
        ctx.room = collab;
        ctx.cleanups.push(
          collab.subscribe(() => {
            if (ctx.watching.has("peers")) emit({ type: "peers", handle: ctx.id, status: collab.status, peers: collab.peers });
          }),
        );
        if (model) {
          const client = new SyncClient<any, any, any>({
            session: ctx.core,
            room: collab,
            model,
            version: opts.version ?? null,
            verifyEvery: opts.verifyEvery ?? 30_000,
            onResync: (info) => emit({ type: "resync", handle: ctx.id, reason: info.reason, lost: info.lost }),
          });
          ctx.sync = client;
          ctx.cleanups.push(
            client.subscribe(() => {
              if (ctx.watching.has("sync")) emit({ type: "sync", handle: ctx.id, status: client.status, unsynced: client.unsynced, version: client.version });
            }),
          );
          client.start();
          ctx.def.syncing?.(ctx, true);
        }
        void collab.connect().catch((error) => emit({ type: "error", handle: ctx.id, code: (error as { code?: string }).code ?? "error", message: String((error as Error).message ?? error) }));
        return ok(true);
      });
    },

    syncStop(handle: number): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        if (ctx.sync) ctx.def.syncing?.(ctx, false);
        ctx.sync?.stop();
        ctx.room?.disconnect();
        ctx.sync = null;
        ctx.room = null;
        return ok(true);
      });
    },

    syncStatus(handle: number): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        return ok({ room: ctx.room?.status ?? "idle", status: ctx.sync?.status ?? (ctx.room ? "synced" : "offline"), unsynced: ctx.sync?.unsynced ?? 0, version: ctx.sync?.version ?? null, lastResync: ctx.sync?.lastResync ?? null });
      });
    },

    syncOnline(handle: number, online: boolean): string {
      return guard(() => {
        ctxOf(handle).sync?.setOnline(online);
        return ok(true);
      });
    },

    syncResync(handle: number): string {
      return guard(() => {
        ctxOf(handle).sync?.resync("asked to");
        return ok(true);
      });
    },

    /** A message from the room, as JSON text (what the transport receives). */
    transportReceive(handle: number, json: string): string {
      return guard(() => {
        ctxOf(handle).receive?.(parseJson(json));
        return ok(true);
      });
    },

    setPresence(handle: number, stateJson: string): string {
      return guard(() => {
        const ctx = ctxOf(handle);
        const room = need(ctx.room, "Not in a room: start syncing first");
        room.setPresence({ ...ctx.def.presence?.(ctx), ...((parseJson(stateJson) ?? {}) as Record<string, unknown>) });
        return ok(true);
      });
    },

    peers(handle: number): string {
      return guard(() => ok(ctxOf(handle).room?.peers ?? []));
    },

    // ---- A sequencer that runs in the app ---------------------------------------------------------------------------------

    /**
     * Opens a sequencer (`createAuthority` over a memory store) for this kind of editor: a device, or a test, can hold the shared
     * document for a room. `initialJson` is the state a room starts from. Messages go in with `authorityReceive`; its answers
     * leave as `authority.send` events with the JSON to deliver to everyone in the room.
     */
    authorityOpen(kind: Kind, initialJson: string | null): string {
      return guard(() => {
        const def = need(byKind.get(kind), `This engine doesn't have ${kind}`);
        const model = need(def.model(), `Live editing isn't available for ${kind} in this build`);
        const id = nextHandle++;
        const initial = initialJson ?? null;
        const authority = createAuthority<any, any>({
          store: memoryDocumentStore<any, any>(),
          model,
          create: (room) => (initial ? def.parse(initial) : def.create ? def.create(room) : (() => { throw new PliError("not_found", `No document for room "${room}"`); })()),
          onError: (error, room) => emit({ type: "error", handle: id, code: (error as { code?: string }).code ?? "error", message: `${room}: ${String((error as Error).message ?? error)}` }),
        });
        authorities.set(id, { kind, def, authority, initial });
        return ok(id);
      });
    },

    authorityReceive(id: number, room: string, json: string): string {
      return guard(() => {
        const found = authorities.get(id);
        if (!found) throw new PliError("not_found", `No sequencer ${id}`);
        return reply(found.authority.receive(room, parseJson(json), (envelope) => emit({ type: "authority.send", handle: id, room, json: toJson(envelope) })).then(() => null));
      });
    },

    authorityClose(id: number): string {
      return ok(authorities.delete(id));
    },
  };

  return bridge;
}

export type PliBridge = ReturnType<typeof makeBridge>;
