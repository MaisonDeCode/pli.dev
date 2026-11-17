import type { DocumentSession, ImageBlock } from "@pli.dev/docs";
import type { MenuEntry } from "./primitives";

/** Crops a picture to a shape (width over height), from the middle of the whole picture. */
function cropToShape(session: DocumentSession, picture: ImageBlock, aspect: number): void {
  const had = picture.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const fullWidth = picture.width / (1 - had.left - had.right);
  const fullHeight = picture.height / (1 - had.top - had.bottom);
  if (aspect < fullWidth / fullHeight) {
    const side = (1 - (aspect * fullHeight) / fullWidth) / 2;
    session.cropImage(picture.id, { top: 0, bottom: 0, left: side, right: side }, { rescale: true });
  } else {
    const side = (1 - fullWidth / aspect / fullHeight) / 2;
    session.cropImage(picture.id, { left: 0, right: 0, top: side, bottom: side }, { rescale: true });
  }
}

/**
 * What can be done to the selected picture: crop it (by dragging its edges, or to a shape), and make text wrap around it.
 * `after` runs after each choice, to give the keyboard back to the page.
 */
export function pictureMenuItems(session: DocumentSession, picture: ImageBlock | null, after: () => void): MenuEntry[] {
  if (!picture) return [];
  const shape = (label: string, aspect: number): MenuEntry => ({ label, onSelect: () => { cropToShape(session, picture, aspect); after(); } });
  return [
    { label: "Crop", checked: session.croppingImage === picture.id, onSelect: () => { session.setCropping(session.croppingImage !== picture.id); after(); } },
    { label: "Crop to a shape", items: [shape("Square", 1), shape("4 : 3", 4 / 3), shape("16 : 9", 16 / 9), shape("3 : 4", 3 / 4)] },
    { label: "Show all of the picture", disabled: !picture.crop, onSelect: () => { session.cropImage(picture.id, null, { rescale: true }); after(); } },
    "separator",
    { label: "In line with text", checked: !picture.wrap, onSelect: () => { session.setImageWrap(null); after(); } },
    { label: "Wrap text, picture on the left", checked: picture.wrap === "left", onSelect: () => { session.setImageWrap("left"); after(); } },
    { label: "Wrap text, picture on the right", checked: picture.wrap === "right", onSelect: () => { session.setImageWrap("right"); after(); } },
  ];
}
