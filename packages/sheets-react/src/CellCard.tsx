import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keepFocus } from "@pli.dev/react";
import { isOpenable, isPlace, type CellLink, type NoteInfo } from "@pli.dev/sheets";
import { NoteContent } from "./NoteContent";
import { NoteFill, hasFill, noteFrameCss } from "./noteLook";

/** The cell a card is about, and where it is in the window. `active` is the selected cell (the card has buttons); otherwise the pointer is resting on it. */
export interface CellCardInfo {
  row: number;
  col: number;
  active: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CellCardProps {
  info: CellCardInfo;
  link: (CellLink & { formula?: true }) | null;
  note: NoteInfo | null;
  readOnly: boolean;
  container: HTMLElement | null;
  onOpen(link: CellLink): void;
  onEditLink(): void;
  onRemoveLink(): void;
  onEditNote(): void;
  onDeleteNote(): void;
  /** Keeps the note showing on the sheet, or lets it go back to showing only when the pointer rests on its cell. */
  onToggleNote?(): void;
}

const shorten = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a cell holds besides its value: where its link goes, with a way to open it, and its note. */
export function CellCard({ info, link, note, readOnly, container, onOpen, onEditLink, onRemoveLink, onEditNote, onDeleteNote, onToggleNote }: CellCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const below = info.bottom + 4;
    // Under the cell, or over it when there is no room.
    const top = below + box.height > window.innerHeight - margin ? Math.max(margin, info.top - box.height - 4) : below;
    setPlace({ left: Math.max(margin, Math.min(info.left, window.innerWidth - box.width - margin)), top });
  }, [info.left, info.top, info.bottom, link?.to, link?.tip, note?.text, note?.runs, note?.author, note?.box?.width, note?.box?.height, info.active]);

  const place_ = link && isPlace(link.to);
  const followable = link && (place_ || isOpenable(link.to));
  return createPortal(
    <div
      ref={ref}
      className="pli-panel pli-panel-fixed pli-cellcard"
      role={info.active ? "group" : "tooltip"}
      aria-label={info.active ? "Link and note" : undefined}
      style={place ? { left: place.left, top: place.top } : { left: info.left, top: info.bottom + 4, visibility: "hidden" }}
      onMouseDown={keepFocus}
      onPointerLeave={() => {
        // A card the pointer was resting on goes when the pointer leaves it (the selected cell's card stays).
        if (!info.active) window.dispatchEvent(new Event("pli-cellcard-left"));
      }}
    >
      {link && (
        <div className="pli-cellcard-link">
          <span className="pli-cellcard-to" title={link.to}>{place_ ? `In this workbook: ${link.to.slice(1)}` : shorten(link.to)}</span>
          {link.tip && <span className="pli-cellcard-tip">{link.tip}</span>}
          {info.active && (
            <span className="pli-cellcard-actions">
              {followable && <button type="button" className="pli-button" onClick={() => onOpen(link)}>Open</button>}
              {!link.formula && !readOnly && <button type="button" className="pli-button" onClick={onEditLink}>Edit…</button>}
              {!link.formula && !readOnly && <button type="button" className="pli-button" onClick={onRemoveLink}>Remove</button>}
              {link.formula && <span className="pli-cellcard-tip">From the HYPERLINK formula</span>}
            </span>
          )}
        </div>
      )}
      {note !== null && (
        <div className="pli-cellcard-note">
          {note.box?.show ? (
            <div className="pli-cellcard-tip">{note.author ? `Note by ${note.author}, showing on the sheet` : "Note showing on the sheet"}</div>
          ) : (
            <div
              className="pli-cellcard-text"
              data-look={hasFill(note.box) || note.box?.line !== undefined ? "" : undefined}
              style={{ ...(note.box?.width ? { width: note.box.width } : {}), ...(note.box?.height ? { minHeight: note.box.height } : {}), ...noteFrameCss(note.box) }}
            >
              <NoteFill box={note.box} />
              <div className="pli-cellcard-notebody"><NoteContent info={note} onOpenLink={(to) => onOpen({ to })} /></div>
            </div>
          )}
          {info.active && !readOnly && (
            <span className="pli-cellcard-actions">
              <button type="button" className="pli-button" onClick={onEditNote}>Edit note…</button>
              {onToggleNote && <button type="button" className="pli-button" onClick={onToggleNote}>{note.box?.show ? "Hide note" : "Show note"}</button>}
              <button type="button" className="pli-button" onClick={onDeleteNote}>Delete note</button>
            </span>
          )}
        </div>
      )}
    </div>,
    container ?? document.body,
  );
}
