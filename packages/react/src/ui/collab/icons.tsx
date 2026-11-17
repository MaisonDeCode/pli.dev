import type { ReactNode } from "react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Icons of the shared interface. Each is distinct at 18px and takes the colour of its text. */
export const CollabIcons = {
  lock: <Icon><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></Icon>,
  globe: <Icon><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2 3 4.4 3 7s-1 5-3 7c-2-2-3-4.4-3-7s1-5 3-7z" /></Icon>,
  link: <Icon><path d="M8.5 11.5a3.2 3.2 0 0 0 4.5 0l2.3-2.3a3.2 3.2 0 0 0-4.5-4.5L9.8 5.6" /><path d="M11.5 8.5a3.2 3.2 0 0 0-4.5 0L4.7 10.8a3.2 3.2 0 0 0 4.5 4.5l1-1" /></Icon>,
  personAdd: <Icon><circle cx="8" cy="7" r="3" /><path d="M2.5 16.5c.4-2.8 2.6-4.5 5.5-4.5s5.1 1.7 5.5 4.5" /><path d="M16 6v5M13.5 8.5h5" /></Icon>,
  people: <Icon><circle cx="7.5" cy="7" r="2.7" /><path d="M2.5 16c.4-2.6 2.4-4.2 5-4.2s4.6 1.6 5 4.2" /><circle cx="14" cy="7.8" r="2.1" /><path d="M14.2 12c2 .2 3.3 1.6 3.6 3.6" /></Icon>,
  history: <Icon><path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" /><path d="M3 3.5v3h3" /><path d="M10 6.5V10l2.5 1.5" /></Icon>,
  restore: <Icon><path d="M4 10a6 6 0 1 1 1.8 4.3" /><path d="M4 5v4h4" /></Icon>,
  bell: <Icon><path d="M5 14.5V9a5 5 0 0 1 10 0v5.5l1.2 1.5H3.8z" /><path d="M8.3 17.5a1.9 1.9 0 0 0 3.4 0" /></Icon>,
  check: <Icon><path d="m4.5 10.5 3.5 3.5 7.5-8" /></Icon>,
  cloudDone: <Icon><path d="M6 15.5a3.5 3.5 0 0 1-.6-6.9A4.8 4.8 0 0 1 14.7 8a3.8 3.8 0 0 1-.7 7.5z" /><path d="m7.8 11.2 1.6 1.6 3-3.2" /></Icon>,
  cloudSync: <Icon><path d="M6 15.5a3.5 3.5 0 0 1-.6-6.9A4.8 4.8 0 0 1 14.7 8a3.8 3.8 0 0 1-.7 7.5z" /><path d="M8 11.5a2.2 2.2 0 0 1 3.8-.8M12 12.5a2.2 2.2 0 0 1-3.8.8" /></Icon>,
  cloudOff: <Icon><path d="M6 15.5a3.5 3.5 0 0 1-.6-6.9c.2-.6.5-1.1.9-1.6M10.5 4.5a4.8 4.8 0 0 1 4.2 3.5 3.8 3.8 0 0 1 1.8 6.3" /><path d="M3 3l14 14" /></Icon>,
  close: <Icon><path d="m5 5 10 10M15 5 5 15" /></Icon>,
  chevronDown: <Icon><path d="m5.5 8 4.5 4.5L14.5 8" /></Icon>,
  comment: <Icon><path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9.5L6 17v-3H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" /></Icon>,
  resolve: <Icon><circle cx="10" cy="10" r="7" /><path d="m6.8 10.3 2.2 2.2 4.2-4.5" /></Icon>,
  activity: <Icon><path d="M2.5 10h3l2-5.5 3.5 11 2.2-5.5h4.3" /></Icon>,
  edit: <Icon><path d="m12.5 4.5 3 3L7 16H4v-3z" /></Icon>,
  trash: <Icon><path d="M4.5 6h11M8 6V4.2h4V6M6 6l.6 10h6.8L14 6" /></Icon>,
};
