import type { ReactNode } from "react";
import { Icons as Base } from "@pli.dev/react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** The deck editor's icons: Pli's shared ones plus the slide-specific ones. */
export const DeckIcons = {
  ...Base,
  select: <Icon><path d="M3.5 2.5 12 7l-4.2 1.2L6.6 12.5z" /></Icon>,
  textBox: <Icon><rect x="2" y="3" width="12" height="10" rx="1" strokeDasharray="2 1.6" /><path d="M5.5 6.5h5M8 6.5v4" /></Icon>,
  shape: <Icon><rect x="2" y="7" width="7" height="7" rx="1" /><circle cx="10.5" cy="5.5" r="3.5" /></Icon>,
  line: <Icon><path d="M3 13 13 3" /></Icon>,
  arrow: <Icon><path d="M3 13 13 3M7.5 3H13v5.5" /></Icon>,
  elbow: <Icon><path d="M3 12.5h4v-9h6" /></Icon>,
  curve: <Icon><path d="M3 12.5c5 0 2-9 10-9" /></Icon>,
  newSlide: <Icon><rect x="2" y="3.5" width="12" height="9" rx="1" /><path d="M8 6v4M6 8h4" /></Icon>,
  background: <Icon><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="m2.5 11.5 3-3.2 2.7 2.6 2-2 3.3 3" /></Icon>,
  layout: <Icon><rect x="2" y="2.5" width="12" height="11" rx="1" /><path d="M2 6h12M7 6v7.5" /></Icon>,
  master: <Icon><rect x="2" y="2" width="12" height="12" rx="1.2" /><rect x="4" y="4" width="8" height="2.6" /><path d="M4 9h8M4 11.5h5.5" /></Icon>,
  theme: <Icon><path d="M8 2.2a5.8 5.8 0 1 0 0 11.6c1 0 1.4-.7 1.1-1.5-.3-.8.1-1.6 1-1.6h1.3a2.6 2.6 0 0 0 2.6-2.6C14 5 11.4 2.2 8 2.2z" /><circle cx="5" cy="7.5" r=".8" fill="currentColor" stroke="none" /><circle cx="7.5" cy="5" r=".8" fill="currentColor" stroke="none" /><circle cx="10.5" cy="5.5" r=".8" fill="currentColor" stroke="none" /></Icon>,
  transition: <Icon><rect x="1.5" y="4" width="7" height="8" rx="1" /><rect x="7.5" y="4" width="7" height="8" rx="1" /></Icon>,
  present: <Icon><rect x="2" y="2.5" width="12" height="8" rx="1" /><path d="M8 10.5v3M5.5 13.5h5M6.8 4.8v3.4L9.7 6.5z" fill="currentColor" /></Icon>,
  zoom: <Icon><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5M5.3 7h3.4" /></Icon>,
  crop: <Icon><path d="M4 1.5v10.5h10.5M1.5 4H12v10.5" /></Icon>,
  mask: <Icon><circle cx="8" cy="8" r="5.5" /><path d="m3 11 3-3 2.5 2.5 2-2 2.5 2.5" /></Icon>,
  front: <Icon><rect x="5" y="5" width="8" height="8" rx="1" /><path d="M3 10.5V3h7.5" /></Icon>,
  back: <Icon><rect x="3" y="3" width="8" height="8" rx="1" /><path d="M13 5.5V13H5.5" /></Icon>,
  group: <Icon><rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="2 1.6" /><rect x="4.5" y="4.5" width="4" height="4" /><rect x="8" y="8" width="3.5" height="3.5" /></Icon>,
  borderColor: <Icon><path d="m9.5 3 3.5 3.5-6.3 6.3H3.2V9.3z" /><path d="M2 15h12" strokeWidth="2" /></Icon>,
  borderWeight: <Icon><path d="M2 3h12M2 6.5h12" strokeWidth="1" /><path d="M2 10h12" strokeWidth="2" /><path d="M2 14h12" strokeWidth="3" /></Icon>,
  borderDash: <Icon><path d="M2 8h2.5M6.8 8h2.5M11.5 8H14" /></Icon>,
  vAlign: <Icon><path d="M2 2.5h12M2 13.5h12M8 5v6M5.8 6.8 8 4.7l2.2 2.1M5.8 9.2 8 11.3l2.2-2.1" /></Icon>,
  strike: <Icon><path d="M3 8h10M10.5 4.8c-.4-1-1.4-1.6-2.6-1.6-1.5 0-2.6.8-2.6 2s1 1.7 2.7 2.2c1.700.5 2.700 1.100 2.700 2.300 0 1.300-1.200 2.100-2.800 2.100-1.300 0-2.400-.6-2.800-1.700" /></Icon>,
  trash: <Icon><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.500h5.800l.6-8.500M7 7v4M9 7v4" /></Icon>,
  copy: <Icon><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6.500a1 1 0 0 0-1 1v6.500a1 1 0 0 0 1 1h.5" /></Icon>,
  paste: <Icon><rect x="3" y="3" width="10" height="11" rx="1" /><path d="M6 3V2h4v1" /></Icon>,
  cut: <Icon><circle cx="4.5" cy="11.5" r="2" /><circle cx="11.5" cy="11.5" r="2" /><path d="M5.5 9.500 11 2.500M10.500 9.500 5 2.500" /></Icon>,
  play: <Icon><path d="M5 3.500v9l7-4.500z" fill="currentColor" /></Icon>,
  laser: <Icon><circle cx="8" cy="8" r="2" fill="currentColor" /><path d="M8 1.500v2M8 12.500v2M1.500 8h2M12.500 8h2M3.500 3.500l1.400 1.400M11.100 11.100l1.400 1.400M12.500 3.500l-1.400 1.400M4.900 11.100l-1.400 1.400" /></Icon>,
  notes: <Icon><rect x="2" y="2.500" width="12" height="11" rx="1" /><path d="M4.500 10.500h7M4.500 8h7" /></Icon>,
  tableRow: <Icon><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 8h12" strokeWidth="2.200" /></Icon>,
  prev: <Icon><path d="m10 3.500-5 4.500 5 4.500" /></Icon>,
  next: <Icon><path d="m6 3.500 5 4.500-5 4.500" /></Icon>,
  fullscreen: <Icon><path d="M2.500 6V2.500H6M10 2.500h3.500V6M13.500 10v3.500H10M6 13.500H2.500V10" /></Icon>,
  clock: <Icon><circle cx="8" cy="8" r="5.500" /><path d="M8 4.500V8l2.500 1.500" /></Icon>,
  motion: <Icon><circle cx="9.5" cy="8" r="3.5" /><path d="M1.5 5.5h3M.5 8h3M1.5 10.5h3" /></Icon>,
  animEntrance: <Icon><path d="M2 8h8M7 4.5 10.5 8 7 11.5M13.5 3v10" /></Icon>,
  animEmphasis: <Icon><path d="m8 2 1.8 3.800 4.200.6-3 3 .7 4.200L8 11.600 4.300 13.600l.7-4.200-3-3 4.200-.6z" /></Icon>,
  animExit: <Icon><path d="M2.500 3v10M5.500 8h8M10 4.500 13.500 8 10 11.500" /></Icon>,
  grip: <Icon><circle cx="6" cy="4" r=".7" fill="currentColor" /><circle cx="10" cy="4" r=".7" fill="currentColor" /><circle cx="6" cy="8" r=".7" fill="currentColor" /><circle cx="10" cy="8" r=".7" fill="currentColor" /><circle cx="6" cy="12" r=".7" fill="currentColor" /><circle cx="10" cy="12" r=".7" fill="currentColor" /></Icon>,
  edit: <Icon><path d="m10.500 2.500 3 3L5.500 13.500l-3.500.5.5-3.500z" /></Icon>,
};
