import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dropdown, FilePickerContext, MenuList, keepFocus, pickWith, type MenuEntry } from "@pli.dev/react";
import type { PdfViewContext } from "./extensions";
import { useSessionRevision } from "./hooks";
import { AnnotIcons as I } from "./annotIcons";
import { TOOL_INFO } from "./annotTools";
import { SWATCHES } from "./annotStyles";
import type { AnnotController, ToolId } from "./annotController";
import { annotCommands, redactItems, shapeIds, shapeItems, signatureItems, stampItems, toolCommand } from "./annotMenus";
import { commandTitle } from "./commands";
import { useController, useTextSelectionBar } from "./annotUi";
import { CommentPopover, CompactBar, LinkPopover, SelectionBar } from "./AnnotPopovers";
import { ApplyRedactionsDialog, SignatureDialog, StampTextDialog } from "./AnnotDialogs";

/** The row of annotation tools under the toolbar, and the floating panels and dialogs that belong to it. */

function ToolButton({ c, id }: { c: AnnotController; id: ToolId }) {
  if (!c.tools.has(id)) return null;
  const m = TOOL_INFO[id];
  const cmd = toolCommand(c, id);
  return (
    <button type="button" className="pli-tool pli-pdf-tool" aria-label={cmd.label} aria-pressed={!!cmd.checked} aria-keyshortcuts={m.shortcut} title={commandTitle(cmd)} data-tool={id} onMouseDown={keepFocus} onClick={cmd.run}>
      {cmd.icon}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pli-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Highlight colour: the swatches, applied to the next highlights (and remembered). */
function ColorMenu({ c, style, label }: { c: AnnotController; style: "highlight" | "ink"; label: string }) {
  const color = c.style(style).color;
  return (
    <Dropdown label={label} className="pli-pdf-colorbtn" panel={(close) => (
      <div className="pli-colors">
        <div className="pli-swatches" role="group" aria-label={label}>
          {SWATCHES.map((sw) => (
            <button key={sw} type="button" className="pli-swatch" style={{ background: sw }} aria-label={sw} title={sw} aria-pressed={color.toLowerCase() === sw} onClick={() => (c.setStyle(style, { color: sw }), close())} />
          ))}
        </div>
      </div>
    )}>
      <span className="pli-pdf-dot" style={{ background: color }} aria-hidden="true" />
    </Dropdown>
  );
}

export function AnnotRibbon({ c, view, readOnly = false, extra }: { c: AnnotController; view: PdfViewContext; readOnly?: boolean; extra?: ReactNode }) {
  c.setView(view);
  useSessionRevision(c.session);
  useController(c);
  useTextSelectionBar(c, view);
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useContext(FilePickerContext);
  const pageId = useRef(view.pageId);
  pageId.current = view.pageId;
  const [shape, setShape] = useState<ToolId>("rectangle");
  const selectedCount = c.selectedIds.length;
  useEffect(() => {
    // Lets the style sheet keep touch dragging on while something is selected (see `.pli-pdf-interact[data-tool="select"]`).
    view.scroller()?.closest(".pli-pdf")?.toggleAttribute("data-annot-selected", selectedCount > 0);
  });
  useEffect(() => {
    // With the editor's `filePicker` the file comes from it; without one the hidden input below opens the browser's chooser.
    c.actions.pickImage = picker
      ? () => void pickWith(picker, { purpose: "image", accept: "image/png,image/jpeg", label: "Choose a picture" }).then(([file]) => (file ? c.insertImage(file, pageId.current) : undefined))
      : () => fileInput.current?.click();
    return () => {
      c.actions.pickImage = undefined;
    };
  }, [c, picker]);
  if (readOnly)
    // No tools to show: only the live region and the comment box a click on a note opens (the style sheet hides the empty bar).
    return (
      <div className="pli-pdf-ribbon-empty">
        <div className="pli-pdf-sr" role="status" aria-live="polite" aria-atomic="true">
          {c.live}
        </div>
        <Overlays c={c} />
      </div>
    );
  const has = (id: ToolId) => c.tools.has(id);
  const shapes = shapeIds(c);
  const shapeMenu: MenuEntry[] = shapeItems(c, setShape);
  const stampMenu: MenuEntry[] = stampItems(c);
  const k = annotCommands(c);
  const marks = c.redactionCount();
  const active = c.toolId ? TOOL_INFO[c.toolId as ToolId] : null;
  const placing = c.placing;

  return (
    <div className="pli-pdf-ribbon-inner">
      <Group label="Pointer">
        <ToolButton c={c} id="select" />
      </Group>
      <Group label="Mark up text">
        <ToolButton c={c} id="highlight" />
        {has("highlight") && <ColorMenu c={c} style="highlight" label="Highlight colour" />}
        <ToolButton c={c} id="underline" />
        <ToolButton c={c} id="strikeout" />
        <ToolButton c={c} id="squiggly" />
      </Group>
      <Group label="Draw">
        <ToolButton c={c} id="ink" />
        {has("ink") && <ColorMenu c={c} style="ink" label="Pen colour" />}
        <ToolButton c={c} id="eraser" />
        {shapes.length > 0 && (
          <Dropdown label="Shapes" className={shapes.includes(c.toolId as ToolId) ? "pli-pdf-pressed" : undefined} panel={(close) => <MenuList label="Shapes" items={shapeMenu} close={close} />}>
            {TOOL_INFO[shapes.includes(c.toolId as ToolId) ? (c.toolId as ToolId) : shapes.includes(shape) ? shape : shapes[0]!].icon}
          </Dropdown>
        )}
      </Group>
      <Group label="Add">
        <ToolButton c={c} id="text" />
        <ToolButton c={c} id="note" />
        {has("note") && (
          <button type="button" className="pli-tool pli-pdf-tool" aria-label={k.comment!.label} title={commandTitle(k.comment!)} data-command="comment" onMouseDown={keepFocus} onClick={k.comment!.run}>
            {k.comment!.icon}
          </button>
        )}
        {has("stamp") && (
          <Dropdown label="Stamps" className={c.toolId === "stamp" ? "pli-pdf-pressed" : undefined} panel={(close) => <MenuList label="Stamps" items={stampMenu} close={close} />}>
            {I.stamp}
          </Dropdown>
        )}
        {has("signature") && (
          <Dropdown label="Signature" className={c.toolId === "signature" ? "pli-pdf-pressed" : undefined} panel={(close) => <MenuList label="Signature" items={signatureItems(c)} close={close} />}>
            {I.signature}
          </Dropdown>
        )}
        {has("image") && (
          <>
            <button type="button" className="pli-tool pli-pdf-tool" aria-label={k.picture!.label} title={commandTitle(k.picture!)} aria-keyshortcuts={TOOL_INFO.image.shortcut} onMouseDown={keepFocus} onClick={k.picture!.run}>
              {I.image}
            </button>
            {!picker && (
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Choose a picture"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void c.insertImage(file, view.pageId);
                }}
              />
            )}
          </>
        )}
        <ToolButton c={c} id="link" />
      </Group>
      {has("redact") && (
        <Group label="Redaction">
          <ToolButton c={c} id="redact" />
          <Dropdown label="Redaction options" panel={(close) => <MenuList label="Redaction options" items={redactItems(c)} close={close} />}>
            <span className="pli-pdf-redact-menu">{marks.marks > 0 ? <span className="pli-pdf-badge">{marks.marks}</span> : null}{I.more}</span>
          </Dropdown>
        </Group>
      )}
      {extra}
      <Group label="View">
        <button type="button" className="pli-tool pli-pdf-tool" aria-label={k.showLinks!.label} aria-pressed={!!k.showLinks!.checked} title={commandTitle(k.showLinks!)} onMouseDown={keepFocus} onClick={k.showLinks!.run}>
          {k.showLinks!.icon}
        </button>
      </Group>
      <p className="pli-pdf-hint" role="note">
        {placing ? (placing.kind === "stamp" ? "Click the page to place the stamp, or drag to size it." : placing.kind === "signature" ? "Click the page to place it, or drag to size it." : "Click the page to place the picture.") : (active?.hint ?? "")}
      </p>
      <div className="pli-pdf-sr" role="status" aria-live="polite" aria-atomic="true">
        {c.live}
      </div>
      <Overlays c={c} />
    </div>
  );
}

