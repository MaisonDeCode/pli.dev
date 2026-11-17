import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseDoc } from "../src";

// The agent skill's command line tool, as bundled in skills/pli-documents/scripts/pli.mjs.
const skill = fileURLToPath(new URL("../../../skills/pli-documents/", import.meta.url));
const cli = join(skill, "scripts/pli.mjs");
const out = mkdtempSync(join(tmpdir(), "pli-skill-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const run = (...args: string[]) => execFileSync("node", [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("pli-documents skill tool", () => {
  it("builds the Markdown example to DOCX, JSON and HTML", () => {
    const json = join(out, "report.pli.json");
    run("build", join(skill, "examples/report.md"), "--docx", join(out, "report.docx"), "--json", json, "--html", join(out, "report.html"));
    expect(readFileSync(join(out, "report.docx")).subarray(0, 2).toString()).toBe("PK");
    expect(parseDoc(readFileSync(json, "utf8")).blocks.length).toBeGreaterThan(5);
    expect(run("validate", json)).toMatch(/valid|ok/i);
  });

  it("builds the JSON shorthand example", () => {
    const json = join(out, "proposal.pli.json");
    run("build", join(skill, "examples/proposal.json"), "--json", json);
    expect(parseDoc(readFileSync(json, "utf8")).footer?.length).toBeGreaterThan(0);
  });

  it("refuses a file that is not a saved document (non-zero exit)", () => {
    expect(() => run("validate", join(skill, "examples/proposal.json"))).toThrow();
  });
});
