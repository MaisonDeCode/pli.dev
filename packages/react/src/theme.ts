import { createContext, createElement, forwardRef, useContext, type HTMLAttributes } from "react";

/**
 * The look of an editor: `"light"`, `"dark"`, or `"auto"` (the default), which follows `data-theme="light" | "dark"` on `<html>` if
 * your page sets it, and otherwise the system's setting. Pass the same value your app uses so the editor matches it.
 */
export type PliTheme = "auto" | "light" | "dark";

/** The theme an editor was forced to (`undefined` while it is on `"auto"`). Menus and dialogs that open outside the editor read it. */
export const ThemeContext = createContext<"light" | "dark" | undefined>(undefined);

/** The `data-theme` value for an editor's root: only a forced theme is written, `"auto"` leaves the attribute off. */
export function forcedTheme(theme: PliTheme | undefined): "light" | "dark" | undefined {
  return theme === "light" || theme === "dark" ? theme : undefined;
}

/**
 * The attribute for a menu, dialog or card that is drawn outside the editor's own element (in `document.body`), where the editor's
 * `data-theme` does not reach. Spread it on that element: `<div {...useThemeAttr()} />`.
 */
export function useThemeAttr(): { "data-theme"?: "light" | "dark" } {
  const theme = useContext(ThemeContext);
  return theme ? { "data-theme": theme } : {};
}

/** A `<div>` for a menu, card or panel that is drawn in `document.body`: it carries the editor's forced theme (see `useThemeAttr`). */
export const ThemedDiv = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ThemedDiv(props, ref) {
  return createElement("div", { ...useThemeAttr(), ...props, ref });
});
