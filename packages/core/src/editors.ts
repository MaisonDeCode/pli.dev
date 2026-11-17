import { PliError } from "./errors";
import type { EditorSession } from "./editor-session";
import type { SyncModel } from "./sync";

/**
 * What a server (or any tool that handles a file without an editor on screen) needs to know about an editor kind: how
 * its operations merge, and how to make an empty one for a room nobody has opened.
 */
export interface EditorDefinition<State = any, Op = any, Meta = any> {
  /** The name: `"document"`, `"sheet"`, `"deck"`, `"pdf"`, or yours. It is what room names start with. */
  kind: string;
  model: SyncModel<State, Op>;
  /** Makes the state of a room that has none yet. Without it, the room must exist before anyone joins. */
  create?(room: string): State | Promise<State>;
  /** Wraps a state in a session, for scripts and server-side tools. */
  open?(state: State): EditorSession<State, Op, Meta>;
}

/** The editors a server knows, by kind. */
export class EditorRegistry {
  #editors = new Map<string, EditorDefinition>();

  constructor(definitions: readonly EditorDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  /** Adds an editor kind. Registering a kind twice is a mistake and throws. */
  register<State, Op, Meta = any>(definition: EditorDefinition<State, Op, Meta>): this {
    if (!/^[a-z][a-z0-9-]*$/.test(definition.kind)) throw new PliError("invalid_operation", `"${definition.kind}" is not a valid editor kind: use lowercase letters, digits and dashes`);
    if (this.#editors.has(definition.kind)) throw new PliError("invalid_operation", `The "${definition.kind}" editor is already registered`);
    this.#editors.set(definition.kind, definition as EditorDefinition);
    return this;
  }

  has(kind: string): boolean {
    return this.#editors.has(kind);
  }

  get(kind: string): EditorDefinition | undefined {
    return this.#editors.get(kind);
  }

  get kinds(): string[] {
    return [...this.#editors.keys()];
  }
}

/** The name of a room for a file of some editor kind: `sheet:budget-2026`. A name without a kind is a `document` by convention. */
export function roomName(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/** Splits a room name made by `roomName`. A name with no kind has `kind: null`. */
export function parseRoom(room: string): { kind: string | null; id: string } {
  const match = /^([a-z][a-z0-9-]*):(.+)$/.exec(room);
  return match ? { kind: match[1]!, id: match[2]! } : { kind: null, id: room };
}
