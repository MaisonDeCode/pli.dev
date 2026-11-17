import { useMemo } from "react";
import { chartScene, pathData, type ChartItem, type ChartPaint, type ChartStroke, type ResolvedElement, type Theme } from "@pli.dev/decks";
import { fontStack } from "./paint";

const fillOf = (p: ChartPaint | undefined) => ({ fill: p ? p.color : "none", fillOpacity: p && p.alpha < 1 ? p.alpha : undefined });
const strokeOf = (s: ChartStroke | undefined) =>
  s
    ? { stroke: s.color, strokeOpacity: s.alpha < 1 ? s.alpha : undefined, strokeWidth: s.width, strokeDasharray: s.dash?.join(" "), strokeLinecap: s.cap, strokeLinejoin: s.join }
    : {};

function Item({ it, font }: { it: ChartItem; font: string }) {
  switch (it.kind) {
    case "rect":
      return <rect x={it.x} y={it.y} width={it.w} height={it.h} data-part={it.part} {...fillOf(it.fill)} {...strokeOf(it.stroke)} />;
    case "path":
      return <path d={pathData(it.d)} data-part={it.part} {...fillOf(it.fill)} {...strokeOf(it.stroke)} />;
    case "line":
      return <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} data-part={it.part} {...strokeOf(it.stroke)} />;
    default:
      return (
        <text
          x={it.x}
          y={it.y}
          data-part={it.part}
          fontFamily={font}
          fontSize={it.size}
          fontWeight={it.bold ? 700 : undefined}
          fill={it.color}
          fillOpacity={it.alpha < 1 ? it.alpha : undefined}
          textAnchor={it.anchor}
          transform={it.rotate ? `rotate(${it.rotate} ${it.x} ${it.y})` : undefined}
          style={{ userSelect: "none" }}
        >
          {it.text}
        </text>
      );
  }
}

/** A chart as SVG, drawn from the engine's chart scene (the same one the PDF export uses). */
export function ChartView({ el, theme }: { el: ResolvedElement; theme: Theme }) {
  const chart = el.chart;
  const scene = useMemo(() => (chart ? chartScene(chart, el.w, el.h, theme) : null), [chart, el.w, el.h, theme]);
  if (!scene) return null;
  const label = el.alt || (chart?.title ? `Chart: ${chart.title}` : "Chart");
  return (
    <svg className="pli-deck-svg pli-deck-chart-svg" width={Math.max(el.w, 1)} height={Math.max(el.h, 1)} viewBox={`0 0 ${Math.max(el.w, 1)} ${Math.max(el.h, 1)}`} role="img" aria-label={label} focusable="false">
      {scene.items.map((it, i) => (
        <Item key={i} it={it} font={fontStack(scene.fontFamily)} />
      ))}
    </svg>
  );
}
