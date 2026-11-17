/**
 * Reads a method written as `name(a: string, b: int?, c: Enum): returns` into what the engine and the generator share:
 * `{ name, params: [{ name, type, oneOf?, enum? }], returns }`. A parameter whose type names one of `enums` carries its values.
 */
export function parseSignature(sig, enums = {}) {
  const match = /^\s*(\w+)\s*\(([\s\S]*)\)\s*:\s*(\S[\s\S]*?)\s*$/.exec(sig);
  if (!match) throw new Error(`Not a method signature: ${sig}`);
  const [, name, inner, returns] = match;
  const params = [];
  let depth = 0;
  let current = "";
  const parts = [];
  for (const ch of inner) {
    if (ch === "<" || ch === "[") depth++;
    if (ch === ">" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  for (const part of parts) {
    const p = /^\s*(\w+)\s*:\s*(\S[\s\S]*?)\s*$/.exec(part);
    if (!p) throw new Error(`Not a parameter in ${name}: ${part}`);
    const type = p[2];
    const bare = type.replace(/\?$/, "");
    params.push(enums[bare] ? { name: p[1], type, enum: bare, oneOf: enums[bare] } : { name: p[1], type });
  }
  return { name, params, returns };
}
