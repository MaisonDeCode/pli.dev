/** The format with one more or fewer decimals. */
export function stepDecimals(format: string | undefined, delta: number): string {
  const plain = format && /[0#]/.test(format) && !/[ymdhs]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g, "")) ? format : "0";
  // Each section (positive, negative, zero) takes the change; the text section has no digits and is left alone.
  return plain
    .split(";")
    .map((section) => {
      const m = /([0#,]*[0#])(?:\.([0#]*))?/.exec(section);
      if (!m) return section;
      const places = Math.max(0, (m[2]?.length ?? 0) + delta);
      return section.slice(0, m.index) + m[1] + (places > 0 ? "." + "0".repeat(places) : "") + section.slice(m.index + m[0].length);
    })
    .join(";");
}
