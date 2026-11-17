import { useEffect, useRef } from "react";
import { currentParam, syntaxParts, type FormulaAssist, type FunctionInfo, type Suggestion } from "@pli.dev/sheets";

export interface FormulaAssistViewProps {
  assist: FormulaAssist;
  /** Which of the completions is highlighted. */
  index: number;
  /** What a defined name stands for, to show beside it. */
  nameFormula(name: string): string | undefined;
  onPick(suggestion: Suggestion): void;
  onHover(index: number): void;
}

/** The syntax of a function with the argument being typed in bold. */
function Syntax({ info, current }: { info: FunctionInfo; current?: number }) {
  return (
    <code className="pli-assist-syntax">
      {syntaxParts(info).map((part, i) => (
        <span key={i} className={part.param !== undefined && part.param === current ? "pli-assist-current" : undefined}>
          {part.text}
        </span>
      ))}
    </code>
  );
}

/** Everything about a function: what it does, its arguments, an example. */
function FunctionCard({ info, current }: { info: FunctionInfo; current?: number }) {
  return (
    <div className="pli-assist-card">
      <div className="pli-assist-title">
        <Syntax info={info} current={current} />
        <span className="pli-assist-category">{info.category}</span>
      </div>
      <p className="pli-assist-summary">{info.summary}</p>
      {info.params.length > 0 && (
        <dl className="pli-assist-params">
          {info.params.map((p, i) => (
            <div key={i} className="pli-assist-param" data-current={current === i ? "" : undefined}>
              <dt>
                {p.optional ? `[${p.name}]` : p.name}
                {p.repeats ? "…" : ""}
              </dt>
              <dd>{p.description}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="pli-assist-example">
        <span className="pli-assist-label">Example</span>
        <code>{info.example}</code>
        <span className="pli-assist-result">{info.result}</span>
      </div>
      {info.volatile && <p className="pli-assist-note">Worked out again after every change.</p>}
    </div>
  );
}

/**
 * The help shown while a formula is typed: a list of functions and names that complete what is at the caret, with a
 * card for the highlighted one; or, inside a call, the function's syntax with the argument being typed in bold.
 */
export function FormulaAssistView({ assist, index, nameFormula, onPick, onHover }: FormulaAssistViewProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  if (assist.completing) {
    const { items } = assist.completing;
    const picked = items[Math.min(index, items.length - 1)];
    return (
      <div className="pli-assist" role="presentation">
        <ul className="pli-assist-list" role="listbox" aria-label="Functions" ref={listRef}>
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.name}`}
              role="option"
              aria-selected={i === index}
              className="pli-assist-item"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
              onMouseEnter={() => onHover(i)}
            >
              <span className="pli-assist-name">
                <b>{item.name.slice(0, assist.completing!.query.length)}</b>
                {item.name.slice(assist.completing!.query.length)}
              </span>
              <span className="pli-assist-kind">{item.kind === "name" ? "Name" : item.info!.category}</span>
            </li>
          ))}
        </ul>
        {picked?.kind === "function" && picked.info && <FunctionCard info={picked.info} />}
        {picked?.kind === "name" && (
          <div className="pli-assist-card">
            <div className="pli-assist-title">
              <code className="pli-assist-syntax">{picked.name}</code>
              <span className="pli-assist-category">Name</span>
            </div>
            <p className="pli-assist-summary">A name you defined.</p>
            <div className="pli-assist-example">
              <span className="pli-assist-label">Stands for</span>
              <code>={nameFormula(picked.name) ?? ""}</code>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (assist.call) {
    const { info, argIndex } = assist.call;
    const current = currentParam(info, argIndex);
    const param = current === undefined ? undefined : info.params[current];
    return (
      <div className="pli-assist pli-assist-hint" role="status">
        <div className="pli-assist-card">
          <Syntax info={info} current={current} />
          <p className="pli-assist-summary">{param ? <><b>{param.optional ? `[${param.name}]` : param.name}</b>: {param.description}</> : info.summary}</p>
          <p className="pli-assist-hintnote">{info.summary}</p>
        </div>
      </div>
    );
  }
  return null;
}
