// No crypto dependency: this must run in JavaScriptCore and QuickJS as well as browsers.
let generator: () => string = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Replace the id generator, e.g. with a counter for deterministic tests. */
export function setIdGenerator(next: () => string): void {
  generator = next;
}

export function createId(prefix = ""): string {
  return prefix + generator();
}
