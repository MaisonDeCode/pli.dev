/** Helpers for changing dictionaries and arrays that may be direct or indirect, through the overlay. */
import { PdfDict, PdfRef, isArray, isDict, isRef } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { Overlay } from "../cos/overlay";

/**
 * The dictionary under `key` of `parent`, ready to change: a referenced one becomes a private copy in the overlay,
 * a direct one is changed in place (so `parent` itself must be a private copy), a missing one is made.
 */
export function editChild(o: Overlay, parent: PdfDict, key: string): PdfDict {
  const v = parent.get(key);
  if (isRef(v)) {
    if (isDict(o.get(v))) return o.edit<PdfDict>(v);
  } else if (isDict(v)) return v;
  const d = new PdfDict();
  parent.set(key, d);
  return d;
}

/** The array under `key` of `parent`, ready to change (same rules as `editChild`). */
export function editList(o: Overlay, parent: PdfDict, key: string): PdfObj[] {
  const v = parent.get(key);
  if (isArray(v)) return v;
  if (isRef(v) && isArray(o.get(v))) return o.edit<PdfObj[]>(v);
  const a: PdfObj[] = [];
  parent.set(key, a);
  return a;
}

/** Removes the references to object `num` from an array. Returns whether it was there. */
export function dropRef(list: PdfObj[], ref: PdfRef): boolean {
  let found = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (isRef(e) && e.num === ref.num) {
      list.splice(i, 1);
      found = true;
    }
  }
  return found;
}
