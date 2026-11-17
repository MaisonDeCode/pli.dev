import type { ReactNode } from "react";
import { PdfIcons } from "./icons";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Icons of the page tools and the file menu. */
export const PageIcons = {
  rotateRight: PdfIcons.rotateView,
  rotateLeft: <Icon><path d="M3 8a5 5 0 1 0 1.700-3.800" /><path d="M3.500 1.800v3h3" /></Icon>,
  trash: <Icon><path d="M2.500 4.200h11M6 4.200V2.500h4v1.700M4 4.200l.6 9h6.800l.6-9M6.600 6.800v4.200M9.400 6.800v4.200" /></Icon>,
  duplicate: <Icon><rect x="5.500" y="5.500" width="8" height="8" rx="1.200" /><path d="M10.500 3.500v-.2a1 1 0 0 0-1-1H3.500a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.2" /></Icon>,
  insertBlank: <Icon><path d="M9.500 2H4.500a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" /><path d="M9.500 2v3h3M8 7.500v4M6 9.500h4" /></Icon>,
  more: PdfIcons.more,
  file: <Icon><path d="M9.500 2H4.500a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" /><path d="M9.500 2v3h3" /></Icon>,
  folder: <Icon><path d="M2 4.500a1 1 0 0 1 1-1h3l1.500 1.500H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" /></Icon>,
  grid: PdfIcons.organise,
  add: <Icon><path d="M8 3v10M3 8h10" /></Icon>,
  bookmark: <Icon><path d="M4 2.500h8v11L8 10.500l-4 3z" /></Icon>,
  bookmarkAdd: <Icon><path d="M4 2.500h8v11L8 10.500l-4 3z" /><path d="M8 4.800v3M6.500 6.300h3" /></Icon>,
  rename: <Icon><path d="M10.500 2.800 13.200 5.500 5.500 13.200 2.500 13.500 2.800 10.500z" /></Icon>,
  target: <Icon><circle cx="8" cy="8" r="2" /><path d="M8 2v2.500M8 11.500V14M2 8h2.500M11.500 8H14" /></Icon>,
  close: PdfIcons.close,
  indent: PdfIcons.indent,
  outdent: PdfIcons.outdent,
  up: PdfIcons.up,
  down: PdfIcons.down,
};
