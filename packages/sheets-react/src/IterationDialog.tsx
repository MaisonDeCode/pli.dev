import { useEffect, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { DEFAULT_ITERATION, type IterationSettings } from "@pli.dev/sheets";

export interface IterationDialogProps {
  open: boolean;
  /** The settings now, or null when iterative calculation is off. */
  current: IterationSettings | null;
  onClose(): void;
  /** Gives the settings (or null to turn it off). Returns why they were refused, if they were. */
  onSubmit(settings: IterationSettings | null): string | void;
}

/** Turns iterative calculation on or off, and sets how many times a circular chain is worked out and how small a change stops it. */
export function IterationDialog({ open, current, onClose, onSubmit }: IterationDialogProps) {
  const [on, setOn] = useState(false);
  const [count, setCount] = useState(String(DEFAULT_ITERATION.maxIterations));
  const [change, setChange] = useState(String(DEFAULT_ITERATION.maxChange));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setOn(current !== null);
    setCount(String((current ?? DEFAULT_ITERATION).maxIterations));
    setChange(String((current ?? DEFAULT_ITERATION).maxChange));
    setProblem(null);
  }, [open, current]);

  const submit = () => {
    if (!on) {
      const refused = onSubmit(null);
      if (refused) setProblem(refused);
      return;
    }
    const maxIterations = Number(count);
    const maxChange = Number(change);
    if (count.trim() === "" || change.trim() === "" || Number.isNaN(maxIterations) || Number.isNaN(maxChange)) return setProblem("Both limits are numbers.");
    const refused = onSubmit({ maxIterations, maxChange });
    if (refused) setProblem(refused);
  };

  return (
    <Dialog
      open={open}
      title="Iterative calculation"
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        <label className="pli-ruleform-check">
          <input type="checkbox" autoFocus checked={on} onChange={(e) => setOn(e.target.checked)} /> Calculate formulas that refer to themselves again and again
        </label>
        <label>
          Most iterations
          <input type="number" disabled={!on} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <label>
          Greatest change
          <input type="number" disabled={!on} value={change} onChange={(e) => setChange(e.target.value)} />
        </label>
        <p className="pli-ruleform-hint">
          A chain of formulas that reads itself is worked out again, each time reading what it came to before, until no value changes by more than the greatest change or it has been worked out the most times. Off, such a formula reads as 0.
        </p>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
