import { LIGHT_THEME, buildMaster, newId, shape, type MasterSpec } from "./build";
import type { Align, Color, Element, Fill, LayoutKind, Master, ShapeElement, SlideSize, Theme, ThemeColor, ThemeSlot } from "./model";
import { placeholderFamily } from "./resolve";

/*
 * Built-in themes: twelve original colour schemes with their own fonts, backgrounds and decorations, each as a master
 * with the nine standard layouts. In Pli's model `dk1` is always the text colour and `lt1` the slide background, so a
 * dark theme has a light `dk1` and a dark `lt1`; every text/background pair below is checked for contrast in the tests.
 * Decorations are drawn from the slide's size, so they scale to widescreen, Google's 16:9 and 4:3.
 */

export interface BuiltinTheme {
  id: string;
  name: string;
  /** The colours and fonts, for showing swatches without building a master. */
  theme: Theme;
  /** A fresh master (new ids every time) for a slide size. */
  build(size: SlideSize): Master;
}

// ---- Small helpers -----------------------------------------------------------------------------------------------

const c = (theme: ThemeSlot, mods: Omit<ThemeColor, "theme"> = {}): ThemeColor => ({ theme, ...mods });

const rect = (name: string, x: number, y: number, w: number, h: number, fill: Fill, extra: Partial<ShapeElement> = {}): ShapeElement =>
  shape("rect", { x, y, w, h }, { name, fill, line: null, ...extra });

const oval = (name: string, x: number, y: number, w: number, h: number, fill: Fill): ShapeElement => shape("ellipse", { x, y, w, h }, { name, fill, line: null });

const linear = (angle: number, from: Color, to: Color): Fill => ({ gradient: { kind: "linear", angle, stops: [{ at: 0, color: from }, { at: 1, color: to }] } });

/** The layouts whose title sits in the standard place at the top. */
const CONTENT_KINDS: LayoutKind[] = ["titleAndBody", "titleAndTwoColumns", "titleOnly"];
const forContent = (fn: (size: SlideSize) => Element[]): Partial<Record<LayoutKind, (size: SlideSize) => Element[]>> => Object.fromEntries(CONTENT_KINDS.map((k) => [k, fn]));

const scale = (size: SlideSize) => size.width / 720;

/** Where the title slide's title ends and its subtitle begins (the gap between them is 12 points, scaled). */
const titleGap = (size: SlideSize) => size.height * 0.24 + 104 * scale(size);
const sectionTop = (size: SlideSize) => size.height * 0.3;

/** Centres the text of the placeholders of some layouts. */
function alignLayouts(master: Master, kinds: LayoutKind[], align: Align): void {
  for (const layout of master.layouts) {
    if (!layout.kind || !kinds.includes(layout.kind)) continue;
    for (const e of layout.elements) {
      if (e.type !== "shape" || !e.placeholder || !e.text) continue;
      const levels = e.text.levels ?? {};
      e.text = { ...e.text, levels: { ...levels, 0: { ...levels[0], align } } };
    }
  }
}

interface Inversion {
  background: Fill;
  /** Title (and the like) colour. */
  text: Color;
  /** Subtitle, date, footer and slide number colour. */
  muted: Color;
  /** Keep the master's decorations. Default: they are hidden. */
  keepMaster?: boolean;
}

/** Turns a layout into one with its own background and text colours (a dark section header in a light theme). */
function recolorLayout(master: Master, kind: LayoutKind, o: Inversion): void {
  const layout = master.layouts.find((l) => l.kind === kind);
  if (!layout) return;
  layout.background = o.background;
  if (!o.keepMaster) layout.showMasterElements = false;
  for (const e of layout.elements) {
    if (e.type !== "shape" || !e.placeholder || !e.text) continue;
    const levels = e.text.levels ?? {};
    const color = placeholderFamily(e.placeholder.type) === "title" ? o.text : o.muted;
    const l0 = levels[0] ?? {};
    e.text = { ...e.text, levels: { ...levels, 0: { ...l0, marks: { ...l0.marks, color } } } };
  }
  // The footers are the master's placeholders; a layout that changes the colours needs its own so that they stay readable.
  for (const m of master.elements) {
    if (m.type !== "shape" || !m.placeholder || !["dt", "ftr", "sldNum"].includes(m.placeholder.type)) continue;
    const l0 = m.text?.levels?.[0] ?? {};
    layout.elements.push({
      type: "shape",
      id: newId("e_"),
      geometry: "rect",
      placeholder: { ...m.placeholder },
      text: { paragraphs: [{ runs: [] }], levels: { 0: { ...l0, marks: { ...l0.marks, color: o.muted } } } },
    });
  }
}

