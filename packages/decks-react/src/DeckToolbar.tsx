import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Bar, ColorPicker, Dropdown, FontPicker, MenuList, keepFocus, type MenuEntry } from "@pli.dev/react";
import type { DeckSession, Layout, PlaceholderType, ResolvedElement } from "@pli.dev/decks";
import { SlideView } from "./SlideView";
import { DeckIcons as I } from "./icons";
import { presetGroups, presetPath } from "./engine";
import type { Tool } from "./SlideCanvas";
import type { TextFormat } from "./textedit";
import type { CommandContext } from "./commands";
import * as cmd from "./commands";

export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type Zoom = number | "fit";

const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36, 48, 60, 72, 96, 120, 144, 200];
const WEIGHTS = [1, 2, 3, 4, 6, 8, 12, 16, 24];
const DASHES: { value: "solid" | "dot" | "dash" | "dashDot" | "longDash"; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dot", label: "Dots" },
  { value: "dash", label: "Dashes" },
  { value: "dashDot", label: "Dash dot" },
  { value: "longDash", label: "Long dashes" },
];
const SPACINGS = [1, 1.15, 1.5, 2];

/** What Insert placeholder offers in the master view. */
export const PLACEHOLDER_TYPES: [PlaceholderType, string][] = [
  ["title", "Title"],
  ["body", "Body text"],
  ["subTitle", "Subtitle"],
  ["pic", "Picture"],
  ["sldNum", "Slide number"],
  ["dt", "Date"],
  ["ftr", "Footer"],
];

export interface DeckToolbarProps {
  session: DeckSession;
  /** Hides the editing controls. */
  readOnly: boolean;
  ctx: CommandContext;
  selection: ResolvedElement[];
  /** What the text at the caret or in the selected shapes looks like. */
  format: TextFormat | null;
  editingText: boolean;
  zoom: Zoom;
  fitZoom: number;
  onZoom: (zoom: Zoom) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  onImage: () => void;
  onNewSlide: (layoutId?: string) => void;
  layouts: Layout[];
  currentLayout: string | null;
  onLayout: (id: string) => void;
  onBackground: () => void;
  onTheme: () => void;
  onTransition: () => void;
  /** Opens the Motion panel (object animations), or closes it. */
  onMotion?: () => void;
  motionOpen?: boolean;
  /** Opens the master view, or closes it when it is open. */
  onMaster: () => void;
  /** Adds a placeholder to the layout or master being edited (master view only). */
  onPlaceholder: (type: PlaceholderType) => void;
  canPlaceholder: (type: PlaceholderType) => boolean;
  onLink: () => void;
  onFormatOptions: () => void;
  onPresent: () => void;
  cropping: boolean;
  onCrop: (on: boolean) => void;
  /** The layout/master editor: slides-only controls are left out. */
  templateMode: boolean;
  tableMenu: MenuEntry[];
  className?: string;
}

