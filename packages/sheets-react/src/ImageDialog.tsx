import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { ARTISTIC, ARTISTIC_KINDS, DEFAULT_GLOW, IMAGE_SHAPES, IMAGE_SHAPE_NAMES, SHAPE_GROUPS, type ImageShape, DEFAULT_REFLECTION, MAX_ALT_LENGTH, type ArtisticKind, type ImageArtistic, type ImageBorder, type ImageCrop, type ImageGlow, type ImagePlacement, type ImageReflection, type ImageShadow, type SheetImage } from "@pli.dev/sheets";

/** What the dialog hands back: everything about how the picture looks and follows its cells. */
export interface ImageLook {
  alt: string;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  crop: ImageCrop | null;
  placement: ImagePlacement;
  border: ImageBorder | null;
  shadow: ImageShadow | null;
  /** From -1 to 1. */
  brightness: number;
  contrast: number;
  grayscale: boolean;
  glow: ImageGlow | null;
  /** Pixels; 0 for none. */
  softEdge: number;
  reflection: ImageReflection | null;
  artistic: ImageArtistic | null;
  /** The shape the picture is cropped to; null for a rectangle. */
  shape: ImageShape | null;
  /** The Crop on the sheet button was pressed: put the picture in crop mode once these are saved. */
  thenCrop?: boolean;
}

export interface ImageDialogProps {
  open: boolean;
  /** The picture being formatted. */
  image: SheetImage | undefined;
  onClose(): void;
  /** Returns why the settings were refused, if they were. */
  onSave(look: ImageLook): string | void;
}

const PLACEMENTS: { value: ImagePlacement; label: string }[] = [
  { value: "size", label: "Move and size with cells" },
  { value: "move", label: "Move but don't size with cells" },
  { value: "free", label: "Don't move or size with cells" },
];
const SIDES = ["left", "top", "right", "bottom"] as const;

