import { useMemo, useState, useSyncExternalStore } from "react";
import { SheetSession, createWorkbook, type SheetSessionOptions, type Workbook } from "@pli.dev/sheets";

const revisions = new WeakMap<SheetSession, number>();

/** Re-renders when the workbook changes and returns a number that changes each time. */
export function useSheetRevision(session: SheetSession): number {
  const subscribe = useMemo(
    () => (onChange: () => void) =>
      session.subscribe(() => {
        revisions.set(session, (revisions.get(session) ?? 0) + 1);
        onChange();
      }),
    [session],
  );
  const read = () => revisions.get(session) ?? 0;
  return useSyncExternalStore(subscribe, read, read);
}

/** Creates a session once and keeps it for the life of the component. */
export function useSheetSession(initial?: Workbook | (() => Workbook), options?: SheetSessionOptions): SheetSession {
  const [session] = useState(() => new SheetSession(typeof initial === "function" ? initial() : (initial ?? createWorkbook()), options));
  return session;
}
