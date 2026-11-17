import type { ReactNode } from "react";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Toolbar icons for borders, merged cells and conditional formats. */
export const FormatIcons = {
  borders: (
    <Icon>
      <rect x="2.5" y="2.5" width="11" height="11" rx="0.5" />
      <path d="M8 2.5v11M2.5 8h11" strokeDasharray="1.2 1.4" />
    </Icon>
  ),
  merge: (
    <Icon>
      <rect x="2" y="3.5" width="12" height="9" rx="1" />
      <path d="M5.5 8h5M8.6 6.2 10.5 8l-1.9 1.8M7.4 6.2 5.5 8l1.9 1.8" />
    </Icon>
  ),
  conditional: (
    <Icon>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6.2h12M2 9.8h12" />
      <rect x="3.2" y="3.4" width="5" height="1.9" rx="0.3" fill="currentColor" stroke="none" opacity="0.8" />
      <rect x="3.2" y="7" width="8" height="1.9" rx="0.3" fill="currentColor" stroke="none" opacity="0.5" />
      <rect x="3.2" y="10.6" width="3" height="1.9" rx="0.3" fill="currentColor" stroke="none" opacity="0.8" />
    </Icon>
  ),
};
