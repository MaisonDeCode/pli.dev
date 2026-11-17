import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const Icons = {
  undo: <Icon><path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H6" /><path d="M5.5 3.5 3 6l2.5 2.5" /></Icon>,
  redo: <Icon><path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H10" /><path d="M10.5 3.5 13 6l-2.5 2.5" /></Icon>,
  print: <Icon><path d="M4.5 6V2.5h7V6" /><rect x="2" y="6" width="12" height="5.5" rx="1" /><path d="M4.5 9.5h7v4h-7z" /></Icon>,
  bullets: <Icon><path d="M6 4h8M6 8h8M6 12h8" /><circle cx="2.5" cy="4" r=".7" fill="currentColor" /><circle cx="2.5" cy="8" r=".7" fill="currentColor" /><circle cx="2.5" cy="12" r=".7" fill="currentColor" /></Icon>,
  numbers: <Icon><path d="M7 4h7M7 8h7M7 12h7" /><path d="M2.4 3.3 3.4 2.8V5.6M2.2 9.4c0-.9 1.7-.9 1.7 0 0 .8-1.7 1.3-1.7 2.1h1.8" strokeWidth="1" /></Icon>,
  outdent: <Icon><path d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12" /><path d="M4.5 6 2.5 8l2 2" /></Icon>,
  indent: <Icon><path d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12" /><path d="M2.5 6l2 2-2 2" /></Icon>,
  left: <Icon><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8" /></Icon>,
  center: <Icon><path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8" /></Icon>,
  right: <Icon><path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8" /></Icon>,
  justify: <Icon><path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12" /></Icon>,
  comment: <Icon><path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1z" /><path d="M8 5v3.5M6.25 6.75h3.5" /></Icon>,
  link: <Icon><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" /></Icon>,
  wrap: <Icon><rect x="2" y="2.5" width="5" height="5" rx="1" /><path d="M9.5 3.5h4M9.5 6.5h4M2 10h11.5M2 13h11.5" /></Icon>,
  image: <Icon><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><circle cx="5.7" cy="6" r="1.1" /><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" /></Icon>,
  clear: <Icon><path d="M3 3h8M7 3 5 13M9.5 8.5l4 4M13.5 8.5l-4 4" /></Icon>,
  textColor: <Icon><path d="M4.5 11.5 8 3l3.5 8.5M5.6 8.8h4.8" /></Icon>,
  highlight: <Icon><path d="m9.5 3 3.5 3.5-5.8 5.8H3.7V8.8z" /><path d="M8 4.5 11.5 8" /></Icon>,
  lineSpacing: <Icon><path d="M6.5 3h7M6.5 8h7M6.5 13h7" /><path d="M3 4.5v7M1.7 5.7 3 4.3l1.3 1.4M1.7 10.3 3 11.7l1.3-1.4" /></Icon>,
  outline: <Icon><path d="M2.5 3.5h11M5.5 7h8M5.5 10.5h8M2.5 14h8" /></Icon>,
  search: <Icon><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5" /></Icon>,
  chevron: <Icon><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></Icon>,
  close: <Icon><path d="m4 4 8 8M12 4l-8 8" /></Icon>,
  up: <Icon><path d="m4 10 4-4 4 4" /></Icon>,
  down: <Icon><path d="m4 6 4 4 4-4" /></Icon>,
  pageBreak: <Icon><path d="M2.5 8h2M7 8h2M11.5 8h2" /><path d="M4 2.5v3.5M12 2.5v3.5M4 10v3.5M12 10v3.5" /></Icon>,
  table: <Icon><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M2 6.5h12M2 9.8h12M6 3v10M10 3v10" /></Icon>,
  merge: <Icon><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M8 3v2.2M8 10.8V13M5.3 8H2M14 8h-3.3M6.2 6.5 4.7 8l1.5 1.5M9.8 6.5 11.3 8l-1.5 1.5" /></Icon>,
  split: <Icon><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M8 3v10M4.5 8h2M9.5 8h2" /></Icon>,
  fill: <Icon><path d="m3.5 8.5 4-4.5 4.5 4.5-4.5 4.2z" /><path d="M7.5 4 6 2.5" /><path d="M13 10.5s1.3 1.5 1.3 2.3a1.3 1.3 0 0 1-2.6 0c0-.8 1.3-2.3 1.3-2.3z" /></Icon>,
  more: <Icon><circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none" /></Icon>,
  minus: <Icon><path d="M3.5 8h9" /></Icon>,
  plus: <Icon><path d="M3.5 8h9M8 3.5v9" /></Icon>,
};
