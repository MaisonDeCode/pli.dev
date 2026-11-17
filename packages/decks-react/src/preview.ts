import type { ResolvedElement, Scene } from "@pli.dev/decks";
import type { Frame } from "./geometry";

/** A scene with some elements at other frames (what a drag looks like before it is committed). Children of a group follow it. */
export function withFrames(scene: Scene, frames: ReadonlyMap<string, Frame>): Scene {
  if (frames.size === 0) return scene;
  const place = (el: ResolvedElement): ResolvedElement => {
    const f = frames.get(el.id);
    let next = el;
    if (f) {
      next = { ...el, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation };
      if (el.children) {
        const sx = el.w ? f.w / el.w : 1;
        const sy = el.h ? f.h / el.h : 1;
        const move = (c: ResolvedElement): ResolvedElement => ({
          ...c,
          x: f.x + (c.x - el.x) * sx,
          y: f.y + (c.y - el.y) * sy,
          w: c.w * sx,
          h: c.h * sy,
          children: c.children?.map(move),
        });
        next = { ...next, children: el.children.map(move) };
      }
      return next;
    }
    if (el.children?.some((c) => frames.has(c.id))) next = { ...el, children: el.children.map(place) };
    return next;
  };
  return { ...scene, elements: scene.elements.map(place) };
}
