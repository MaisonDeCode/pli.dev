import type { CSSProperties } from "react";
import { DEFAULT_GLOW, DEFAULT_REFLECTION, shapePath, type SheetImage } from "@pli.dev/sheets";
import { useArtisticSrc } from "./artisticView";

const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`;

/** The soft edge of a picture `w` by `h` as a CSS mask: the edges fade out over `edge` pixels (never more than half the picture). */
export function softEdgeMask(edge: number, w: number, h: number): CSSProperties {
  const ex = Math.min(edge, w / 2);
  const ey = Math.min(edge, h / 2);
  const fade = (dir: string, e: number) => `linear-gradient(${dir}, transparent 0, #000 ${e}px, #000 calc(100% - ${e}px), transparent 100%)`;
  return { maskImage: `${fade("to right", ex)}, ${fade("to bottom", ey)}`, maskComposite: "intersect", WebkitMaskImage: `${fade("to right", ex)}, ${fade("to bottom", ey)}`, WebkitMaskComposite: "source-in" } as CSSProperties;
}

/** The glow round a picture, as the CSS filter that draws it from the picture's own shape (so a picture with see-through parts glows round what is there). */
export function glowFilter(glow: NonNullable<SheetImage["glow"]>): string {
  const color = rgba(glow.color ?? DEFAULT_GLOW.color, glow.opacity ?? DEFAULT_GLOW.opacity);
  const r = glow.radius ?? DEFAULT_GLOW.radius;
  return `drop-shadow(0 0 ${r / 2}px ${color}) drop-shadow(0 0 ${r}px ${color})`;
}

/** Where a reflection is under a picture `h` pixels high, and the fade it has. */
export function reflectionMask(reflection: NonNullable<SheetImage["reflection"]>): string {
  const start = reflection.startOpacity ?? DEFAULT_REFLECTION.startOpacity;
  const end = reflection.endOpacity ?? DEFAULT_REFLECTION.endOpacity;
  const size = reflection.size ?? DEFAULT_REFLECTION.size;
  return `linear-gradient(to bottom, rgba(0, 0, 0, ${start}) 0%, rgba(0, 0, 0, ${end}) ${size * 100}%, rgba(0, 0, 0, ${end}) 100%)`;
}

/** Where a shadow falls and how it looks, as the offsets and colour a picture turned by `rotation` needs (a shadow falls the same way on the page however the picture is turned). */
function shadowParts(shadow: NonNullable<SheetImage["shadow"]>, rotation: number | undefined) {
  const a = ((shadow.angle ?? 45) * Math.PI) / 180;
  const r = ((rotation ?? 0) * Math.PI) / 180;
  const d = shadow.distance ?? 4;
  const sx = d * Math.cos(a);
  const sy = d * Math.sin(a);
  const hex = shadow.color ?? "#000000";
  return {
    x: (sx * Math.cos(r) + sy * Math.sin(r)).toFixed(2),
    y: (-sx * Math.sin(r) + sy * Math.cos(r)).toFixed(2),
    blur: shadow.blur ?? 6,
    color: `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${shadow.opacity ?? 0.4})`,
  };
}

/** The style a picture's box takes from how it is turned and shadowed, to add to its position and size. A picture cropped to a shape has its shadow drawn by `PictureBody` instead (it follows the shape; a box shadow would follow the rectangle). */
export function pictureBoxStyle(image: SheetImage): CSSProperties {
  const style: CSSProperties = {};
  if (image.rotation) style.transform = `rotate(${image.rotation}deg)`;
  if (image.shadow && !image.shape) {
    const p = shadowParts(image.shadow, image.rotation);
    style.boxShadow = `${p.x}px ${p.y}px ${p.blur}px ${p.color}`;
  }
  return style;
}

/** The CSS filter that draws a shadow round a picture's own shape (a box shadow is a rectangle, and a shape isn't). */
export function shadowFilter(shadow: NonNullable<SheetImage["shadow"]>, rotation: number | undefined): string {
  const p = shadowParts(shadow, rotation);
  return `drop-shadow(${p.x}px ${p.y}px ${p.blur / 2}px ${p.color})`;
}

