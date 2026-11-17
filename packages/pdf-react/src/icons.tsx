import type { ReactNode } from "react";
import { Icons as Base } from "@pli.dev/react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** The viewer's icons: Pli's shared ones plus the viewer-specific ones. */
export const PdfIcons = {
  ...Base,
  sidebar: <Icon><rect x="2" y="2.5" width="12" height="11" rx="1.2" /><path d="M6 2.5v11" /></Icon>,
  properties: <Icon><rect x="2" y="2.5" width="12" height="11" rx="1.2" /><path d="M10 2.5v11M11.500 5.500h1M11.500 8h1" /></Icon>,
  prev: <Icon><path d="m10 3.500-5 4.500 5 4.500" /></Icon>,
  next: <Icon><path d="m6 3.500 5 4.500-5 4.500" /></Icon>,
  zoomIn: <Icon><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5M5.2 7h3.600M7 5.200v3.600" /></Icon>,
  zoomOut: <Icon><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5M5.2 7h3.600" /></Icon>,
  rotateView: <Icon><path d="M13 8a5 5 0 1 1-1.700-3.800" /><path d="M12.500 1.800v3h-3" /></Icon>,
  continuous: <Icon><rect x="4" y="1.500" width="8" height="5" rx=".8" /><rect x="4" y="9.500" width="8" height="5" rx=".8" /></Icon>,
  single: <Icon><rect x="4" y="2" width="8" height="12" rx="1" /></Icon>,
  spread: <Icon><rect x="1.500" y="3" width="6" height="10" rx=".8" /><rect x="8.500" y="3" width="6" height="10" rx=".8" /></Icon>,
  thumbnails: <Icon><rect x="2" y="2" width="5" height="5" rx=".8" /><rect x="9" y="2" width="5" height="5" rx=".8" /><rect x="2" y="9" width="5" height="5" rx=".8" /><rect x="9" y="9" width="5" height="5" rx=".8" /></Icon>,
  download: <Icon><path d="M8 2.500v8M4.800 7.500 8 10.700l3.200-3.200M3 13.500h10" /></Icon>,
  save: <Icon><path d="M3 2.500h8l2.500 2.500v8.500H3z" /><path d="M5.500 2.500v3.500h4.500V2.500M5.500 13.500V9.500h5v4" /></Icon>,
  caretRight: <Icon><path d="m6 4 4 4-4 4" /></Icon>,
  caretDown: <Icon><path d="m4 6 4 4 4-4" /></Icon>,
  blank: <Icon><rect x="3.500" y="2" width="9" height="12" rx="1" strokeDasharray="2 1.600" /></Icon>,
  // ---- the sidebar's tabs: one picture each, none like another ----
  /** Outline: bookmarks as a tree (a parent with indented children). */
  outlineTree: <Icon><rect x="2" y="2.500" width="3" height="3" rx=".6" /><path d="M3.500 5.500v6.500M3.500 8h2.500M3.500 12h2.500M7.500 8h6.500M7.500 12h6.500M7.500 4h6.500" /></Icon>,
  /** Annotations: a note sheet with a marker drawing on it. */
  annotations: <Icon><path d="M9 2.500H3.800a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8.400a1 1 0 0 0 1-1V8" /><path d="m13.200 2.200 1.100 1.100-4.900 4.900-1.800.5.500-1.800z" /></Icon>,
  /** Edits: a pencil with the arrow of a history (changes waiting for the save). */
  edits: <Icon><path d="M2.500 7.500A5.500 5.500 0 1 1 4.100 11.400" /><path d="M2.300 4.200v3.400h3.400" /><path d="M8 5v3.200l2 1.200" /></Icon>,
  // ---- the bars ----
  fitWidth: <Icon><rect x="1.500" y="3.500" width="13" height="9" rx="1" /><path d="M4 8h8M5.800 6.200 4 8l1.800 1.800M10.200 6.200 12 8l-1.800 1.800" /></Icon>,
  fitPage: <Icon><rect x="4" y="1.500" width="8" height="13" rx="1" /><path d="M8 4.500v7M6.300 6.200 8 4.500l1.700 1.700M6.300 9.800 8 11.500l1.700-1.700" /></Icon>,
  fullscreen: <Icon><path d="M2.500 6V2.500H6M10 2.500h3.500V6M13.500 10v3.500H10M6 13.500H2.500V10" /></Icon>,
  exitFullscreen: <Icon><path d="M6 2.500V6H2.500M13.500 6H10V2.500M10 13.500V10h3.500M2.500 10H6v3.500" /></Icon>,
  share: <Icon><circle cx="6" cy="5.500" r="2.500" /><path d="M1.500 13.500c.2-2.600 2-4 4.500-4 1 0 1.800.2 2.500.7" /><path d="M12 8v5M9.500 10.500h5" /></Icon>,
  theme: <Icon><circle cx="8" cy="8" r="5.500" /><path d="M8 2.500v11" /><path d="M8 2.500a5.500 5.500 0 0 1 0 11z" fill="currentColor" stroke="none" /></Icon>,
  keyboard: <Icon><rect x="1.500" y="4" width="13" height="8" rx="1.200" /><path d="M4 6.800h.1M6.500 6.800h.1M9 6.800h.1M11.500 6.800h.1M4.500 9.500h7" /></Icon>,
  info: <Icon><circle cx="8" cy="8" r="6" /><path d="M8 7.200v4M8 4.800h.01" /></Icon>,
  replace: <Icon><path d="M2.500 5h8.500M8.800 2.800 11 5 8.800 7.200M13.500 11H5M7.200 8.800 5 11l2.200 2.200" /></Icon>,
  findReplace: <Icon><circle cx="6" cy="5.500" r="3" /><path d="m8.200 7.700 2 2" /><path d="M2.500 13h10.500M11 11l2 2-2 2" /></Icon>,
  replaceAll: <Icon><path d="M2.500 4.500h7M7.500 2.500l2 2-2 2M13.500 9.500h-7M8.500 7.500l-2 2 2 2" /><path d="M2.500 12.500h11" strokeDasharray="1.500 1.500" /></Icon>,
  organise: <Icon><rect x="2" y="2" width="5" height="6.500" rx=".8" /><rect x="9" y="2" width="5" height="6.500" rx=".8" /><path d="M3 12h10M11 10l2 2-2 2" /></Icon>,
  borderWidth: <Icon><path d="M2 3.500h12" strokeWidth="1" /><path d="M2 7h12" strokeWidth="2" /><path d="M2 11.500h12" strokeWidth="3.500" /></Icon>,
  /** Version history: a page with a clock on it. */
  versions: <Icon><path d="M8.500 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h5l3 3v2" /><path d="M9 2v3h3" /><circle cx="11.500" cy="11.500" r="3" /><path d="M11.500 10v1.700l1 .6" /></Icon>,
  comments: Base.comment,
  help: <Icon><circle cx="8" cy="8" r="6" /><path d="M6.200 6.300a1.900 1.900 0 1 1 2.700 1.700c-.6.300-.9.700-.9 1.300M8 11.500h.01" /></Icon>,
  check: <Icon><path d="m3.500 8.500 3 3 6-7" /></Icon>,
};
