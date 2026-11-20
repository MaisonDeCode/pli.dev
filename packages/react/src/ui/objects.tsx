import { useEffect, useState } from "react";
import { PX_PER_INCH, type BoxStyle, type FloatPlacement, type FloatingBlock } from "@pli.dev/docs";
import { Dialog } from "./primitives";

/** What the dialog changes: the parts of a floating picture or text box that can be set. */
export type ObjectPatch = Partial<FloatPlacement & BoxStyle>;

export interface ObjectDialogProps {
  open: boolean;
  /** The picture or text box being changed. */
  block: FloatingBlock | null;
  onApply: (patch: ObjectPatch) => void;
  /** Puts the picture or box back in the text. */
  onInline: () => void;
  onClose: () => void;
}

interface Draft {
  xFrom: string;
  xAlign: string;
  xOffset: string;
  yFrom: string;
  yAlign: string;
  yOffset: string;
  width: string;
  height: string;
  behind: boolean;
  shape: string;
  filled: boolean;
  fill: string;
  opacity: string;
  outlined: boolean;
  line: string;
  lineWidth: string;
  lineStyle: string;
}

/** A checkbox beside its words, which the narrow field rows would squeeze. */
const CHECK = { display: "flex", alignItems: "center", gap: 8, width: "auto" } as const;

const inches = (px: number | undefined) => String(Math.round(((px ?? 0) / PX_PER_INCH) * 100) / 100);
const pixels = (text: string) => Math.round((Number.isFinite(Number(text)) ? Number(text) : 0) * PX_PER_INCH);

function draftOf(block: FloatingBlock): Draft {
  const { x, y, behind } = block.float;
  const box = block.type === "table" ? block.float : undefined;
  const size = block.type === "image" ? block : box!;
  return {
    xFrom: x.from,
    xAlign: x.align ?? "",
    xOffset: inches(x.offset),
    yFrom: y.from,
    yAlign: y.align ?? "",
    yOffset: inches(y.offset),
    width: inches(size.width),
    height: inches(size.height),
    behind: !!behind,
    shape: box?.shape ?? "rect",
    filled: !!box?.fill,
    fill: box?.fill ?? "#ffffff",
    opacity: String(Math.round((box?.fillOpacity ?? 1) * 100)),
    outlined: !!box?.line,
    line: box?.line?.color ?? "#000000",
    lineWidth: String(box?.line?.width ?? 1),
    lineStyle: box?.line?.style ?? "solid",
  };
}

/**
 * Where a picture or text box that floats sits on the page and how it looks: what its position is measured from and how far (or
 * lined up with an edge), its size, whether it is behind the text, and for a text box its shape, fill and outline.
 */
