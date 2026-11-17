import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_SETS, iconSvg } from "@pli.dev/sheets";
import { CfIcon } from "../src/icons";

/** The icons a copy writes into the HTML are the ones the grid draws. */
describe("icon sets in copied HTML", () => {
  it("draw the same pictures as the grid", () => {
    const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/<\/(path|circle|rect)>/g, "").replace(/\/>/g, ">").replace(/>$/, "");
    const norm = (s: string) => s.replace(/<(path|circle|rect)\b([^>]*?)\/?>/g, "<$1$2/>").replace(/<\/(path|circle|rect)>/g, "");
    let n = 0;
    for (const [set, count] of Object.entries(ICON_SETS) as [keyof typeof ICON_SETS, number][]) {
      for (let i = 0; i < count; i++) {
        const react = renderToStaticMarkup(createElement(CfIcon, { set, index: i, count }));
        expect(norm(inner(react))).toBe(norm(inner(iconSvg(set, i, count))));
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });
});
