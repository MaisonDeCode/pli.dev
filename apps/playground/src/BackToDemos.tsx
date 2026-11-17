import { openDemo } from "./router";

/** The way back to the landing page, shown in each screen's title bar. */
export function BackToDemos() {
  return (
    <a
      className="back-link"
      href="#/"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        openDemo(null);
      }}
    >
      <span aria-hidden="true">←</span> Playground
    </a>
  );
}
