import type { ReactNode } from "react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** The icons of the Edit text and pictures tool. */
export const EditIcons = {
  /** Text with a caret: change the words on the page. */
  edit: (
    <Icon>
      <path d="M2.500 4.500V3h8v1.500M6.500 3v7.500M5 10.500h3" />
      <path d="m10.800 13.600.4-1.800 3-3 1.400 1.400-3 3z" />
    </Icon>
  ),
  /** The Edits tab: changes waiting for the save, as a history. */
  list: (
    <Icon>
      <path d="M2.500 7.500A5.500 5.500 0 1 1 4.100 11.400" />
      <path d="M2.300 4.200v3.400h3.400" />
      <path d="M8 5v3.200l2 1.200" />
    </Icon>
  ),
  picture: (
    <Icon>
      <rect x="2" y="3" width="12" height="10" rx="1.200" />
      <circle cx="5.700" cy="6.500" r="1.100" />
      <path d="m2.500 12 3.700-3.500 2.500 2.200 2-1.700 3.300 3" />
    </Icon>
  ),
  trash: (
    <Icon>
      <path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500" />
    </Icon>
  ),
};
