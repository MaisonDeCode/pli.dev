import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";

export interface PasteSourceDialogProps {
  open: boolean;
  onClose(): void;
  /** Gives where the copied cells began in Excel (`B2`), or `"here"` for formulas taken as written. */
  onSubmit(source: string): void;
}

/**
 * Paste special > Formulas from Excel…: Excel's clipboard has each formula as it reads in the workbook it came from and
 * doesn't say where the copied cells were, so Pli works that out from the values. Here the position is told instead.
 */
export function PasteSourceDialog({ open, onClose, onSubmit }: PasteSourceDialogProps) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setText("");
    setProblem(null);
  }, [open]);

  const submit = () => {
    const t = text.trim().replace(/\$/g, "").toUpperCase();
    if (t !== "" && !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(t)) return setProblem(`"${text.trim()}" is not a cell address such as B2.`);
    onSubmit(t === "" ? "here" : t);
  };

  return (
    <Dialog
      open={open}
      title="Formulas from Excel"
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Paste</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        <label>
          The cells were copied from, in Excel, starting at
          <input type="text" autoFocus value={text} placeholder="B2" aria-label="Top left cell of the copied cells in Excel" onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="pli-ruleform-hint">
          Excel writes each formula as it reads in its own workbook and doesn't say where the copied cells were. Give the top left cell of what you copied and the formulas are moved by the distance to where you paste, those that point outside the copied cells too. Left empty, the formulas are pasted as written, as if you had copied them from where you paste.
        </p>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