/** A picture's description, turn, flips, crop (as percentages of the picture) and how it follows its cells. */
export function ImageDialog({ open, image, onClose, onSave }: ImageDialogProps) {
  const [alt, setAlt] = useState("");
  const [rotation, setRotation] = useState("0");
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<Record<(typeof SIDES)[number], string>>({ left: "0", top: "0", right: "0", bottom: "0" });
  const [placement, setPlacement] = useState<ImagePlacement>("move");
  const [lined, setLined] = useState(false);
  const [lineColor, setLineColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState("1");
  const [lineDash, setLineDash] = useState<"solid" | "dash" | "dot">("solid");
  const [shaded, setShaded] = useState(false);
  const [shadowBlur, setShadowBlur] = useState("6");
  const [shadowDistance, setShadowDistance] = useState("4");
  const [shadowAngle, setShadowAngle] = useState("45");
  const [brightness, setBrightness] = useState("0");
  const [contrast, setContrast] = useState("0");
  const [grayscale, setGrayscale] = useState(false);
  const [glowing, setGlowing] = useState(false);
  const [glowColor, setGlowColor] = useState<string>(DEFAULT_GLOW.color);
  const [glowRadius, setGlowRadius] = useState(String(DEFAULT_GLOW.radius));
  const [glowTransparency, setGlowTransparency] = useState(String(Math.round((1 - DEFAULT_GLOW.opacity) * 100)));
  const [softEdge, setSoftEdge] = useState("0");
  const [mirrored, setMirrored] = useState(false);
  const [mirrorStart, setMirrorStart] = useState(String(Math.round((1 - DEFAULT_REFLECTION.startOpacity) * 100)));
  const [mirrorSize, setMirrorSize] = useState(String(Math.round(DEFAULT_REFLECTION.size * 100)));
  const [mirrorDistance, setMirrorDistance] = useState(String(DEFAULT_REFLECTION.distance));
  const [mirrorBlur, setMirrorBlur] = useState(String(DEFAULT_REFLECTION.blur));
  const [artKind, setArtKind] = useState<ArtisticKind | "">("");
  const [artLevel, setArtLevel] = useState("");
  const [shape, setShape] = useState<ImageShape | "">("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !image) return;
    setAlt(image.alt ?? "");
    setRotation(String(image.rotation ?? 0));
    setFlipH(!!image.flipH);
    setFlipV(!!image.flipV);
    setCrop({ left: pct(image.crop?.left), top: pct(image.crop?.top), right: pct(image.crop?.right), bottom: pct(image.crop?.bottom) });
    setPlacement(image.placement ?? "move");
    setLined(!!image.border);
    setLineColor(image.border?.color ?? "#000000");
    setLineWidth(String(image.border?.width ?? 1));
    setLineDash(image.border?.dash ?? "solid");
    setShaded(!!image.shadow);
    setShadowBlur(String(image.shadow?.blur ?? 6));
    setShadowDistance(String(image.shadow?.distance ?? 4));
    setShadowAngle(String(image.shadow?.angle ?? 45));
    setBrightness(String(Math.round((image.brightness ?? 0) * 100)));
    setContrast(String(Math.round((image.contrast ?? 0) * 100)));
    setGrayscale(!!image.grayscale);
    setGlowing(!!image.glow);
    setGlowColor(image.glow?.color ?? DEFAULT_GLOW.color);
    setGlowRadius(String(image.glow?.radius ?? DEFAULT_GLOW.radius));
    setGlowTransparency(String(Math.round((1 - (image.glow?.opacity ?? DEFAULT_GLOW.opacity)) * 100)));
    setSoftEdge(String(image.softEdge ?? 0));
    setMirrored(!!image.reflection);
    setMirrorStart(String(Math.round((1 - (image.reflection?.startOpacity ?? DEFAULT_REFLECTION.startOpacity)) * 100)));
    setMirrorSize(String(Math.round((image.reflection?.size ?? DEFAULT_REFLECTION.size) * 100)));
    setMirrorDistance(String(image.reflection?.distance ?? DEFAULT_REFLECTION.distance));
    setMirrorBlur(String(image.reflection?.blur ?? DEFAULT_REFLECTION.blur));
    setArtKind(image.artistic?.kind ?? "");
    setArtLevel(String(image.artistic ? image.artistic.level ?? ARTISTIC[image.artistic.kind].usual : ""));
    setShape(image.shape ?? "");
    setProblem(null);
  }, [open, image]);

  const submit = (thenCrop = false) => {
    const turn = Number(rotation);
    const cut: ImageCrop = {};
    for (const side of SIDES) {
      const n = Number(crop[side]);
      if (crop[side].trim() === "" || Number.isNaN(n)) return setProblem("Each crop is a percentage.");
      if (n > 0) cut[side] = n / 100;
    }
    if (rotation.trim() === "" || Number.isNaN(turn)) return setProblem("The rotation is a number of degrees.");
    const nums = [lineWidth, shadowBlur, shadowDistance, shadowAngle, brightness, contrast].map(Number);
    if ([lineWidth, shadowBlur, shadowDistance, shadowAngle, brightness, contrast].some((t) => t.trim() === "") || nums.some(Number.isNaN)) return setProblem("The border, shadow and corrections are numbers.");
    const [lw, sb, sd, sa, br, co] = nums as [number, number, number, number, number, number];
    const fx = [glowRadius, glowTransparency, softEdge, mirrorStart, mirrorSize, mirrorDistance, mirrorBlur].map(Number);
    if ([glowRadius, glowTransparency, softEdge, mirrorStart, mirrorSize, mirrorDistance, mirrorBlur].some((t) => t.trim() === "") || fx.some(Number.isNaN)) return setProblem("The glow, soft edges and reflection are numbers.");
    const [gr, gt, se, ms, mz, md, mb] = fx as [number, number, number, number, number, number, number];
    const level = Number(artLevel);
    if (artKind && (artLevel.trim() === "" || Number.isNaN(level))) return setProblem("The artistic effect's level is a number.");
    const refused = onSave({
      alt: alt.trim(),
      rotation: turn,
      flipH,
      flipV,
      crop: Object.keys(cut).length ? cut : null,
      placement,
      border: lined ? { color: lineColor, width: lw, dash: lineDash } : null,
      shadow: shaded ? { ...(image?.shadow?.color ? { color: image.shadow.color } : {}), ...(image?.shadow?.opacity !== undefined ? { opacity: image.shadow.opacity } : {}), blur: sb, distance: sd, angle: sa } : null,
      brightness: br / 100,
      contrast: co / 100,
      grayscale,
      glow: glowing ? { color: glowColor, radius: gr, opacity: 1 - gt / 100 } : null,
      softEdge: se,
      reflection: mirrored ? { startOpacity: 1 - ms / 100, size: mz / 100, distance: md, blur: mb } : null,
      artistic: artKind ? { kind: artKind, level } : null,
      shape: shape || null,
      thenCrop,
    });
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={open}
      title="Format picture"
      onClose={onClose}
      onSubmit={() => submit()}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Save</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-picform">
        <label>
          Description
          <textarea className="pli-note-text" rows={3} autoFocus maxLength={MAX_ALT_LENGTH} value={alt} placeholder="What the picture shows" onChange={(e) => setAlt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label>
          Rotation (degrees clockwise)
          <input type="number" step="any" value={rotation} onChange={(e) => setRotation(e.target.value)} />
        </label>
        <div className="pli-ruleform-check-row">
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} /> Flip horizontally
          </label>
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} /> Flip vertically
          </label>
        </div>
        <fieldset>
          <legend>Crop (percent of the picture cut off)</legend>
          <div className="pli-ruleform-grid">
            {SIDES.map((side) => (
              <label key={side}>
                {side[0]!.toUpperCase() + side.slice(1)}
                <input type="number" min={0} max={99} step="any" value={crop[side]} onChange={(e) => setCrop((c) => ({ ...c, [side]: e.target.value }))} />
              </label>
            ))}
          </div>
          <button type="button" className="pli-button" onClick={() => submit(true)}>Crop on the sheet</button>
        </fieldset>
        <fieldset>
          <legend>Crop to shape</legend>
          <label>
            Shape
            <select value={shape} onChange={(e) => setShape(e.target.value as ImageShape | "")}>
              <option value="">Rectangle</option>
              {SHAPE_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {IMAGE_SHAPE_NAMES.filter((k) => IMAGE_SHAPES[k].group === group).map((k) => (
                    <option key={k} value={k}>{IMAGE_SHAPES[k].label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Border</legend>
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={lined} onChange={(e) => setLined(e.target.checked)} /> Line round the picture
          </label>
          <div className="pli-ruleform-grid">
            <label>
              Colour
              <input type="color" disabled={!lined} value={lineColor} onChange={(e) => setLineColor(e.target.value)} />
            </label>
            <label>
              Width (points)
              <input type="number" step="any" disabled={!lined} value={lineWidth} onChange={(e) => setLineWidth(e.target.value)} />
            </label>
            <label>
              Style
              <select disabled={!lined} value={lineDash} onChange={(e) => setLineDash(e.target.value as "solid" | "dash" | "dot")}>
                <option value="solid">Solid</option>
                <option value="dash">Dashed</option>
                <option value="dot">Dotted</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Shadow</legend>
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={shaded} onChange={(e) => setShaded(e.target.checked)} /> Shadow behind the picture
          </label>
          <div className="pli-ruleform-grid">
            <label>
              Blur (pixels)
              <input type="number" step="any" disabled={!shaded} value={shadowBlur} onChange={(e) => setShadowBlur(e.target.value)} />
            </label>
            <label>
              Distance (pixels)
              <input type="number" step="any" disabled={!shaded} value={shadowDistance} onChange={(e) => setShadowDistance(e.target.value)} />
            </label>
            <label>
              Angle (degrees)
              <input type="number" step="any" disabled={!shaded} value={shadowAngle} onChange={(e) => setShadowAngle(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Corrections</legend>
          <div className="pli-ruleform-grid">
            <label>
              Brightness (-100 to 100)
              <input type="number" step="any" value={brightness} onChange={(e) => setBrightness(e.target.value)} />
            </label>
            <label>
              Contrast (-100 to 100)
              <input type="number" step="any" value={contrast} onChange={(e) => setContrast(e.target.value)} />
            </label>
          </div>
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} /> Shades of grey
          </label>
        </fieldset>
        <fieldset>
          <legend>Glow</legend>
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={glowing} onChange={(e) => setGlowing(e.target.checked)} /> Glow round the picture
          </label>
          <div className="pli-ruleform-grid">
            <label>
              Glow colour
              <input type="color" disabled={!glowing} value={glowColor} onChange={(e) => setGlowColor(e.target.value)} />
            </label>
            <label>
              Glow size (pixels)
              <input type="number" step="any" disabled={!glowing} value={glowRadius} onChange={(e) => setGlowRadius(e.target.value)} />
            </label>
            <label>
              Glow transparency (percent)
              <input type="number" step="any" disabled={!glowing} value={glowTransparency} onChange={(e) => setGlowTransparency(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Soft edges</legend>
          <label>
            Soft edge size (pixels, 0 for none)
            <input type="number" step="any" min={0} value={softEdge} onChange={(e) => setSoftEdge(e.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Reflection</legend>
          <label className="pli-ruleform-check">
            <input type="checkbox" checked={mirrored} onChange={(e) => setMirrored(e.target.checked)} /> Reflection under the picture
          </label>
          <div className="pli-ruleform-grid">
            <label>
              Reflection transparency (percent)
              <input type="number" step="any" disabled={!mirrored} value={mirrorStart} onChange={(e) => setMirrorStart(e.target.value)} />
            </label>
            <label>
              Reflection size (percent)
              <input type="number" step="any" disabled={!mirrored} value={mirrorSize} onChange={(e) => setMirrorSize(e.target.value)} />
            </label>
            <label>
              Reflection distance (pixels)
              <input type="number" step="any" disabled={!mirrored} value={mirrorDistance} onChange={(e) => setMirrorDistance(e.target.value)} />
            </label>
            <label>
              Reflection blur (pixels)
              <input type="number" step="any" disabled={!mirrored} value={mirrorBlur} onChange={(e) => setMirrorBlur(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Artistic effect</legend>
          <div className="pli-ruleform-grid">
            <label>
              Effect
              <select
                value={artKind}
                onChange={(e) => {
                  const kind = e.target.value as ArtisticKind | "";
                  setArtKind(kind);
                  setArtLevel(kind ? String(ARTISTIC[kind].usual) : "");
                }}
              >
                <option value="">None</option>
                {ARTISTIC_KINDS.map((k) => (
                  <option key={k} value={k}>{ARTISTIC[k].label}</option>
                ))}
              </select>
            </label>
            <label>
              Effect level{artKind ? ` (${ARTISTIC[artKind].min} to ${ARTISTIC[artKind].max})` : ""}
              <span className="pli-slider-row">
                <input type="number" step={1} disabled={!artKind} min={artKind ? ARTISTIC[artKind].min : undefined} max={artKind ? ARTISTIC[artKind].max : undefined} value={artLevel} onChange={(e) => setArtLevel(e.target.value)} />
                <input type="range" aria-label="Effect level slider" step={1} disabled={!artKind} min={artKind ? ARTISTIC[artKind].min : 0} max={artKind ? ARTISTIC[artKind].max : 100} value={artKind && artLevel.trim() !== "" && !Number.isNaN(Number(artLevel)) ? Number(artLevel) : artKind ? ARTISTIC[artKind].usual : 0} onChange={(e) => setArtLevel(e.target.value)} />
              </span>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>When cells change</legend>
          {PLACEMENTS.map((p) => (
            <label key={p.value} className="pli-ruleform-check">
              <input type="radio" name="image-placement" checked={placement === p.value} onChange={() => setPlacement(p.value)} /> {p.label}
            </label>
          ))}
        </fieldset>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}

/** A crop fraction as the percentage the dialog shows. */
const pct = (v: number | undefined): string => String(Math.round((v ?? 0) * 10000) / 100);
