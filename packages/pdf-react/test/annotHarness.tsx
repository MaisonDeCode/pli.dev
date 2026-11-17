import { act } from "react";
import { beforeEach } from "vitest";
import { Users, memoryCommentStore } from "@pli.dev/core";
import type { PdfAnchor, PdfSession } from "@pli.dev/pdf";
import { PliPdf, type PliPdfProps } from "../src";
import { useAnnotationKit, type AnnotationKit, type AnnotationKitOptions } from "../src/useAnnotations";
import { CSS_UNITS, pageToScreen } from "../src/geometry";
import { fakeRenderer, testSession, type TestSessionOptions } from "../src/testing";
import { byLabel, click, fire, flush, host, q, qa, render, rotateView, useHost } from "./harness";

export { rotateView, byLabel, click, fire, flush, host, key, openProperties, q, qa, render, run, setValue, scrollTo } from "./harness";

/** jsdom has no modal dialogs; the editors' tests shim them the same way. */
export function useAnnotHost() {
  useHost();
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    try {
      localStorage.clear();
    } catch {
      // no storage
    }
  });
}

export const viewport = { width: 800, height: 600 };

export interface Mounted {
  session: PdfSession;
  kit: () => AnnotationKit;
  c: () => AnnotationKit["controller"];
  zoom: number;
}

let latest: AnnotationKit | null = null;

function Harness({ session, renderer, options, props }: { session: PdfSession; renderer: ReturnType<typeof fakeRenderer>; options: AnnotationKitOptions; props: Partial<PliPdfProps> }) {
  const kit = useAnnotationKit(session, options);
  latest = kit;
  return (
    <div style={{ display: "contents" }} {...kit.hostProps}>
      <PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={props.defaultZoom ?? 1} {...kit.props} {...props} tool={kit.props.tool} onToolChange={kit.props.onToolChange} />
    </div>
  );
}

export interface MountOptions {
  pages?: number;
  sessionOptions?: TestSessionOptions;
  zoom?: number;
  /** Quarter turns of the view (the rotate button pressed this many times). */
  turns?: number;
  kit?: AnnotationKitOptions;
  props?: Partial<PliPdfProps>;
  user?: { id: string; name?: string };
  session?: PdfSession;
}

/** The viewer with the annotation tools, on a test session with fake pages (612 by 792 points). */
export async function mount(o: MountOptions = {}): Promise<Mounted> {
  const session = o.session ?? testSession({ pages: o.pages ?? 3, ...o.sessionOptions });
  const renderer = fakeRenderer({ pages: o.pages ?? 3 });
  await render(<Harness session={session} renderer={renderer} options={{ storageKey: "t", user: o.user, ...o.kit }} props={{ defaultZoom: o.zoom ?? 1, ...o.props }} />);
  await flush();
  for (let i = 0; i < (o.turns ?? 0); i++) await rotateView();
  await flush();
  return { session, kit: () => latest!, c: () => latest!.controller, zoom: o.zoom ?? 1 };
}

/** Turns on comments with an in-memory store and some people. */
export function enableComments(session: PdfSession, me = { id: "u1", name: "Ana Reyes" }, role: "viewer" | "commenter" | "editor" = "editor") {
  const people = [me, { id: "u2", name: "Ben Okafor" }, { id: "u3", name: "Chi Tran" }];
  const users = new Users({ current: me, role, lookup: (ids) => people.filter((p) => ids.includes(p.id)), search: (q) => people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) });
  const store = memoryCommentStore<PdfAnchor>();
  const client = session.comments.enable({ users, store });
  return { client, users, store };
}

export const pageEl = (index = 0) => qa(".pli-pdf-page")[index]!;
export const layerOf = (index = 0) => pageEl(index).querySelector<HTMLElement>(".pli-pdf-interact")!;

/** Where a point of page space is on the screen of the page shown (rotation in degrees, zoom as a fraction). */
export function clientOf(x: number, y: number, rotation = 0, zoom = 1, width = 612, height = 792): [number, number] {
  return pageToScreen({ width, height, rotation, scale: zoom * CSS_UNITS }, x, y);
}

export interface PointerInit {
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export const pointer = async (el: Element, type: "pointerdown" | "pointermove" | "pointerup", at: [number, number], init: PointerInit = {}) => {
  await fire(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }));
};

/** A drag on the active tool's layer of a page, from one point of page space to another (with a move or two between). */
export async function drag(from: [number, number], to: [number, number], o: { page?: number; rotation?: number; zoom?: number; steps?: [number, number][]; init?: PointerInit } = {}) {
  const layer = layerOf(o.page ?? 0);
  const at = (p: [number, number]) => clientOf(p[0], p[1], o.rotation ?? 0, o.zoom ?? 1);
  await pointer(layer, "pointerdown", at(from), o.init);
  for (const step of o.steps ?? []) await pointer(layer, "pointermove", at(step), o.init);
  await pointer(layer, "pointermove", at(to), o.init);
  await pointer(layer, "pointerup", at(to), o.init);
}

export async function tap(p: [number, number], o: { page?: number; rotation?: number; zoom?: number; init?: PointerInit } = {}) {
  const layer = layerOf(o.page ?? 0);
  const at = clientOf(p[0], p[1], o.rotation ?? 0, o.zoom ?? 1);
  await pointer(layer, "pointerdown", at, o.init);
  await pointer(layer, "pointerup", at, o.init);
}

export const tool = (label: string) => click(byLabel(label, host));
/** Chooses a shape from the Shapes menu. */
export async function shape(label: string) {
  await click(byLabel("Shapes", host));
  const item = [...document.querySelectorAll<HTMLElement>("[role=menu] [role^=menuitem]")].find((el) => el.textContent!.startsWith(label));
  if (!item) throw new Error(`no shape ${label}`);
  await click(item);
}
export const annots = (session: PdfSession, page = 0) => session.doc.pages[page]!.annots;
export const round = (n: number) => Math.round(n * 100) / 100;