export function ObjectDialog({ open, block, onApply, onInline, onClose }: ObjectDialogProps) {
  const [draft, setDraft] = useState<Draft | null>(() => (block ? draftOf(block) : null));
  useEffect(() => {
    if (open && block) setDraft(draftOf(block));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the dialog opens, not as the document changes under it
  }, [open]);
  if (!block || !draft) return null;
  const isBox = block.type === "table";
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });

  const apply = () => {
    const position = (from: string, align: string, offset: string) => ({
      from,
      ...(align ? { align } : {}),
      ...(pixels(offset) !== 0 ? { offset: pixels(offset) } : {}),
    });
    const patch: Record<string, unknown> = {
      x: position(draft.xFrom, draft.xAlign, draft.xOffset),
      y: position(draft.yFrom, draft.yAlign, draft.yOffset),
      behind: draft.behind || undefined,
      width: Math.max(1, pixels(draft.width)),
      height: Math.max(1, pixels(draft.height)),
    };
    if (isBox) {
      patch.shape = draft.shape === "rect" ? undefined : draft.shape;
      patch.fill = draft.filled ? draft.fill : undefined;
      const opacity = Math.min(100, Math.max(0, Number(draft.opacity) || 0)) / 100;
      patch.fillOpacity = draft.filled && opacity < 1 ? opacity : undefined;
      patch.line = draft.outlined
        ? { color: draft.line, width: Math.max(0, Number(draft.lineWidth) || 0), ...(draft.lineStyle !== "solid" ? { style: draft.lineStyle } : {}) }
        : undefined;
    }
    onApply(patch as ObjectPatch);
    onClose();
  };

  const across = (
    <fieldset className="pli-margins">
      <legend>Across the page</legend>
      <label className="pli-field-row pli-field-narrow">
        <span>From</span>
        <select value={draft.xFrom} onChange={(e) => set({ xFrom: e.target.value })}>
          <option value="page">Edge of the page</option>
          <option value="margin">Margin</option>
          <option value="column">Text column</option>
        </select>
      </label>
      <label className="pli-field-row pli-field-narrow">
        <span>Line up</span>
        <select value={draft.xAlign} onChange={(e) => set({ xAlign: e.target.value })}>
          <option value="">Distance from the left</option>
          <option value="left">With the left</option>
          <option value="center">In the middle</option>
          <option value="right">With the right</option>
        </select>
      </label>
      <label className="pli-field-row pli-field-narrow">
        <span>Distance (in)</span>
        <input type="number" step={0.05} value={draft.xOffset} onChange={(e) => set({ xOffset: e.target.value })} />
      </label>
    </fieldset>
  );
  const down = (
    <fieldset className="pli-margins">
      <legend>Down the page</legend>
      <label className="pli-field-row pli-field-narrow">
        <span>From</span>
        <select value={draft.yFrom} onChange={(e) => set({ yFrom: e.target.value })}>
          <option value="page">Top of the page</option>
          <option value="margin">Margin</option>
          <option value="paragraph">Its paragraph</option>
        </select>
      </label>
      <label className="pli-field-row pli-field-narrow">
        <span>Line up</span>
        <select value={draft.yAlign} onChange={(e) => set({ yAlign: e.target.value })}>
          <option value="">Distance from the top</option>
          <option value="top">With the top</option>
          <option value="center">In the middle</option>
          <option value="bottom">With the bottom</option>
        </select>
      </label>
      <label className="pli-field-row pli-field-narrow">
        <span>Distance (in)</span>
        <input type="number" step={0.05} value={draft.yOffset} onChange={(e) => set({ yOffset: e.target.value })} />
      </label>
    </fieldset>
  );

  return (
    <Dialog
      open={open}
      title={isBox ? "Text box" : "Picture on the page"}
      onClose={onClose}
      onSubmit={apply}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => { onInline(); onClose(); }}>
            {isBox ? "Make it an ordinary table" : "Put it in the text"}
          </button>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      {across}
      {down}
      <fieldset className="pli-margins">
        <legend>Size</legend>
        <label className="pli-field-row pli-field-narrow">
          <span>Width (in)</span>
          <input type="number" min={0.1} step={0.05} value={draft.width} onChange={(e) => set({ width: e.target.value })} />
        </label>
        <label className="pli-field-row pli-field-narrow">
          <span>Height (in)</span>
          <input type="number" min={0.1} step={0.05} value={draft.height} onChange={(e) => set({ height: e.target.value })} />
        </label>
        <label style={CHECK}>
          <input type="checkbox" checked={draft.behind} onChange={(e) => set({ behind: e.target.checked })} /> Behind the text
        </label>
      </fieldset>
      {isBox && (
        <fieldset className="pli-margins">
          <legend>Look</legend>
          <label className="pli-field-row pli-field-narrow">
            <span>Shape</span>
            <select value={draft.shape} onChange={(e) => set({ shape: e.target.value })}>
              <option value="rect">Rectangle</option>
              <option value="round_rect">Rounded rectangle</option>
              <option value="ellipse">Oval</option>
            </select>
          </label>
          <div className="pli-field-row pli-field-narrow">
            <label style={CHECK}><input type="checkbox" checked={draft.filled} onChange={(e) => set({ filled: e.target.checked })} /> Fill</label>
            <input type="color" value={draft.fill} disabled={!draft.filled} onChange={(e) => set({ fill: e.target.value })} aria-label="Fill colour" />
          </div>
          {draft.filled && (
            <label className="pli-field-row pli-field-narrow">
              <span>Solid (%)</span>
              <input type="number" min={0} max={100} value={draft.opacity} onChange={(e) => set({ opacity: e.target.value })} />
            </label>
          )}
          <div className="pli-field-row pli-field-narrow">
            <label style={CHECK}><input type="checkbox" checked={draft.outlined} onChange={(e) => set({ outlined: e.target.checked })} /> Outline</label>
            <input type="color" value={draft.line} disabled={!draft.outlined} onChange={(e) => set({ line: e.target.value })} aria-label="Outline colour" />
          </div>
          {draft.outlined && (
            <>
              <label className="pli-field-row pli-field-narrow">
                <span>Width (px)</span>
                <input type="number" min={0} step={1} value={draft.lineWidth} onChange={(e) => set({ lineWidth: e.target.value })} />
              </label>
              <label className="pli-field-row pli-field-narrow">
                <span>Style</span>
                <select value={draft.lineStyle} onChange={(e) => set({ lineStyle: e.target.value })}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                  <option value="double">Double</option>
                </select>
              </label>
            </>
          )}
        </fieldset>
      )}
    </Dialog>
  );
}
