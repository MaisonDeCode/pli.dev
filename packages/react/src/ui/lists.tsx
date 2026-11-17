import { useState } from "react";
import { MAX_LIST_START, type DocumentSession, type ListMarker, type ListState } from "@pli.dev/docs";
import { Dialog, type MenuEntry } from "./primitives";

const NUMBERED: { marker: ListMarker; label: string }[] = [
  { marker: "decimal", label: "1. 2. 3." },
  { marker: "lower-alpha", label: "a. b. c." },
  { marker: "upper-alpha", label: "A. B. C." },
  { marker: "lower-roman", label: "i. ii. iii." },
  { marker: "upper-roman", label: "I. II. III." },
];

const BULLETED: { marker: ListMarker; label: string }[] = [
  { marker: "disc", label: "• Disc" },
  { marker: "circle", label: "◦ Circle" },
  { marker: "square", label: "▪ Square" },
];

export interface ListMenuOptions {
  /** Open a dialog for the number the list starts at. Without it, the item is left out. */
  onStartAt?: () => void;
}

/** The list commands as menu entries, for the toolbar's list menu and the Format menu: how the list is marked, and where it numbers from. */
export function listMenuItems(session: DocumentSession, list: ListState | null, after: () => void, options: ListMenuOptions = {}): MenuEntry[] {
  const run = (action: () => unknown) => () => {
    action();
    after();
  };
  const numbered = list ? list.kind === "ordered" : true;
  const choices = (numbered ? NUMBERED : BULLETED).map(({ marker, label }) => ({
    label,
    disabled: !list,
    checked: list?.marker === marker,
    onSelect: run(() => session.setListMarker(marker)),
  }));
  if (!numbered) return choices;
  return [
    ...choices,
    "separator",
    { label: "Restart at 1", disabled: !list, onSelect: run(() => session.setListStart(1)) },
    ...(options.onStartAt ? [{ label: "Start at…", disabled: !list, onSelect: options.onStartAt }] : []),
    { label: "Continue numbering", disabled: !list?.restarts, onSelect: run(() => session.continueNumbering()) },
  ];
}

export interface ListStartDialogProps {
  open: boolean;
  /** The number the item has now. */
  initial?: number;
  onApply: (start: number) => void;
  onClose: () => void;
}

/** A number for the selected item to take, with the items after it counting on from there. */
export function ListStartDialog({ open, initial, onApply, onClose }: ListStartDialogProps) {
  const [start, setStart] = useState(initial ?? 1);
  return (
    <Dialog
      open={open}
      title="Start numbering at"
      onClose={onClose}
      onSubmit={() => { onApply(Math.min(MAX_LIST_START, Math.max(0, Math.round(start)))); onClose(); }}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Apply</button>
        </>
      }
    >
      <label className="pli-field-row">
        <span>Number</span>
        <input type="number" min={0} max={MAX_LIST_START} step={1} value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} autoFocus />
      </label>
      <p className="pli-dialog-note">The selected item takes this number and the items after it count on from it. For a list in letters or roman numerals, 3 is c or iii.</p>
    </Dialog>
  );
}
