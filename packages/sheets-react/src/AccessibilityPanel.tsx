import { useMemo, useState } from "react";
import { checkAccessibility, fixAccessibility, fixAllAccessibility, type AccessIssue, type SheetSession } from "@pli.dev/sheets";

export interface AccessibilityPanelProps {
  session: SheetSession;
  /** Changes whenever the workbook does, so the list is checked again. */
  revision: number;
  readOnly: boolean;
  /** Shows the place of a problem: switches to its sheet and selects the cell or range. */
  go(issue: AccessIssue): void;
  onClose(): void;
  onProblem?(message: string): void;
}

const LABEL = { error: "Errors", warning: "Warnings", tip: "Tips" } as const;

/** Excel's Review > Check Accessibility: the problems a screen reader or poor eyesight would meet, each with where it is and, where there is one, a Fix. */
export function AccessibilityPanel({ session, revision, readOnly, go, onClose, onProblem }: AccessibilityPanelProps) {
  const [tick, setTick] = useState(0);
  const issues = useMemo(() => checkAccessibility(session), [session, revision, tick]);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onProblem?.(e instanceof Error ? e.message : String(e));
    }
    setTick((n) => n + 1);
  };
  const fixable = issues.filter((i) => i.fix);
  return (
    <section className="pli-accessbar" aria-label="Accessibility check">
      <div className="pli-accessbar-head">
        <strong>Accessibility</strong>
        <span className="pli-accessbar-count" role="status">{issues.length === 0 ? "No problems found." : `${issues.length} ${issues.length === 1 ? "problem" : "problems"} found.`}</span>
        <span className="pli-accessbar-spacer" />
        <button type="button" className="pli-button" disabled={readOnly || fixable.length === 0} onClick={() => attempt(() => void fixAllAccessibility(session, issues))}>Fix all ({fixable.length})</button>
        <button type="button" className="pli-button" onClick={() => setTick((n) => n + 1)}>Check again</button>
        <button type="button" className="pli-button" onClick={onClose} aria-label="Close the accessibility check">Close</button>
      </div>
      {issues.length > 0 && (
        <div className="pli-accessbar-list">
          {(["error", "warning", "tip"] as const).map((sev) => {
            const here = issues.filter((i) => i.severity === sev);
            if (!here.length) return null;
            return (
              <div key={sev} className="pli-accessbar-group" data-severity={sev}>
                <h3>{LABEL[sev]} ({here.length})</h3>
                <ul>
                  {here.map((i) => (
                    <li key={i.id}>
                      <button type="button" className="pli-accessbar-go" onClick={() => go(i)} title={`Go to ${i.sheet}!${i.where}`}>
                        <span className="pli-accessbar-where">{i.sheet}!{i.where}</span> {i.message}
                      </button>
                      {i.hint && <span className="pli-accessbar-hint"> {i.hint}</span>}
                      {i.fix && <button type="button" className="pli-button pli-accessbar-fix" disabled={readOnly} onClick={() => attempt(() => fixAccessibility(session, i))}>{i.fix}</button>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
