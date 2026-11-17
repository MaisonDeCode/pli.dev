import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { beforeEach } from "vitest";
import { openPdf, type PdfSession } from "@pli.dev/pdf";
import { PliPdf, type PliPdfProps } from "../src";
import { useFormsKit, type FormsKit, type FormsKitOptions } from "../src/useForms";
import { CSS_UNITS, pageToScreen } from "../src/geometry";
import { fakeRenderer } from "../src/testing";
import { byLabel, click, fire, flush, host, q, qa, render, rotateView, useHost } from "./harness";

export { menuButton, togglePrepareForm, chooseMenu, rotateView, byLabel, click, fire, flush, host, key, openProperties, q, qa, render, run, setValue } from "./harness";

export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(__dirname, `../../pdf/test/fixtures/${name}.pdf`)));

/** jsdom has no modal dialogs; the editors' tests shim them the same way. */
export function useFormsHost() {
  useHost();
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });
}

export const viewport = { width: 800, height: 600 };

let latest: FormsKit | null = null;

function Harness({ session, renderer, options, props }: { session: PdfSession; renderer: ReturnType<typeof fakeRenderer>; options: FormsKitOptions; props: Partial<PliPdfProps> }) {
  const kit = useFormsKit(session, options);
  latest = kit;
  return (
    <div style={{ display: "contents" }} {...kit.hostProps}>
      <PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={props.defaultZoom ?? 1} {...kit.props} {...props} />
    </div>
  );
}

export interface MountOptions {
  file?: string;
  session?: PdfSession;
  /** Page size (points) of the fake renderer; the fixtures are 300 by 400 and 300 by 300. */
  pages?: { width: number; height: number }[];
  zoom?: number;
  /** Quarter turns of the view. */
  turns?: number;
  kit?: FormsKitOptions;
  props?: Partial<PliPdfProps>;
}

export interface Mounted {
  session: PdfSession;
  c: () => FormsKit["controller"];
  kit: () => FormsKit;
  zoom: number;
}

/** The viewer with the form tools on a fixture (`forms-basic` by default). */
export async function mount(o: MountOptions = {}): Promise<Mounted> {
  const session = o.session ?? (await openPdf(fixture(o.file ?? "forms-basic")));
  const pages = o.pages ?? session.doc.pages.map((p) => ({ width: p.width, height: p.height }));
  const renderer = fakeRenderer({ pages });
  await render(<Harness session={session} renderer={renderer} options={o.kit ?? {}} props={{ defaultZoom: o.zoom ?? 1, ...o.props }} />);
  await flush();
  for (let i = 0; i < (o.turns ?? 0); i++) await rotateView();
  await flush();
  return { session, kit: () => latest!, c: () => latest!.controller, zoom: o.zoom ?? 1 };
}

// ---- finding things --------------------------------------------------------------------------------------------

/** The widget element of a field by its name (the nth button of a radio group). */
export const widget = (field: string, nth = 0): HTMLElement => {
  const id = latest?.controller.session.forms.byName(field)?.id ?? `f:${field}`;
  return [...document.querySelectorAll<HTMLElement>(`.pli-form-widget[data-field-id="${id}"]`)][nth]!;
};
/** The control (input, textarea, select, button) of a field's widget. */
export const control = <T extends HTMLElement = HTMLInputElement>(field: string, nth = 0): T => widget(field, nth).querySelector<T>("[data-control]")!;

export async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
  });
  // One character at a time, as a person types: each is an edit of its own that joins the same undo step.
  let value = el.value;
  for (const ch of text) {
    value += ch;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

export async function replaceText(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function choose(el: HTMLSelectElement, values: string[]) {
  await act(async () => {
    for (const o of el.options) o.selected = values.includes(o.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export async function focus(el: HTMLElement) {
  await act(async () => el.focus());
}
export async function blur(el: HTMLElement) {
  await act(async () => el.blur());
}
export async function press(el: Element, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

// ---- pointer ---------------------------------------------------------------------------------------------------

export const pageEl = (index = 0) => qa(".pli-pdf-page")[index]!;
export const layerOf = (index = 0) => pageEl(index).querySelector<HTMLElement>(".pli-pdf-interact")!;

/** Where a point of page space is on the screen of the page shown (rotation in degrees, zoom as a fraction). */
export function clientOf(x: number, y: number, rotation = 0, zoom = 1, width = 300, height = 400): [number, number] {
  return pageToScreen({ width, height, rotation, scale: zoom * CSS_UNITS }, x, y);
}

export interface PointerInit {
  shiftKey?: boolean;
  altKey?: boolean;
}

export const pointer = async (el: Element, type: "pointerdown" | "pointermove" | "pointerup", at: [number, number], init: PointerInit = {}) => {
  await fire(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }));
};

export interface Gesture {
  page?: number;
  rotation?: number;
  zoom?: number;
  width?: number;
  height?: number;
  init?: PointerInit;
}

/** A drag on the active tool's layer, from one point of page space to another. */
export async function drag(from: [number, number], to: [number, number], o: Gesture = {}) {
  const layer = layerOf(o.page ?? 0);
  const at = (p: [number, number]) => clientOf(p[0], p[1], o.rotation ?? 0, o.zoom ?? 1, o.width, o.height);
  await pointer(layer, "pointerdown", at(from), o.init);
  await pointer(layer, "pointermove", at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), o.init);
  await pointer(layer, "pointermove", at(to), o.init);
  await pointer(layer, "pointerup", at(to), o.init);
}

export async function tap(p: [number, number], o: Gesture = {}) {
  const layer = layerOf(o.page ?? 0);
  const at = clientOf(p[0], p[1], o.rotation ?? 0, o.zoom ?? 1, o.width, o.height);
  await pointer(layer, "pointerdown", at, o.init);
  await pointer(layer, "pointerup", at, o.init);
}

/** A drag that starts on an element (a design frame or handle) rather than on the tool's layer. */
export async function dragOn(el: Element, from: [number, number], to: [number, number], o: Gesture = {}) {
  const at = (p: [number, number]) => clientOf(p[0], p[1], o.rotation ?? 0, o.zoom ?? 1, o.width, o.height);
  await pointer(el, "pointerdown", at(from), o.init);
  await pointer(el, "pointermove", at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), o.init);
  await pointer(el, "pointermove", at(to), o.init);
  await pointer(el, "pointerup", at(to), o.init);
}

export const toolButton = (label: string) => document.querySelector<HTMLElement>(`.pli-pdf-designbar [aria-label="${label}"]`)!;

export const round = (n: number) => Math.round(n * 100) / 100;
export const rectOf = (session: PdfSession, name: string, nth = 0) => {
  const r = session.forms.byName(name)!.widgets[nth]!.rect;
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
};

