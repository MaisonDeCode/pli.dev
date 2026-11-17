import type { ReactNode } from "react";
import { keepFocus } from "@pli.dev/react";
import { ALIGN_LABEL, ALIGNMENTS, DISTRIBUTE_LABEL, type Align, type Distribute } from "./align";

/** The icons of the Align and Distribute buttons. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const ArrangeIcons: Record<Align | Distribute, ReactNode> = {
  left: (
    <Icon>
      <path d="M2.500 2v12" />
      <rect x="4.500" y="3.500" width="9" height="3.500" rx=".6" />
      <rect x="4.500" y="9" width="5" height="3.500" rx=".6" />
    </Icon>
  ),
  center: (
    <Icon>
      <path d="M8 2v12" />
      <rect x="3" y="3.500" width="10" height="3.500" rx=".6" />
      <rect x="5" y="9" width="6" height="3.500" rx=".6" />
    </Icon>
  ),
  right: (
    <Icon>
      <path d="M13.500 2v12" />
      <rect x="2.500" y="3.500" width="9" height="3.500" rx=".6" />
      <rect x="6.500" y="9" width="5" height="3.500" rx=".6" />
    </Icon>
  ),
  top: (
    <Icon>
      <path d="M2 2.500h12" />
      <rect x="3.500" y="4.500" width="3.500" height="9" rx=".6" />
      <rect x="9" y="4.500" width="3.500" height="5" rx=".6" />
    </Icon>
  ),
  middle: (
    <Icon>
      <path d="M2 8h12" />
      <rect x="3.500" y="3" width="3.500" height="10" rx=".6" />
      <rect x="9" y="5" width="3.500" height="6" rx=".6" />
    </Icon>
  ),
  bottom: (
    <Icon>
      <path d="M2 13.500h12" />
      <rect x="3.500" y="2.500" width="3.500" height="9" rx=".6" />
      <rect x="9" y="6.500" width="3.500" height="5" rx=".6" />
    </Icon>
  ),
  horizontal: (
    <Icon>
      <path d="M2.500 2v12M13.500 2v12" />
      <rect x="6.500" y="4" width="3" height="8" rx=".6" />
    </Icon>
  ),
  vertical: (
    <Icon>
      <path d="M2 2.500h12M2 13.500h12" />
      <rect x="4" y="6.500" width="8" height="3" rx=".6" />
    </Icon>
  ),
};

export interface ArrangeProps {
  /** How many things are selected that can be moved. Align needs 2, distribute 3. */
  count: number;
  onAlign(how: Align): void;
  onDistribute(how: Distribute): void;
}

/** Align and Distribute buttons, for the properties panels of annotations and of form fields. */
export function Arrange({ count, onAlign, onDistribute }: ArrangeProps) {
  const button = (label: string, icon: ReactNode, run: () => void, disabled: boolean) => (
    <button key={label} type="button" className="pli-tool pli-pdf-tool" aria-label={label} title={label} disabled={disabled} onMouseDown={keepFocus} onClick={run}>
      {icon}
    </button>
  );
  return (
    <div className="pli-pdf-arrange" role="group" aria-label="Arrange">
      <div className="pli-pdf-field pli-pdf-field-inline">
        <span className="pli-pdf-field-label">Align</span>
        <span className="pli-arrange-row">{ALIGNMENTS.map((how) => button(ALIGN_LABEL[how], ArrangeIcons[how], () => onAlign(how), count < 2))}</span>
      </div>
      <div className="pli-pdf-field pli-pdf-field-inline">
        <span className="pli-pdf-field-label">Distribute</span>
        <span className="pli-arrange-row">{(["horizontal", "vertical"] as const).map((how) => button(DISTRIBUTE_LABEL[how], ArrangeIcons[how], () => onDistribute(how), count < 3))}</span>
      </div>
    </div>
  );
}
