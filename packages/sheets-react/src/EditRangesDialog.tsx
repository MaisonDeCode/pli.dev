import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import type { EditRange, SheetSession } from "@pli.dev/sheets";

export interface EditRangesDialogProps {
  open: boolean;
  session: SheetSession;
  sheetId: string;
  /** The selection, offered as the cells of a new range. */
  selection: string;
  onClose(): void;
}

const roles = (text: string) => text.split(",").map((r) => r.trim()).filter(Boolean);

/**
 * Excel's Allow Edit Ranges: the ranges of a sheet that may be edited when it is protected, each with a title, its cells and,
 * if wanted, a password and the roles that need none. Changing them is for an unprotected sheet.
 */
export function EditRangesDialog({ open, session, sheetId, selection, onClose }: EditRangesDialogProps) {
  const [, setTick] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cells, setCells] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState("");
  const [denied, setDenied] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const list: readonly EditRange[] = open ? session.editRanges(sheetId) : [];
  const locked = session.isProtected(sheetId);
  const reset = () => {
    setEditing(null);
    setName("");
    setCells(selection);
    setPassword("");
    setPermissions("");
    setDenied("");
    setProblem(null);
  };
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    try {
      const ranges = cells.split(/[\s,;]+/).filter(Boolean);
      const wanted = roles(permissions);
      const refused = roles(denied);
      if (editing === null) session.addEditRange(sheetId, { name, ranges, ...(password ? { password } : {}), ...(wanted.length ? { permissions: wanted } : {}), ...(refused.length ? { denied: refused } : {}) });
      else {
        const old = list.find((r) => r.name === editing);
        session.updateEditRange(sheetId, editing, { name, ranges, ...(password ? { password } : {}), permissions: wanted.length ? wanted : old?.permissions?.length === 0 ? [] : null, denied: refused.length ? refused : null });
      }
      reset();
      setTick((t) => t + 1);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const edit = (r: EditRange) => {
    setEditing(r.name);
    setName(r.name);
    setCells(r.ranges.join(", "));
    setPassword("");
    setPermissions((r.permissions ?? []).join(", "));
    setDenied((r.denied ?? []).join(", "));
    setProblem(null);
  };
  const remove = (r: EditRange) => {
    try {
      session.deleteEditRange(sheetId, r.name);
      reset();
      setTick((t) => t + 1);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      title="Allow edit ranges"
      onClose={onClose}
      onSubmit={() => (locked ? onClose() : save())}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Close</button>
          {!locked && <button type="submit" className="pli-button pli-button-primary">{editing === null ? "Add" : "Save"}</button>}
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        {list.length === 0 ? (
          <p className="pli-ruleform-hint">No ranges can be edited on this sheet yet. When the sheet is protected, a range added here can be changed by anyone, or only by people who know its password or have one of its roles.</p>
        ) : (
          <table className="pli-editranges" aria-label="Ranges that people may edit">
            <thead>
              <tr><th>Title</th><th>Cells</th><th>Who</th><th /></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.ranges.join(", ")}</td>
                  <td>{([r.password ? "password" : "", r.permissions ? (r.permissions.length ? r.permissions.join(", ") : "nobody by role") : ""].filter(Boolean).join(" or ") || "anyone") + (r.denied?.length ? `; not ${r.denied.join(", ")}` : "")}</td>
                  <td>
                    <button type="button" className="pli-button" disabled={locked} onClick={() => edit(r)}>Modify</button>{" "}
                    <button type="button" className="pli-button" disabled={locked} onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {locked ? (
          <p className="pli-ruleform-hint">This sheet is protected. Unprotect it (you may be asked for a password) to change these ranges.</p>
        ) : (
          <>
            <label>
              Title
              <input type="text" autoFocus autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Cells
              <input type="text" autoComplete="off" value={cells} onChange={(e) => setCells(e.target.value)} placeholder="B2:B9, D2" />
            </label>
            <label>
              {editing === null ? "Password (optional)" : "New password (leave empty to keep it)"}
              <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              Roles that need no password (optional)
              <input type="text" autoComplete="off" value={permissions} onChange={(e) => setPermissions(e.target.value)} placeholder="finance, user:ada, sid:S-1-5-21-…" />
            </label>
            <label>
              Denied roles or accounts (optional)
              <input type="text" autoComplete="off" value={denied} onChange={(e) => setDenied(e.target.value)} placeholder="interns, sid:S-1-5-21-…" />
            </label>
            {editing !== null && <button type="button" className="pli-button" onClick={reset}>Add a new range instead</button>}
            <p className="pli-ruleform-hint">These count once the sheet is protected. Roles come from the person using the sheet (their id as user:id counts too), and so do their Windows accounts, as Excel names them, by security identifier (sid:S-1-5-21-…). A range with roles and no password can be edited by nobody else, and someone denied needs the password even when a role would let them in.</p>
          </>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}

export interface EditRangePasswordDialogProps {
  /** The title of the range to open, or null when closed. */
  range: string | null;
  onClose(): void;
  /** Gives the password. Returns why it was refused, if it was. */
  onSubmit(password: string): string | void;
}

/** Asks for the password of a range that people may edit. */
export function EditRangePasswordDialog({ range, onClose, onSubmit }: EditRangePasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setPassword("");
    setProblem(null);
  }, [range]);
  return (
    <Dialog
      open={range !== null}
      title="Unlock range"
      onClose={onClose}
      onSubmit={() => {
        const refused = onSubmit(password);
        if (refused) setProblem(refused);
      }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        <label>
          {range ? `Password for "${range}"` : "Password"}
          <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