/** The toolbar row of Google Slides: history, zoom, tools, background/layout/theme/transition, and formatting that follows the selection. */
export function DeckToolbar(p: DeckToolbarProps) {
  const { session, readOnly, ctx, selection, format, zoom, fitZoom } = p;
  const first = selection[0];
  const hasText = !!format && (p.editingText || selection.some((e) => e.kind === "shape" && !!e.text || e.kind === "table"));
  const isShape = selection.some((e) => e.kind === "shape");
  const isImage = selection.length > 0 && selection.every((e) => e.kind === "image");
  const isTable = selection.length === 1 && first?.kind === "table";
  const hasBorder = selection.length > 0 && selection.some((e) => e.kind === "shape" || e.kind === "image" || e.kind === "table");

  const button = (label: string, icon: ReactNode, onClick: () => void, extra: { pressed?: boolean; disabled?: boolean; shortcut?: string } = {}) => (
    <button
      type="button"
      className="pli-tool"
      aria-label={label}
      title={extra.shortcut ? `${label} (${extra.shortcut})` : label}
      aria-pressed={extra.pressed}
      disabled={extra.disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  const sep = <span className="pli-deck-sep" role="separator" aria-orientation="vertical" />;

  const [sizeText, setSizeText] = useState("");
  useEffect(() => setSizeText(format?.fontSize ? String(format.fontSize) : ""), [format?.fontSize]);
  const applySize = (n: number) => {
    if (Number.isFinite(n) && n >= 1 && n <= 400) cmd.formatMarks(ctx, { fontSize: Math.round(n * 2) / 2 });
  };
  const stepSize = (dir: 1 | -1) => {
    const size = format?.fontSize ?? 18;
    const next = dir > 0 ? FONT_SIZES.find((s) => s > size) : [...FONT_SIZES].reverse().find((s) => s < size);
    if (next) applySize(next);
  };

  const groups = useMemo(() => presetGroups(), []);
  const borderColor = first?.line?.color;
  const weight = first?.line?.width;
  const dash = first?.line?.dash;
  const fill = first?.fill.kind === "solid" ? first.fill.color : undefined;

  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const zoomLabel = zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;

  return (
    <Bar aria-label="Formatting" className={`pli-deck-toolbar${p.className ? ` ${p.className}` : ""}`}>
      {!readOnly && (
        <>
          <div className="pli-group" data-group="slides">
            <button type="button" className="pli-tool" aria-label="New slide" title={`New slide (${mod}M)`} onMouseDown={keepFocus} onClick={() => p.onNewSlide()}>{I.newSlide}</button>
            <Dropdown label="New slide with layout" className="pli-tool-wide pli-deck-narrow" panel={(close) => <LayoutGrid session={session} layouts={p.layouts} current={null} onPick={(id) => { close(); p.onNewSlide(id); }} />}>
              {I.chevron}
            </Dropdown>
          </div>
          <div className="pli-group" data-group="history">
            {button("Undo", I.undo, () => session.undo(), { disabled: !session.canUndo, shortcut: `${mod}Z` })}
            {button("Redo", I.redo, () => session.redo(), { disabled: !session.canRedo, shortcut: mod === "⌘" ? "⇧⌘Z" : "Ctrl+Y" })}
          </div>
        </>
      )}
      <div className="pli-group" data-group="zoom">
        <Dropdown label="Zoom" className="pli-tool-wide" panel={(close) => (
          <MenuList
            close={close}
            label="Zoom"
            items={[
              { label: "Fit", checked: zoom === "fit", onSelect: () => p.onZoom("fit") },
              ...ZOOMS.map((z) => ({ label: `${Math.round(z * 100)}%`, checked: zoom === z, onSelect: () => p.onZoom(z) })),
            ]}
          />
        )}>
          <span className="pli-deck-zoom-label">{zoomLabel}{zoom === "fit" ? ` ${Math.round(fitZoom * 100)}%` : ""} {I.chevron}</span>
        </Dropdown>
      </div>
      {readOnly && <div className="pli-group">{button("Present", I.present, p.onPresent)}</div>}
      {!readOnly && (
        <>
          <div className="pli-group" data-group="insert">
            {button("Select", I.select, () => p.onTool(null), { pressed: p.tool === null })}
            {button("Text box", I.textBox, () => p.onTool(p.tool?.type === "text" ? null : { type: "text" }), { pressed: p.tool?.type === "text" })}
            {button("Image", I.image, p.onImage)}
            <Dropdown label="Shape" className="pli-tool-wide" panel={(close) => (
              <div className="pli-deck-shapes" role="group" aria-label="Shapes">
                {groups.length === 0 && <p className="pli-deck-empty">No shapes available.</p>}
                {groups.map((g) => (
                  <div key={g.label} className="pli-deck-shape-group">
                    <div className="pli-deck-shape-heading">{g.label}</div>
                    <div className="pli-deck-shape-grid">
                      {g.presets.map((pr) => (
                        <button key={pr.name} type="button" className="pli-deck-shape-button" aria-label={pr.label ?? pr.name} title={pr.label ?? pr.name} onClick={() => { close(); p.onTool({ type: "shape", geometry: pr.name }); }}>
                          <svg viewBox="-2 -2 28 28" width="22" height="22" aria-hidden="true"><path d={presetPath(pr.name, 24, 24)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}>
              <span className="pli-deck-with-chevron">{I.shape} {I.chevron}</span>
            </Dropdown>
            <Dropdown label="Line" className="pli-tool-wide" panel={(close) => (
              <MenuList
                close={close}
                label="Line"
                items={[
                  { label: "Line", onSelect: () => p.onTool({ type: "line", geometry: "line" }) },
                  { label: "Arrow", onSelect: () => p.onTool({ type: "line", geometry: "line", arrow: true }) },
                  { label: "Elbow connector", onSelect: () => p.onTool({ type: "line", geometry: "bentConnector3" }) },
                  { label: "Curved connector", onSelect: () => p.onTool({ type: "line", geometry: "curvedConnector3" }) },
                ]}
              />
            )}>
              <span className="pli-deck-with-chevron">{I.line} {I.chevron}</span>
            </Dropdown>
          </div>
          <div className="pli-group" data-group="slide">
            <button type="button" className="pli-tool pli-deck-label-tool" aria-label="Background" title="Background" disabled={p.templateMode && false} onMouseDown={keepFocus} onClick={p.onBackground}>{I.background}<span>Background</span></button>
            <Dropdown label="Layout" className="pli-tool-wide" panel={(close) => <LayoutGrid session={session} layouts={p.layouts} current={p.currentLayout} onPick={(id) => { close(); p.onLayout(id); }} />}>
              <span className="pli-deck-with-chevron">{I.layout}<span>Layout</span> {I.chevron}</span>
            </Dropdown>
            <button type="button" className="pli-tool pli-deck-label-tool" aria-label="Theme" title="Theme" onMouseDown={keepFocus} onClick={p.onTheme}>{I.theme}<span>Theme</span></button>
            <button type="button" className="pli-tool pli-deck-label-tool" aria-label="Master" title={p.templateMode ? "Close master view" : "Edit master and layouts"} aria-pressed={p.templateMode} onMouseDown={keepFocus} onClick={p.onMaster}>{I.master}<span>Master</span></button>
            <button type="button" className="pli-tool pli-deck-label-tool" aria-label="Transition" title="Transition" disabled={p.templateMode} onMouseDown={keepFocus} onClick={p.onTransition}>{I.transition}<span>Transition</span></button>
            {p.onMotion && <button type="button" className="pli-tool pli-deck-label-tool" aria-label="Motion" title="Motion: animate objects" aria-pressed={p.motionOpen} disabled={p.templateMode} onMouseDown={keepFocus} onClick={p.onMotion}>{I.motion}<span>Motion</span></button>}
            {p.templateMode && (
              <Dropdown label="Insert placeholder" className="pli-tool-wide" panel={(close) => (
                <MenuList close={close} label="Insert placeholder" items={PLACEHOLDER_TYPES.map(([type, label]) => ({ label, disabled: !p.canPlaceholder(type), onSelect: () => p.onPlaceholder(type) }))} />
              )}>
                <span className="pli-deck-with-chevron">{I.plus}<span>Placeholder</span> {I.chevron}</span>
              </Dropdown>
            )}
          </div>
          {sep}
          {hasText && (
            <>
              <div className="pli-group" data-group="font">
                <FontPicker
                  value={format?.fontFamily}
                  mixed={!format?.fontFamily}
                  onChange={(family) => family && cmd.formatMarks(ctx, { fontFamily: family })}
                />
                <div className="pli-size" role="group" aria-label="Font size">
                  <button type="button" className="pli-tool" aria-label="Decrease font size" onMouseDown={keepFocus} onClick={() => stepSize(-1)}>{I.minus}</button>
                  <input
                    className="pli-size-input"
                    aria-label="Font size"
                    inputMode="decimal"
                    value={sizeText}
                    onChange={(e) => setSizeText(e.target.value)}
                    onBlur={() => sizeText && Number(sizeText) !== format?.fontSize && applySize(Number(sizeText))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applySize(Number(sizeText));
                      }
                    }}
                  />
                  <button type="button" className="pli-tool" aria-label="Increase font size" onMouseDown={keepFocus} onClick={() => stepSize(1)}>{I.plus}</button>
                </div>
              </div>
              <div className="pli-group" data-group="marks">
                {button("Bold", <b>B</b>, () => cmd.toggleMark(ctx, "bold", !!format?.bold), { pressed: !!format?.bold, shortcut: `${mod}B` })}
                {button("Italic", <i>I</i>, () => cmd.toggleMark(ctx, "italic", !!format?.italic), { pressed: !!format?.italic, shortcut: `${mod}I` })}
                {button("Underline", <u>U</u>, () => cmd.toggleMark(ctx, "underline", !!format?.underline), { pressed: !!format?.underline, shortcut: `${mod}U` })}
                {button("Strikethrough", <s>S</s>, () => cmd.toggleMark(ctx, "strike", !!format?.strike), { pressed: !!format?.strike })}
                <ColorPicker label="Text color" value={format?.color} icon={I.textColor} noneLabel="Automatic" onChange={(c) => cmd.formatMarks(ctx, { color: c })} />
                <ColorPicker label="Highlight color" value={format?.highlight} icon={I.highlight} noneLabel="None" onChange={(c) => cmd.formatMarks(ctx, { highlight: c })} />
                {button("Link", I.link, p.onLink, { pressed: !!format?.link, shortcut: `${mod}K` })}
              </div>
              <div className="pli-group" data-group="paragraph">
                {button("Align left", I.left, () => cmd.setAlign(ctx, "left"), { pressed: format?.align === "left", shortcut: `${mod}⇧L` })}
                {button("Align center", I.center, () => cmd.setAlign(ctx, "center"), { pressed: format?.align === "center", shortcut: `${mod}⇧E` })}
                {button("Align right", I.right, () => cmd.setAlign(ctx, "right"), { pressed: format?.align === "right", shortcut: `${mod}⇧R` })}
                {button("Justify", I.justify, () => cmd.setAlign(ctx, "justify"), { pressed: format?.align === "justify", shortcut: `${mod}⇧J` })}
                <Dropdown label="Vertical alignment" className="pli-tool-wide" panel={(close) => (
                  <MenuList close={close} label="Vertical alignment" items={(["top", "middle", "bottom"] as const).map((v) => ({ label: v[0]!.toUpperCase() + v.slice(1), checked: format?.vAlign === v, onSelect: () => cmd.setVAlign(ctx, v) }))} />
                )}>{I.vAlign}</Dropdown>
                <Dropdown label="Line spacing" className="pli-tool-wide" panel={(close) => (
                  <MenuList close={close} label="Line spacing" items={[
                    ...SPACINGS.map((s) => ({ label: s === 1 ? "Single" : s === 2 ? "Double" : String(s), checked: format?.lineSpacing === s, onSelect: () => cmd.setLineSpacing(ctx, s) })),
                    "separator" as const,
                    { label: "Add space before paragraph", onSelect: () => cmd.setSpaceBefore(ctx, 10) },
                    { label: "Remove space before paragraph", onSelect: () => cmd.setSpaceBefore(ctx, null) },
                    { label: "Add space after paragraph", onSelect: () => cmd.setSpaceAfter(ctx, 10) },
                    { label: "Remove space after paragraph", onSelect: () => cmd.setSpaceAfter(ctx, null) },
                  ]} />
                )}>{I.lineSpacing}</Dropdown>
                {button("Bulleted list", I.bullets, () => cmd.setList(ctx, "bullet"), { pressed: format?.bullet === "bullet", shortcut: `${mod}⇧8` })}
                {button("Numbered list", I.numbers, () => cmd.setList(ctx, "number"), { pressed: format?.bullet === "number", shortcut: `${mod}⇧7` })}
                {button("Decrease indent", I.outdent, () => cmd.indent(ctx, -1), { shortcut: `${mod}[` })}
                {button("Increase indent", I.indent, () => cmd.indent(ctx, 1), { shortcut: `${mod}]` })}
              </div>
            </>
          )}
          {hasBorder && (
            <div className="pli-group" data-group="shape">
              {(isShape || isTable) && <ColorPicker label="Fill color" value={fill} icon={I.fill} noneLabel="Transparent" onChange={(c) => cmd.setFill(ctx, c === null ? null : c)} />}
              <ColorPicker label="Border color" value={typeof borderColor === "string" ? borderColor : undefined} icon={I.borderColor} noneLabel="Transparent" onChange={(c) => (c === null ? cmd.setLine(ctx, null) : cmd.setLine(ctx, { color: c, width: first?.line?.width ?? 1 }))} />
              <Dropdown label="Border weight" className="pli-tool-wide" panel={(close) => (
                <MenuList close={close} label="Border weight" items={WEIGHTS.map((w) => ({ label: `${w}pt`, checked: weight === w, onSelect: () => cmd.setLine(ctx, { width: w }) }))} />
              )}>{I.borderWeight}</Dropdown>
              <Dropdown label="Border dash" className="pli-tool-wide" panel={(close) => (
                <MenuList close={close} label="Border dash" items={DASHES.map((d) => ({ label: d.label, checked: (dash ?? "solid") === d.value, onSelect: () => cmd.setLine(ctx, { dash: d.value }) }))} />
              )}>{I.borderDash}</Dropdown>
            </div>
          )}
          {isImage && (
            <div className="pli-group" data-group="image">
              {button("Crop image", I.crop, () => p.onCrop(!p.cropping), { pressed: p.cropping })}
              <Dropdown label="Mask image" className="pli-tool-wide" panel={(close) => (
                <MenuList close={close} label="Mask image" items={[
                  { label: "No mask", checked: !first?.custom && (first?.geometry ?? "rect") === "rect", onSelect: () => session.updateElements(ctx.owner, ctx.ids, { geometry: null, custom: null }) },
                  ...["ellipse", "roundRect", "triangle", "diamond", "hexagon", "star5", "heart", "rightArrow"].map((g) => ({ label: g, checked: !first?.custom && first?.geometry === g, onSelect: () => session.updateElements(ctx.owner, ctx.ids, { geometry: g, custom: null }) })),
                ]} />
              )}>{I.mask}</Dropdown>
            </div>
          )}
          {isTable && (
            <div className="pli-group" data-group="table">
              <Dropdown label="Table" className="pli-tool-wide" panel={(close) => <MenuList close={close} label="Table" items={p.tableMenu} />}>
                <span className="pli-deck-with-chevron">{I.table} {I.chevron}</span>
              </Dropdown>
            </div>
          )}
          {selection.length > 0 && !p.editingText && (
            <div className="pli-group" data-group="arrange">
              {button("Format options", I.more, p.onFormatOptions)}
            </div>
          )}
          <div className="pli-group pli-group-end" data-group="present">
            <button type="button" className="pli-tool pli-deck-label-tool pli-deck-present-button" aria-label="Present" title={`Present (${mod}Enter)`} onMouseDown={keepFocus} onClick={p.onPresent}>{I.present}<span>Slideshow</span></button>
          </div>
        </>
      )}
    </Bar>
  );
}

/** The layouts of a master with a small picture of each. */
export function LayoutGrid({ session, layouts, current, onPick }: { session: DeckSession; layouts: Layout[]; current: string | null; onPick: (id: string) => void }) {
  const size = session.deck.size;
  const scale = 112 / size.width;
  return (
    <div className="pli-deck-layouts" role="menu" aria-label="Layouts">
      {layouts.map((l) => (
        <button key={l.id} type="button" role="menuitemradio" aria-checked={l.id === current} className="pli-deck-layout-button" title={l.name} onClick={() => onPick(l.id)}>
          <SlideView scene={session.scene(l.id)} scale={scale} prompts />
          <span>{l.name}</span>
        </button>
      ))}
    </div>
  );
}