type SpecFn = (size: SlideSize) => Omit<MasterSpec, "size">;

interface Def {
  id: string;
  theme: Theme;
  spec: SpecFn;
}

const colors = (
  dk1: string, lt1: string, dk2: string, lt2: string,
  accents: [string, string, string, string, string, string],
  hlink: string, folHlink: string,
): Theme["colors"] => ({ dk1, lt1, dk2, lt2, accent1: accents[0], accent2: accents[1], accent3: accents[2], accent4: accents[3], accent5: accents[4], accent6: accents[5], hlink, folHlink });

const THEMES: Def[] = [
  // ---- Simple Light: no ornament, the Google look ----
  {
    id: "simple-light",
    theme: LIGHT_THEME,
    spec: () => ({ name: "Simple Light", theme: LIGHT_THEME }),
  },

  // ---- Simple Dark ----
  (() => {
    const theme: Theme = {
      name: "Simple Dark",
      colors: colors("#f5f5f5", "#1e1e1e", "#bdbdbd", "#2c2c2c", ["#8ab4f8", "#f28b82", "#fdd663", "#81c995", "#fcad70", "#78d9ec"], "#8ab4f8", "#c58af9"),
      fonts: { major: "Arial", minor: "Arial" },
    };
    return { id: "simple-dark", theme, spec: () => ({ name: theme.name, theme }) } satisfies Def;
  })(),

  // ---- Paperwhite: warm paper, serif headings, thin rules ----
  (() => {
    const theme: Theme = {
      name: "Paperwhite",
      colors: colors("#2b2b2b", "#fbf8f1", "#5c5348", "#efe9db", ["#b5523b", "#3d6b7d", "#a67c00", "#5f7f4f", "#8a5a83", "#c0702b"], "#8a3b1f", "#6b4b6b"),
      fonts: { major: "Georgia", minor: "Arial" },
    };
    return {
      id: "paperwhite",
      theme,
      spec: (size) => {
        const k = scale(size);
        const m = 36 * k;
        return {
          name: theme.name,
          theme,
          titleSize: 34,
          bodySize: 16,
          bulletChars: ["•", "–", "▪"],
          bulletColor: c("accent1"),
          decorations: (s) => [rect("Footer rule", m, s.height - 36 * k, s.width - 2 * m, 0.75, c("dk2", { alpha: 0.35 }))],
          layoutDecorations: {
            ...forContent(() => [rect("Title rule", m, 90 * k, 40 * k, 2.5 * k, c("accent1"))]),
            title: (s) => [rect("Title rule", m, titleGap(s), 64 * k, 3 * k, c("accent1"))],
            sectionHeader: (s) => [rect("Section rule", m, sectionTop(s) - 14 * k, 48 * k, 3 * k, c("accent1"))],
          },
        };
      },
    } satisfies Def;
  })(),

  // ---- Midnight: deep blue gradient, glowing circles ----
  (() => {
    const theme: Theme = {
      name: "Midnight",
      colors: colors("#f2f5fa", "#0b1d3a", "#b8c4d9", "#14305c", ["#5ac8fa", "#ff8a65", "#ffd54f", "#7bd88f", "#b388ff", "#4dd0e1"], "#8fd3ff", "#d1b3ff"),
      fonts: { major: "Trebuchet MS", minor: "Trebuchet MS" },
    };
    return {
      id: "midnight",
      theme,
      spec: (size) => {
        const k = scale(size);
        return {
          name: theme.name,
          theme,
          titleSize: 34,
          titleBold: true,
          background: linear(90, c("lt1"), c("lt2")),
          bulletColor: c("accent1"),
          decorations: (s) => [
            oval("Glow", s.width - 130 * k, -90 * k, 220 * k, 220 * k, c("accent1", { alpha: 0.14 })),
            oval("Glow small", -50 * k, s.height - 70 * k, 120 * k, 120 * k, c("accent5", { alpha: 0.14 })),
            rect("Edge", 0, s.height - 4 * k, s.width, 4 * k, c("accent1")),
          ],
          layoutDecorations: {
            title: (s) => [rect("Title rule", s.width / 2 - 30 * k, titleGap(s), 60 * k, 3 * k, c("accent1"))],
            sectionHeader: (s) => [rect("Section bar", 0, sectionTop(s), 8 * k, 80 * k, c("accent1"))],
          },
          tweak: (master) => alignLayouts(master, ["title"], "center"),
        };
      },
    } satisfies Def;
  })(),

  // ---- Coral: cream with a coral edge and a low sun ----
  (() => {
    const theme: Theme = {
      name: "Coral",
      colors: colors("#2d2433", "#fff6f1", "#6b4f5e", "#fde6dc", ["#d9482f", "#e08a1e", "#2a9d8f", "#3a6ea5", "#8e5fa8", "#d1456b"], "#b3341f", "#7a4a8a"),
      fonts: { major: "Trebuchet MS", minor: "Arial" },
    };
    return {
      id: "coral",
      theme,
      spec: (size) => {
        const k = scale(size);
        return {
          name: theme.name,
          theme,
          titleBold: true,
          bulletColor: c("accent1"),
          decorations: (s) => [oval("Sun", s.width - 64 * k, s.height - 64 * k, 128 * k, 128 * k, c("accent2", { alpha: 0.4 })), rect("Edge", 0, 0, 12 * k, s.height, c("accent1"))],
          layoutDecorations: {
            title: (s) => [oval("Big sun", s.width - 150 * k, -100 * k, 190 * k, 190 * k, c("accent1")), oval("Small sun", s.width - 205 * k, 14 * k, 44 * k, 44 * k, c("accent2"))],
            sectionHeader: (s) => [rect("Section bar", 36 * k, sectionTop(s) - 14 * k, 56 * k, 4 * k, c("accent1"))],
          },
        };
      },
    } satisfies Def;
  })(),

  // ---- Forest: soft green, serif titles in forest green ----
  (() => {
    const theme: Theme = {
      name: "Forest",
      colors: colors("#1d2b22", "#f3f7f1", "#4a5d50", "#e1ebdd", ["#2f6b46", "#6f7f2a", "#a85f14", "#2c7a8c", "#7a5c3e", "#a84e44"], "#1f6f8b", "#6b4f7a"),
      fonts: { major: "Georgia", minor: "Verdana" },
    };
    return {
      id: "forest",
      theme,
      spec: (size) => {
        const k = scale(size);
        return {
          name: theme.name,
          theme,
          titleSize: 34,
          bodySize: 15,
          titleColor: c("accent1"),
          bulletColor: c("accent1"),
          decorations: (s) => [rect("Top band", 0, 0, s.width, 8 * k, c("accent1"))],
          layoutDecorations: {
            title: (s) => [rect("Side bar", 0, 8 * k, 18 * k, s.height - 8 * k, c("accent4")), rect("Title rule", 36 * k, titleGap(s), 72 * k, 3 * k, c("accent2"))],
          },
          tweak: (master) => recolorLayout(master, "sectionHeader", { background: c("accent1"), text: c("lt1"), muted: c("lt2") }),
        };
      },
    } satisfies Def;
  })(),

  // ---- Slate: calm corporate grey-blue, bold sans titles ----
  (() => {
    const theme: Theme = {
      name: "Slate",
      colors: colors("#1f2933", "#f5f7fa", "#52606d", "#e4e7eb", ["#486581", "#c53030", "#a96a11", "#2f855a", "#2b6cb0", "#6b46c1"], "#2b6cb0", "#6b46c1"),
      fonts: { major: "Arial", minor: "Arial" },
    };
    return {
      id: "slate",
      theme,
      spec: (size) => {
        const k = scale(size);
        const m = 36 * k;
        return {
          name: theme.name,
          theme,
          titleSize: 30,
          titleBold: true,
          bulletColor: c("accent1"),
          decorations: (s) => [rect("Top bar", 0, 0, s.width, 6 * k, c("accent1"))],
          layoutDecorations: {
            ...forContent(() => [rect("Marker", 20 * k, 26 * k, 5 * k, 36 * k, c("accent2"))]),
            title: (s) => [rect("Rule", m, titleGap(s), s.width - 2 * m, 1.5 * k, c("dk2", { alpha: 0.5 }))],
          },
          tweak: (master) => recolorLayout(master, "sectionHeader", { background: c("accent1"), text: c("lt1"), muted: c("lt2") }),
        };
      },
    } satisfies Def;
  })(),

  // ---- Sunrise: cream slides, a sunrise gradient on the title slide ----
  (() => {
    const theme: Theme = {
      name: "Sunrise",
      colors: colors("#3b2a2a", "#fffaf0", "#7a5148", "#fdebd0", ["#c2410c", "#9f1239", "#b45309", "#0f766e", "#7c3aed", "#be185d"], "#9a3412", "#6d28d9"),
      fonts: { major: "Trebuchet MS", minor: "Verdana" },
    };
    return {
      id: "sunrise",
      theme,
      spec: (size) => {
        const k = scale(size);
        return {
          name: theme.name,
          theme,
          titleBold: true,
          bodySize: 15,
          titleColor: c("accent1"),
          bulletColor: c("accent3"),
          decorations: (s) => [rect("Sunrise band", 0, s.height - 6 * k, s.width, 6 * k, linear(0, c("accent3"), c("accent2")))],
          layoutDecorations: {
            title: (s) => [oval("Sun", s.width * 0.6, s.height * 0.3, s.width * 0.7, s.width * 0.7, c("dk1", { alpha: 0.15 }))],
          },
          tweak: (master) => {
            recolorLayout(master, "title", { background: linear(45, c("accent1"), c("accent2")), text: c("lt1"), muted: c("lt1"), keepMaster: false });
            recolorLayout(master, "sectionHeader", { background: c("accent4"), text: c("lt1"), muted: c("lt2") });
          },
        };
      },
    } satisfies Def;
  })(),

  // ---- Mono: black and white, a mono face for headings ----
  (() => {
    const theme: Theme = {
      name: "Mono",
      colors: colors("#111111", "#ffffff", "#555555", "#f0f0f0", ["#111111", "#d62828", "#1d4ed8", "#777777", "#999999", "#bbbbbb"], "#0033cc", "#551a8b"),
      fonts: { major: "Courier New", minor: "Arial" },
    };
    return {
      id: "mono",
      theme,
      spec: (size) => {
        const k = scale(size);
        const m = 36 * k;
        return {
          name: theme.name,
          theme,
          titleSize: 30,
          titleBold: true,
          bulletChars: ["■", "□", "–"],
          decorations: (s) => [rect("Top rule", m, 12 * k, s.width - 2 * m, 3 * k, c("dk1"))],
          layoutDecorations: {
            title: (s) => [rect("Title rule", m, titleGap(s), 80 * k, 4 * k, c("accent2"))],
          },
          tweak: (master) => recolorLayout(master, "sectionHeader", { background: c("dk1"), text: c("lt1"), muted: c("lt2") }),
        };
      },
    } satisfies Def;
  })(),

  // ---- Ocean: pale blue-green with a wave of colour at the top ----
  (() => {
    const theme: Theme = {
      name: "Ocean",
      colors: colors("#0b2e3b", "#f2f9fb", "#2f5666", "#dcecf1", ["#0e7490", "#0369a1", "#0d9488", "#b45309", "#be123c", "#4f46e5"], "#0369a1", "#5b21b6"),
      fonts: { major: "Verdana", minor: "Verdana" },
    };
    return {
      id: "ocean",
      theme,
      spec: (size) => {
        const k = scale(size);
        return {
          name: theme.name,
          theme,
          titleSize: 30,
          bodySize: 15,
          titleBold: true,
          titleColor: c("accent1"),
          bulletColor: c("accent3"),
          decorations: (s) => [
            rect("Top wave", 0, 0, s.width, 10 * k, linear(0, c("accent1"), c("accent3"))),
            oval("Bubble", s.width - 70 * k, s.height - 70 * k, 110 * k, 110 * k, c("accent1", { alpha: 0.12 })),
            oval("Bubble small", s.width - 120 * k, s.height - 40 * k, 70 * k, 70 * k, c("accent2", { alpha: 0.12 })),
          ],
          tweak: (master) => {
            recolorLayout(master, "title", { background: linear(60, c("accent1"), c("accent2")), text: c("lt1"), muted: c("lt1") });
            recolorLayout(master, "sectionHeader", { background: c("accent2"), text: c("lt1"), muted: c("lt1") });
          },
        };
      },
    } satisfies Def;
  })(),

  // ---- Plum: lilac paper, a plum spine and a diamond ----
  (() => {
    const theme: Theme = {
      name: "Plum",
      colors: colors("#2a1a33", "#faf5fb", "#6b4d7a", "#efe3f3", ["#6a2c8c", "#b8326d", "#a8680f", "#2f7f76", "#4338ca", "#a0522d"], "#5b2a9a", "#8a3b6b"),
      fonts: { major: "Georgia", minor: "Trebuchet MS" },
    };
    return {
      id: "plum",
      theme,
      spec: (size) => {
        const k = scale(size);
        return {
          name: theme.name,
          theme,
          titleSize: 34,
          titleColor: c("accent1"),
          bulletColor: c("accent2"),
          decorations: (s) => [rect("Spine", 0, 0, 10 * k, s.height, c("accent1")), shape("diamond", { x: s.width - 30 * k, y: 30 * k, w: 16 * k, h: 16 * k }, { name: "Ornament", fill: c("accent2"), line: null })],
          layoutDecorations: {
            title: (s) => [rect("Title rule", s.width / 2 - 40 * k, titleGap(s), 80 * k, 3 * k, c("accent3", { lumMod: 1.4 }))],
          },
          tweak: (master) => {
            recolorLayout(master, "title", { background: c("accent1"), text: c("lt1"), muted: c("lt2") });
            alignLayouts(master, ["title"], "center");
            recolorLayout(master, "sectionHeader", { background: c("lt2"), text: c("accent1"), muted: c("dk2"), keepMaster: true });
          },
        };
      },
    } satisfies Def;
  })(),

  // ---- Chalk: chalkboard green, cream chalk, a dashed frame ----
  (() => {
    const theme: Theme = {
      name: "Chalk",
      colors: colors("#f4f1e8", "#24332e", "#c8d0c6", "#33463f", ["#f2c14e", "#e8836a", "#81b29a", "#7fb1e0", "#c9a0dc", "#f4a6b7"], "#9fd0ff", "#d9b3ff"),
      fonts: { major: "Times New Roman", minor: "Arial" },
    };
    return {
      id: "chalk",
      theme,
      spec: (size) => {
        const k = scale(size);
        const m = 36 * k;
        return {
          name: theme.name,
          theme,
          titleSize: 36,
          bulletChars: ["✦", "•", "▪"],
          bulletColor: c("accent1"),
          decorations: (s) => [shape("rect", { x: 10 * k, y: 10 * k, w: s.width - 20 * k, h: s.height - 20 * k }, { name: "Frame", fill: null, line: { color: c("dk2", { alpha: 0.5 }), width: 1.2, dash: "dash" } })],
          layoutDecorations: {
            ...forContent(() => [rect("Title rule", m, 90 * k, 36 * k, 3 * k, c("accent1"))]),
            title: (s) => [rect("Title rule", s.width / 2 - 50 * k, titleGap(s), 100 * k, 3 * k, c("accent1"))],
            sectionHeader: (s) => [rect("Section rule", m, sectionTop(s) - 16 * k, 50 * k, 3 * k, c("accent1"))],
          },
          tweak: (master) => alignLayouts(master, ["title"], "center"),
        };
      },
    } satisfies Def;
  })(),
];

/** The built-in themes, in the order a gallery shows them. */
export const BUILTIN_THEMES: BuiltinTheme[] = THEMES.map((d) => ({
  id: d.id,
  name: d.theme.name,
  theme: d.theme,
  build(size: SlideSize): Master {
    const theme: Theme = { ...d.theme, colors: { ...d.theme.colors }, fonts: { ...d.theme.fonts } };
    const spec = d.spec(size);
    return buildMaster({ ...spec, theme, size });
  },
}));

/** A fresh master for a built-in theme (Simple Light for an id that isn't one). */
export function builtinTheme(id: string, size: SlideSize): Master {
  return (BUILTIN_THEMES.find((t) => t.id === id) ?? BUILTIN_THEMES[0]!).build(size);
}
