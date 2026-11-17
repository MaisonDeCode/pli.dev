import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keepFocus, useDismiss } from "@pli.dev/react";
import type { ChipOption } from "@pli.dev/sheets";
import type { ChipKind } from "./chips";

/** The badge a card is about: which cell and which value in it, and where the badge is in the window (the card opens under it). */
export interface ChipCardInfo {
  row: number;
  col: number;
  /** The value the badge stands for (the id in the cell). */
  value: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ChipCardProps {
  info: ChipCardInfo;
  kind: ChipKind;
  item: ChipOption;
  /** The spreadsheet's root, which the card is drawn inside so its colours apply. */
  container: HTMLElement | null;
  onClose(): void;
}

/**
 * The card an app shows when a badge of its own kind is clicked (`ChipKind.card`): a panel under the badge with whatever
 * the app draws in it. Escape or a click anywhere else closes it, and focus goes into the card while it is open and back
 * to the grid when it closes.
 */
export function ChipCard({ info, kind, item, container, onClose }: ChipCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useDismiss(true, onClose, ref);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const below = info.bottom + 4;
    // Under the badge, or over it when there is no room.
    const top = below + box.height > window.innerHeight - margin ? Math.max(margin, info.top - box.height - 4) : below;
    setPlace({ left: Math.max(margin, Math.min(info.left, window.innerWidth - box.width - margin)), top });
  }, [info.left, info.top, info.bottom, info.value]);
  useEffect(() => {
    const card = ref.current;
    if (!card) return;
    // Focus moves into the card (its first button or link, or the card itself) so it can be used from the keyboard.
    (card.querySelector<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? card).focus({ preventScroll: true });
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="pli-panel pli-panel-fixed pli-chipcard"
      role="dialog"
      aria-label={item.label ?? item.value}
      tabIndex={-1}
      style={place ? { left: place.left, top: place.top } : { left: info.left, top: info.bottom + 4, visibility: "hidden" }}
      onMouseDown={keepFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {kind.card!(item, { close: onClose })}
    </div>,
    container ?? document.body,
  );
}
