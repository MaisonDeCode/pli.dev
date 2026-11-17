import type { ReactNode } from "react";
import type { FieldKind } from "./formsGeometry";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Icons of the form tools, one per kind of field, and a few for the form bar. */
export const FormIcons: Record<FieldKind | "form" | "prepare" | "order" | "duplicate" | "trash" | "clear" | "flatten" | "data" | "copy" | "highlight", ReactNode> = {
  text: <Icon><rect x="1.5" y="4.5" width="13" height="7" rx="1" /><path d="M4.500 6.500v3M7 8h3" /></Icon>,
  multiline: <Icon><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M4 5.500h8M4 8h8M4 10.500h4M11 12.500l1.500-1.500" /></Icon>,
  checkbox: <Icon><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="m5.2 8.2 2 2 3.6-4.2" /></Icon>,
  radio: <Icon><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" /></Icon>,
  dropdown: <Icon><rect x="1.5" y="4.5" width="13" height="7" rx="1" /><path d="M10.500 4.500v7M11.500 7.300 12.500 8.700l1-1.400" /><path d="M3.500 8h4" /></Icon>,
  list: <Icon><rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M4 5h5M4 11h5" /><rect x="3" y="6.500" width="10" height="3" rx=".6" fill="currentColor" fillOpacity=".25" /><path d="M4 8h6" /></Icon>,
  signature: <Icon><path d="M2 12.5h12" /><path d="M3.5 10c1.3-3.600 2.400-5.500 3.200-5.500.900 0 .100 3.700 1.100 3.700s1.300-2.500 2.300-2.500c.800 0 .200 2.200 1.200 2.200" /></Icon>,
  button: <Icon><rect x="1.5" y="4" width="13" height="8" rx="3" /><path d="M5 8h6" /></Icon>,
  form: <Icon><rect x="2.500" y="1.800" width="11" height="12.400" rx="1.300" /><path d="M5 5.200h6M5 8h6" /><rect x="5" y="10.200" width="3.600" height="1.800" rx=".4" /></Icon>,
  prepare: <Icon><rect x="2" y="1.800" width="9" height="12.400" rx="1.300" /><path d="M4.500 5.200h4M4.500 8h2.500" /><path d="m13.800 6.500-4.800 4.800-.4 2 2-.4 4.800-4.800z" /></Icon>,
  highlight: <Icon><rect x="2" y="4" width="12" height="8" rx="1.200" fill="currentColor" fillOpacity=".25" /><path d="M5 8h6" /></Icon>,
  order: <Icon><path d="M3 4.500h2M3 8h2M3 11.500h2" /><path d="M7.500 4.500h6M7.500 8h6M7.500 11.500h6" /></Icon>,
  duplicate: <Icon><rect x="5" y="5" width="8.500" height="8.500" rx="1.200" /><path d="M3.500 10.500V3.700a1.200 1.200 0 0 1 1.200-1.200h6.800" /></Icon>,
  trash: <Icon><path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500" /></Icon>,
  clear: <Icon><path d="M3 3h8M7 3 5 13M9.500 8.500l4 4M13.500 8.500l-4 4" /></Icon>,
  flatten: <Icon><path d="M2 5.500 8 2.500l6 3-6 3z" /><path d="m2 8.500 6 3 6-3M2 11.500l6 3 6-3" /></Icon>,
  data: <Icon><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.100 2.200 2 5 2s5-.900 5-2V4M3 8c0 1.100 2.200 2 5 2s5-.900 5-2" /></Icon>,
  copy: <Icon><rect x="5" y="5" width="8.500" height="8.500" rx="1.200" /></Icon>,
};
