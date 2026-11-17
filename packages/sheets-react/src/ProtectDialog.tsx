import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { DEFAULT_ALLOW, PERMISSIONS, PERMISSION_LABELS, type Permission } from "@pli.dev/sheets";

export type ProtectMode = "protect-sheet" | "unprotect-sheet" | "protect-workbook" | "unprotect-workbook";

export interface ProtectResult {
  password?: string;
  allow?: Permission[];
  /** Roles that may also do each thing (sheet), or change the structure (workbook, under `structureRoles`). */
  roles?: Partial<Record<Permission, string[]>>;
  /** Roles that may change locked cells. */
  editLocked?: string[];
  structureRoles?: string[];
}

export interface ProtectDialogProps {
  mode: ProtectMode | null;
  /** The sheet's name, for the title. */
  sheetName: string;
  onClose(): void;
  /** Returns why it was refused (a wrong password), if it was. */
  onSubmit(mode: ProtectMode, result: ProtectResult): string | void;
}

const TITLES: Record<ProtectMode, (name: string) => string> = {
  "protect-sheet": (name) => `Protect sheet "${name}"`,
  "unprotect-sheet": (name) => `Unprotect sheet "${name}"`,
  "protect-workbook": () => "Protect the workbook's structure",
  "unprotect-workbook": () => "Unprotect the workbook",
};

/** Protects or unprotects a sheet or the workbook's structure: an optional password, and for a sheet what people may still do. */
export function ProtectDialog({ mode, sheetName, onClose, onSubmit }: ProtectDialogProps) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [allow, setAllow] = useState<Permission[]>([...DEFAULT_ALLOW]);
  const [roles, setRoles] = useState<Partial<Record<Permission, string>>>({});
  const [editLocked, setEditLocked] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!mode) return;
    setPassword("");
    setAgain("");
    setAllow([...DEFAULT_ALLOW]);
    setRoles({});
    setEditLocked("");
    setProblem(null);
  }, [mode]);
  const opening = mode === "unprotect-sheet" || mode === "unprotect-workbook";

  const submit = () => {
    if (!mode) return;
    if (!opening && password !== again) return setProblem("The two passwords are different.");
    const list = (text: string) => text.split(",").map((r) => r.trim()).filter(Boolean);
    const byRole = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, list(v ?? "")]).filter(([, v]) => (v as string[]).length)) as Partial<Record<Permission, string[]>>;
    const locked = list(editLocked);
    const refused = onSubmit(mode, {
      ...(password ? { password } : {}),
      ...(mode === "protect-sheet" ? { allow, ...(Object.keys(byRole).length ? { roles: byRole } : {}), ...(locked.length ? { editLocked: locked } : {}) } : {}),
      ...(mode === "protect-workbook" && list(editLocked).length ? { structureRoles: list(editLocked) } : {}),
    });
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={mode !== null}
      title={mode ? TITLES[mode](sheetName) : ""}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">{opening ? "Unprotect" : "Protect"}</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        <label>
          {opening ? "Password" : "Password (optional)"}
          <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {!opening && (
          <label>
            Type it again
            <input type="password" autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
        )}
        {mode === "protect-sheet" && (
          <fieldset>
            <legend>Everyone may</legend>
            {PERMISSIONS.map((p) => (
              <label key={p} className="pli-ruleform-check">
                <input type="checkbox" checked={allow.includes(p)} onChange={(e) => setAllow((a) => (e.target.checked ? [...a, p] : a.filter((x) => x !== p)))} /> {PERMISSION_LABELS[p]}{" "}
                <input type="text" className="pli-protect-roles" autoComplete="off" placeholder="roles" aria-label={`Roles that may also: ${PERMISSION_LABELS[p]}`} value={roles[p] ?? ""} onChange={(e) => setRoles((r) => ({ ...r, [p]: e.target.value }))} />
              </label>
            ))}
          </fieldset>
        )}
        {(mode === "protect-sheet" || mode === "protect-workbook") && (
          <label>
            {mode === "protect-sheet" ? "Roles that may change locked cells" : "Roles that may change the structure"}
            <input type="text" autoComplete="off" placeholder="owner, admin" value={editLocked} onChange={(e) => setEditLocked(e.target.value)} />
          </label>
        )}
        {!opening && (
          <p className="pli-ruleform-hint">
            {mode === "protect-workbook" ? "Sheets can't be added, deleted, renamed, moved or hidden." : "Locked cells can't be changed. Cells are locked unless you unlock them (Format > Locked)."} A password keeps people from taking the protection off by accident; it isn't a way to keep a file secret.
          </p>
        )}
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