/**
 * What is inside a picture's box, `w` by `h` pixels: the picture cropped, mirrored, corrected and given its effects (an
 * artistic effect, soft edges, a glow, a reflection below it), and its border. The box itself (its place, turn and shadow) is
 * the caller's, with `pictureBoxStyle`. With `cropping`, the whole picture is shown dimmed behind the part that is kept.
 */
export function PictureBody({ image, w, h, cropping = false }: { image: SheetImage; w: number; h: number; cropping?: boolean }) {
  const src = useArtisticSrc(image.src, image.artistic);
  // What is cropped away lies outside the frame: the picture is drawn larger than the frame and shifted.
  const cl = image.crop?.left ?? 0;
  const ct = image.crop?.top ?? 0;
  const showW = 1 - cl - (image.crop?.right ?? 0);
  const showH = 1 - ct - (image.crop?.bottom ?? 0);
  const flip = image.flipH || image.flipV ? `scale(${image.flipH ? -1 : 1}, ${image.flipV ? -1 : 1})` : undefined;
  const filter = correctionFilter(image);
  const style: CSSProperties | undefined =
    image.crop || filter ? { ...(image.crop ? { position: "absolute", width: w / showW, height: h / showH, left: -cl * (w / showW), top: -ct * (h / showH), maxWidth: "none" } : {}), ...(filter ? { filter } : {}) } : undefined;
  const line = image.border ? ((image.border.width ?? 1) * 4) / 3 : 0;
  const outline = image.shape ? shapePath(image.shape, w, h, image.shapeAdjust) : undefined;
  const clip: CSSProperties = outline ? { clipPath: `path('${outline}')`, WebkitClipPath: `path('${outline}')` } : {};
  const frame = (alt: string) => (
    <div className="pli-grid-imageframe" data-shape={image.shape} style={{ ...(flip ? { transform: flip } : {}), ...(image.softEdge ? softEdgeMask(image.softEdge, w, h) : {}), ...clip }}>
      <img src={src} alt={alt} draggable={false} style={style} />
    </div>
  );
  const mirror = image.reflection;
  const fxFilter = [image.glow ? glowFilter(image.glow) : "", image.shape && image.shadow ? shadowFilter(image.shadow, image.rotation) : ""].filter(Boolean).join(" ");
  return (
    <>
      {cropping && (
        <div className="pli-grid-cropfull" style={{ left: -cl * (w / showW), top: -ct * (h / showH), width: w / showW, height: h / showH, ...(flip ? { transform: flip } : {}) }}>
          <img src={src} alt="" draggable={false} />
        </div>
      )}
      <div className="pli-grid-imagefx" style={fxFilter ? { filter: fxFilter } : undefined} data-glow={image.glow ? "" : undefined}>
        {frame(image.alt ?? "")}
      </div>
      {image.border && !outline && <div className="pli-grid-imageborder" style={{ inset: -line / 2, borderWidth: line, borderColor: image.border.color, borderStyle: image.border.dash === "dot" ? "dotted" : image.border.dash === "dash" ? "dashed" : "solid" }} />}
      {image.border && outline && (
        <svg className="pli-grid-imageborder" width={w} height={h} style={{ left: 0, top: 0, overflow: "visible", ...(flip ? { transform: flip } : {}) }} aria-hidden="true">
          <path d={outline} fill="none" stroke={image.border.color} strokeWidth={line} strokeDasharray={image.border.dash === "dot" ? `${line} ${line}` : image.border.dash === "dash" ? `${line * 4} ${line * 2}` : undefined} />
        </svg>
      )}
      {mirror && (
        <div className="pli-grid-imagereflect" style={{ left: 0, top: h + (mirror.distance ?? DEFAULT_REFLECTION.distance), width: w, height: h, maskImage: reflectionMask(mirror), WebkitMaskImage: reflectionMask(mirror), ...((mirror.blur ?? DEFAULT_REFLECTION.blur) > 0 ? { filter: `blur(${mirror.blur ?? DEFAULT_REFLECTION.blur}px)` } : {}) } as CSSProperties}>
          <div style={{ width: "100%", height: "100%", transform: "scaleY(-1)" }}>{frame("")}</div>
        </div>
      )}
    </>
  );
}

