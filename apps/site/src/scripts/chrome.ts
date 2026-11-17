/**
 * The page chrome's small bits of script: the theme toggle and the phone menu. Both work through the DOM only, so the page is
 * complete without them (the toggle is hidden until the script has run; the menu is a plain <details>).
 *
 * The theme is stored under "starlight-theme" with the value "light" or "dark", the key and values Starlight's own theme
 * picker uses, so the choice made here is the one the docs open with. No stored value means: follow the system.
 */
const KEY = "starlight-theme";

export function effectiveTheme(root: Document = document): "light" | "dark" {
  const set = root.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return root.defaultView?.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initChrome(root: Document = document): () => void {
  const view = root.defaultView!;
  const cleanups: (() => void)[] = [];

  // Theme toggle. After a manual choice the two theme-color metas are switched by hand, since their media queries only know the system.
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")];
  const sync = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(effectiveTheme(root) === "dark")));
  const colourMetas = (theme: "light" | "dark") => {
    root.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      const own = meta.dataset.scheme;
      meta.media = own === theme ? "all" : "not all";
    });
  };
  const onToggle = () => {
    const next = effectiveTheme(root) === "dark" ? "light" : "dark";
    root.documentElement.dataset.theme = next;
    try {
      view.localStorage.setItem(KEY, next);
    } catch {
      /* private mode or blocked storage: the choice just lasts for this page */
    }
    colourMetas(next);
    sync();
  };
  buttons.forEach((b) => b.addEventListener("click", onToggle));
  const mq = view.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", sync);
  cleanups.push(() => {
    buttons.forEach((b) => b.removeEventListener("click", onToggle));
    mq.removeEventListener("change", sync);
  });
  sync();
  if (root.documentElement.dataset.theme === "light" || root.documentElement.dataset.theme === "dark") colourMetas(effectiveTheme(root));

  // Phone menu: Escape or a click outside closes it, and Escape hands focus back to the button.
  const menus = [...root.querySelectorAll<HTMLDetailsElement>("details[data-menu]")];
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    for (const m of menus) {
      if (!m.open) continue;
      m.open = false;
      m.querySelector<HTMLElement>("summary")?.focus();
    }
  };
  const onClick = (e: MouseEvent) => {
    for (const m of menus) if (m.open && !m.contains(e.target as Node)) m.open = false;
  };
  root.addEventListener("keydown", onKey);
  root.addEventListener("click", onClick);
  cleanups.push(() => {
    root.removeEventListener("keydown", onKey);
    root.removeEventListener("click", onClick);
  });
  return () => cleanups.forEach((fn) => fn());
}
