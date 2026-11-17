import { isOpenable, noteRunsOf, type NoteInfo } from "@pli.dev/sheets";
import { runCss } from "./noteDom";

const styleOf = (css: string): React.CSSProperties => {
  const out: Record<string, string> = {};
  for (const part of css.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out[part.slice(0, i).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = part.slice(i + 1);
  }
  return out as React.CSSProperties;
};

/** A note as it is read: its author in bold in front (as Excel shows it), then the text with the look its parts were given. */
export function NoteContent({ info, onOpenLink }: { info: Pick<NoteInfo, "text" | "runs" | "author">; onOpenLink?: (to: string) => void }) {
  const runs = noteRunsOf({ note: info.text, ...(info.runs ? { noteRuns: info.runs } : {}) });
  return (
    <>
      {info.author && <div className="pli-note-by"><strong>{info.author}:</strong></div>}
      <div className="pli-note-body">
        {runs.map((r, i) => {
          const { text, link, ...look } = r;
          if (link) {
            // Excel's notes can't hold links, so these are Pli's own: clicked, they go where the cell links go.
            return (
              <a
                key={i}
                className="pli-note-link"
                role="link"
                tabIndex={0}
                {...(isOpenable(link) ? { href: link } : {})}
                data-link={link}
                title={link}
                style={styleOf(runCss(look))}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenLink?.(link);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onOpenLink?.(link);
                  }
                }}
              >
                {text}
              </a>
            );
          }
          return Object.keys(look).length ? <span key={i} style={styleOf(runCss(look))}>{text}</span> : text;
        })}
      </div>
    </>
  );
}