/** The find bar's "Redact all matches…": marks every match of the search for redaction and asks to apply them. */
export function RedactMatches({ c, find }: { c: AnnotController; find: { query: string; matchCase: boolean; wholeWord: boolean } }) {
  return (
    <button
      type="button"
      className="pli-tool pli-pdf-find-redact"
      aria-label="Redact all matches"
      title="Redact all matches…"
      disabled={!find.query.trim()}
      onMouseDown={keepFocus}
      onClick={() => void c.redactMatches(find.query, { matchCase: find.matchCase, wholeWord: find.wholeWord })}
    >
      {I.redact}
    </button>
  );
}

/** Floating panels and dialogs: comments, links, the bars over a selection, signature and redaction dialogs. */
export function Overlays({ c }: { c: AnnotController }) {
  useController(c);
  return (
    <>
      <CommentPopover c={c} />
      <LinkPopover key={c.popover?.kind === "link" ? (c.popover.annot ?? "new") : "none"} c={c} />
      <SelectionBar c={c} />
      <CompactBar c={c} />
      {(c.dialog === "signature" || c.dialog === "initials") && <SignatureDialog key={c.dialog} c={c} />}
      {c.dialog === "stamp-text" && <StampTextDialog c={c} />}
      {c.dialog === "apply-redactions" && <ApplyRedactionsDialog c={c} />}
    </>
  );
}
