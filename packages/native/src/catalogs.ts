import editors from "./editors.json";
import { parseSignature } from "./signature.mjs";
import type { Method } from "./runtime";

/** The methods of an editor's typed API, read from `editors.json`: the engine checks every call against these. */
export function methodsFor(editor: "docs" | "sheets" | "decks" | "pdf"): Method[] {
  const entry = editors.editors[editor] as { enums: Record<string, string[]>; methods: { sig: string; doc: string }[] };
  return entry.methods.map((m) => ({ ...parseSignature(m.sig, entry.enums), doc: m.doc }));
}
