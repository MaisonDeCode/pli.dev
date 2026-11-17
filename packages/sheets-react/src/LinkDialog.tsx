import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { MAX_LINK_LENGTH, parseCell, parseRange } from "@pli.dev/sheets";

export interface LinkDialogResult {
  to: string;
  tip?: string;
  /** The text for the cell, when it was changed. */
  text?: string;
}

export interface LinkDialogProps {
  open: boolean;
  /** The link the cell has now, if it has one. */
  existing: { to: string; tip?: string } | null;
  /** What the cell shows now, and whether it can be changed here (not for a formula, or several cells). */
  text: string;
  textEditable: boolean;
  sheets: { id: string; name: string }[];
  currentSheet: string;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: LinkDialogResult): string | void;
  onRemove?(): void;
}

const quoted = (name: string) => (/^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** An address typed without its scheme (`pli.dev/sheets`) is taken as a web address. */
function withScheme(address: string): string {
  const a = address.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(a) || /^[#/.\\]/.test(a) || /\s/.test(a)) return a;
  return /^[^/]+\.[a-z]{2,}(?:[/?#]|$)/i.test(a) ? `https://${a}` : a;
}

/** Makes a cell a link to a web address or to a place in the workbook, and changes or removes one. */
export function LinkDialog({ open, existing, text, textEditable, sheets, currentSheet, onClose, onSave, onRemove }: LinkDialogProps) {
  const [kind, setKind] = useState<"web" | "place">("web");
  const [address, setAddress] = useState("");
  const [sheet, setSheet] = useState(currentSheet);
  const [cell, setCell] = useState("A1");
  const [tip, setTip] = useState("");
  const [label, setLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setLabel(text);
    setTip(existing?.tip ?? "");
    const to = existing?.to ?? "";
    if (to.startsWith("#")) {
      const m = /^#(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(to);
      const name = m ? (m[1] ?? m[2])!.replace(/''/g, "'") : undefined;
      setKind("place");
      setSheet(sheets.find((s) => s.name.toLowerCase() === name?.toLowerCase())?.id ?? currentSheet);
      setCell(m ? m[3]! : to.slice(1) || "A1");
      setAddress("");
    } else {
      setKind("web");
      setAddress(to);
      setSheet(currentSheet);
      setCell("A1");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    let to: string;
    if (kind === "web") {
      to = withScheme(address);
      if (to === "") return setProblem("Type the address to link to.");
      if (to.length > MAX_LINK_LENGTH) return setProblem(`An address can be at most ${MAX_LINK_LENGTH} characters.`);
    } else {
      const ref = cell.replace(/\$/g, "").trim().toUpperCase();
      if (!parseCell(ref) && !parseRange(ref)) return setProblem("Type a cell such as B4, or a range such as B4:C9.");
      const name = sheets.find((s) => s.id === sheet)?.name ?? "";
      to = `#${quoted(name)}!${ref}`;
    }
    const refused = onSave({ to, ...(tip.trim() ? { tip: tip.trim() } : {}), ...(textEditable && label !== text && label !== "" ? { text: label } : {}) });
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={open}
      title={existing ? "Edit link" : "Insert link"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          {existing && onRemove && <button type="button" className="pli-button" onClick={onRemove}>Remove link</button>}
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">{existing ? "Save" : "Insert"}</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        {textEditable && (
          <label>
            Text to show
            <input type="text" value={label} placeholder="The address, if left empty" onChange={(e) => setLabel(e.target.value)} />
          </label>
        )}
        <label>
          Link to
          <select aria-label="Kind of link" value={kind} onChange={(e) => setKind(e.target.value as "web" | "place")}>
            <option value="web">A web address, email or file</option>
            <option value="place">A place in this workbook</option>
          </select>
        </label>
        {kind === "web" ? (
          <label>
            Address
            <input type="text" autoFocus value={address} placeholder="https://pli.dev, or mailto:ana@example.com" onChange={(e) => setAddress(e.target.value)} />
          </label>
        ) : (
          <>
            <label>
              Sheet
              <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
                {sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>
              Cell or range
              <input type="text" autoFocus value={cell} placeholder="B4" onChange={(e) => setCell(e.target.value)} />
            </label>
          </>
        )}
        <label>
          Tip shown on hover
          <input type="text" value={tip} maxLength={255} onChange={(e) => setTip(e.target.value)} />
        </label>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
