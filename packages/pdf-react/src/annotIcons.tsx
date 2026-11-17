import type { ReactNode } from "react";
import { Icons as Base } from "@pli.dev/react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** The annotation tools' icons. */
export const AnnotIcons = {
  select: <Icon><path d="m3.500 2 8 6.200-3.600.6 2 3.700-1.600.9-2-3.700-2.800 2.400z" /></Icon>,
  highlight: <Icon><path d="m9.500 2.500 4 4-5.200 5.200H4.300V7.700z" /><path d="M2.500 14h11" strokeWidth="2.200" opacity=".55" /></Icon>,
  underline: <Icon><path d="M4.500 2.500v5a3.500 3.500 0 0 0 7 0v-5" /><path d="M3 14h10" /></Icon>,
  strikeout: <Icon><path d="M10.800 4.200C10.300 3.200 9.300 2.600 8 2.600c-1.700 0-2.900.9-2.900 2.100 0 3 6 1.700 6 4.700 0 1.300-1.300 2.200-3.100 2.200-1.400 0-2.600-.6-3.100-1.700" /><path d="M2.500 8h11" /></Icon>,
  squiggly: <Icon><path d="M4.500 2.500v4.500a3.500 3.500 0 0 0 7 0V2.500" /><path d="m2.500 13.500 1.500-1.500 1.500 1.500L7 12l1.500 1.500L10 12l1.500 1.500L13 12l.8.8" /></Icon>,
  pen: <Icon><path d="M11 2.500 13.500 5 6 12.500l-3.200.7.7-3.200z" /><path d="m9.700 3.800 2.500 2.500" /></Icon>,
  eraser: <Icon><path d="m7 13.500-4-4a1 1 0 0 1 0-1.400L8.600 2.500a1 1 0 0 1 1.400 0l3.500 3.500a1 1 0 0 1 0 1.400L8 13z" /><path d="M5.500 6.500 10 11M7 13.500h7" /></Icon>,
  rectangle: <Icon><rect x="2.500" y="3.500" width="11" height="9" rx="1" /></Icon>,
  ellipse: <Icon><ellipse cx="8" cy="8" rx="5.500" ry="4.500" /></Icon>,
  line: <Icon><path d="m3 13 10-10" /></Icon>,
  arrow: <Icon><path d="M3 13 13 3M7.500 3H13v5.500" /></Icon>,
  polyline: <Icon><path d="m2.500 12 3.500-6 3 4 4.500-7" /><circle cx="2.500" cy="12" r=".9" fill="currentColor" /><circle cx="6" cy="6" r=".9" fill="currentColor" /><circle cx="9" cy="10" r=".9" fill="currentColor" /></Icon>,
  polygon: <Icon><path d="M8 2.500 13.500 6.500 11.500 13h-7L2.500 6.500z" /></Icon>,
  shapes: <Icon><rect x="2" y="7" width="7" height="6.500" rx="1" /><circle cx="10.500" cy="5.500" r="3.200" /></Icon>,
  text: <Icon><rect x="2" y="2.500" width="12" height="11" rx="1" strokeDasharray="2.200 1.400" /><path d="M5 5.800V5h6v.8M8 5v5.500M6.800 10.500h2.400" /></Icon>,
  note: <Icon><path d="M3.500 2.500h9a1 1 0 0 1 1 1V9l-4.500 4.500h-5.500a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" /><path d="M13.500 9H10a.5.5 0 0 0-.5.5v4M5.500 5.800h5M5.500 8.200h2.500" /></Icon>,
  stamp: <Icon><path d="M6 9.500V7a2 2 0 1 1 4 0v2.500l2 1.500v1.500H4V11z" /><path d="M3 14h10" /></Icon>,
  signature: <Icon><path d="M2 11c1.500-4 3-7 4-7 1.500 0 0 5.500 1.200 5.500S9 6 10 6c.8 0 .4 2.500 1.400 2.500.8 0 1.300-.8 2.100-.8" /><path d="M2.500 13.500h11" /></Icon>,
  image: Base.image,
  link: Base.link,
  showLinks: <Icon><rect x="1.500" y="3.500" width="13" height="9" rx="1.200" strokeDasharray="2 1.500" /><path d="M6.800 9.200a1.400 1.400 0 0 0 2 0l1.200-1.200a1.400 1.400 0 0 0-2-2l-.4.4M9.200 6.800a1.400 1.400 0 0 0-2 0L6 8a1.400 1.400 0 0 0 2 2l.4-.4" strokeWidth="1.100" /></Icon>,
  redact: <Icon><rect x="2.500" y="4.500" width="11" height="7" rx="1" fill="currentColor" fillOpacity=".25" /><path d="M5 8h6" strokeWidth="2" /></Icon>,
  undo: Base.undo,
  redo: Base.redo,
  trash: <Icon><path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500M7 7v4M9 7v4" /></Icon>,
  copy: <Icon><rect x="5.500" y="5.500" width="8" height="8" rx="1" /><path d="M10.500 5.500v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></Icon>,
  lock: <Icon><rect x="3.500" y="7" width="9" height="6.500" rx="1" /><path d="M5.500 7V5a2.500 2.500 0 0 1 5 0v2" /></Icon>,
  unlock: <Icon><rect x="3.500" y="7" width="9" height="6.500" rx="1" /><path d="M5.500 7V5a2.500 2.500 0 0 1 4.800-1" /></Icon>,
  front: <Icon><rect x="2.500" y="6" width="7" height="7" rx="1" /><path d="M6.500 6V3.500a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9.500" fill="currentColor" fillOpacity=".25" /></Icon>,
  back: <Icon><rect x="6.500" y="6.500" width="7" height="7" rx="1" /><path d="M9.500 6.500v-3h-6v6h3" /></Icon>,
  eye: <Icon><path d="M1.500 8S4 3.500 8 3.500 14.500 8 14.500 8 12 12.500 8 12.500 1.500 8 1.500 8z" /><circle cx="8" cy="8" r="2" /></Icon>,
  comment: Base.comment,
  more: Base.more,
  check: <Icon><path d="m3.500 8.500 3 3 6-7" /></Icon>,
  list: Base.bullets,
  /** The Annotations tab. */
  annotations: <Icon><path d="M9 2.500H3.800a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8.400a1 1 0 0 0 1-1V8" /><path d="m13.200 2.200 1.100 1.100-4.900 4.900-1.800.5.500-1.800z" /></Icon>,
  close: Base.close,
  plus: Base.plus,
  minus: Base.minus,
  pin: <Icon><path d="M8 14s4.500-4.200 4.500-7.500a4.500 4.500 0 0 0-9 0C3.500 9.800 8 14 8 14z" /><circle cx="8" cy="6.500" r="1.500" /></Icon>,
};