/** Brighter or darker, more or less contrast, grey: the CSS filter that does a picture's corrections. */
export function correctionFilter(image: SheetImage): string {
  return [image.brightness ? `brightness(${1 + image.brightness})` : "", image.contrast ? `contrast(${1 + image.contrast})` : "", image.grayscale ? "grayscale(1)" : ""].filter(Boolean).join(" ");
}

/**
 * A picture as it looks on the sheet (cropped, mirrored, turned, corrected and with its border) drawn into a PNG, as a
 * `data:` URI, for putting on the clipboard where other programs can use it. `img` is the picture already loaded, `w` by `h`
 * pixels on the sheet. Gives null when the browser can't draw it, and the caller sends the picture as it is.
 */
export function pictureAsPng(image: SheetImage, img: HTMLImageElement, w: number, h: number): string | null {
  try {
    if (!img.complete || !img.naturalWidth) return null;
    const scale = 2;
    const rad = ((image.rotation ?? 0) * Math.PI) / 180;
    const line = image.border ? ((image.border.width ?? 1) * 4) / 3 : 0;
    const glowReach = image.glow ? (image.glow.radius ?? DEFAULT_GLOW.radius) * 1.5 : 0;
    const mirror = image.reflection;
    const mirrorGap = mirror?.distance ?? DEFAULT_REFLECTION.distance;
    // The part of the picture the reflection shows, from the picture's bottom edge: all of it, or as far as it fades away.
    const mirrorHigh = mirror ? ((mirror.endOpacity ?? DEFAULT_REFLECTION.endOpacity) > 0.01 ? h : h * (mirror.size ?? DEFAULT_REFLECTION.size)) : 0;
    const pad = Math.ceil(glowReach + line / 2 + (mirror ? mirror.blur ?? DEFAULT_REFLECTION.blur : 0));
    // The drawing, in the picture's own (unturned) frame centred on the picture: how far it reaches each way.
    const x0 = -w / 2 - pad;
    const x1 = w / 2 + pad;
    const y0 = -h / 2 - pad;
    const y1 = h / 2 + pad + (mirror ? mirrorGap + mirrorHigh : 0);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const fw = x1 - x0;
    const fh = y1 - y0;
    const outW = Math.ceil(Math.abs(fw * Math.cos(rad)) + Math.abs(fh * Math.sin(rad)));
    const outH = Math.ceil(Math.abs(fw * Math.sin(rad)) + Math.abs(fh * Math.cos(rad)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, outW * scale);
    canvas.height = Math.max(1, outH * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    // The frame's centre, turned about the picture's own centre, goes to the middle of the canvas.
    ctx.translate(outW / 2 - (cx * Math.cos(rad) - cy * Math.sin(rad)), outH / 2 - (cx * Math.sin(rad) + cy * Math.cos(rad)));
    ctx.rotate(rad);

    // The picture alone, cropped, mirrored, corrected and with soft edges, on a canvas of its own so it can be drawn again for the glow and the reflection.
    const layer = document.createElement("canvas");
    layer.width = Math.max(1, Math.round(w * scale));
    layer.height = Math.max(1, Math.round(h * scale));
    const lc = layer.getContext("2d");
    if (!lc) return null;
    lc.scale(scale, scale);
    lc.save();
    lc.translate(w / 2, h / 2);
    lc.scale(image.flipH ? -1 : 1, image.flipV ? -1 : 1);
    const filter = correctionFilter(image);
    if (filter && "filter" in lc) lc.filter = filter;
    const cl = image.crop?.left ?? 0;
    const ct = image.crop?.top ?? 0;
    const sw = img.naturalWidth * (1 - cl - (image.crop?.right ?? 0));
    const sh = img.naturalHeight * (1 - ct - (image.crop?.bottom ?? 0));
    lc.drawImage(img, img.naturalWidth * cl, img.naturalHeight * ct, sw, sh, -w / 2, -h / 2, w, h);
    lc.restore();
    // Cropped to a shape: only what is inside the shape stays (the shape is mirrored with the picture).
    const outline = image.shape && typeof Path2D !== "undefined" ? new Path2D(shapePath(image.shape, w, h, image.shapeAdjust)) : null;
    const place = (c: CanvasRenderingContext2D) => {
      c.translate(w / 2, h / 2);
      c.scale(image.flipH ? -1 : 1, image.flipV ? -1 : 1);
      c.translate(-w / 2, -h / 2);
    };
    if (outline) {
      lc.save();
      lc.globalCompositeOperation = "destination-in";
      place(lc);
      lc.fill(outline);
      lc.restore();
    }
    if (image.softEdge) {
      // The edges fade out: keep only what the two gradients (across and down) both let through.
      const ex = Math.min(image.softEdge, w / 2) / w;
      const ey = Math.min(image.softEdge, h / 2) / h;
      lc.globalCompositeOperation = "destination-in";
      const across = lc.createLinearGradient(0, 0, w, 0);
      across.addColorStop(0, "rgba(0,0,0,0)");
      across.addColorStop(ex, "#000");
      across.addColorStop(1 - ex, "#000");
      across.addColorStop(1, "rgba(0,0,0,0)");
      lc.fillStyle = across;
      lc.fillRect(0, 0, w, h);
      const down = lc.createLinearGradient(0, 0, 0, h);
      down.addColorStop(0, "rgba(0,0,0,0)");
      down.addColorStop(ey, "#000");
      down.addColorStop(1 - ey, "#000");
      down.addColorStop(1, "rgba(0,0,0,0)");
      lc.fillStyle = down;
      lc.fillRect(0, 0, w, h);
      lc.globalCompositeOperation = "source-over";
    }

    if (mirror) {
      const m = document.createElement("canvas");
      m.width = layer.width;
      m.height = layer.height;
      const mc = m.getContext("2d");
      if (mc) {
        mc.translate(0, m.height);
        mc.scale(1, -1);
        mc.drawImage(layer, 0, 0);
        mc.setTransform(1, 0, 0, 1, 0, 0);
        mc.globalCompositeOperation = "destination-in";
        const fade = mc.createLinearGradient(0, 0, 0, m.height);
        const size = mirror.size ?? DEFAULT_REFLECTION.size;
        fade.addColorStop(0, `rgba(0,0,0,${mirror.startOpacity ?? DEFAULT_REFLECTION.startOpacity})`);
        fade.addColorStop(size, `rgba(0,0,0,${mirror.endOpacity ?? DEFAULT_REFLECTION.endOpacity})`);
        fade.addColorStop(1, `rgba(0,0,0,${mirror.endOpacity ?? DEFAULT_REFLECTION.endOpacity})`);
        mc.fillStyle = fade;
        mc.fillRect(0, 0, m.width, m.height);
        if ((mirror.blur ?? DEFAULT_REFLECTION.blur) > 0 && "filter" in ctx) ctx.filter = `blur(${mirror.blur ?? DEFAULT_REFLECTION.blur}px)`;
        ctx.drawImage(m, -w / 2, h / 2 + mirrorGap, w, h);
        if ("filter" in ctx) ctx.filter = "none";
      }
    }
    if (image.glow) {
      // The canvas's shadow, with no offset, is a glow round whatever was drawn; twice makes it as solid as the sheet's.
      ctx.shadowColor = rgba(image.glow.color ?? DEFAULT_GLOW.color, image.glow.opacity ?? DEFAULT_GLOW.opacity);
      ctx.shadowBlur = (image.glow.radius ?? DEFAULT_GLOW.radius) * scale;
      ctx.drawImage(layer, -w / 2, -h / 2, w, h);
      ctx.drawImage(layer, -w / 2, -h / 2, w, h);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
    ctx.drawImage(layer, -w / 2, -h / 2, w, h);
    if (image.border) {
      ctx.strokeStyle = image.border.color;
      ctx.lineWidth = line;
      ctx.setLineDash(image.border.dash === "dot" ? [line, line] : image.border.dash === "dash" ? [line * 4, line * 2] : []);
      if (outline) {
        ctx.save();
        ctx.translate(-w / 2, -h / 2);
        place(ctx);
        ctx.stroke(outline);
        ctx.restore();
      } else ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
