import { arrays } from "./array";
import { bonds } from "./bonds";
import { complexFunctions } from "./complex";
import { databaseFunctions } from "./database";
import { dates } from "./date";
import { dates2 } from "./date2";
import { financial } from "./financial";
import { forecastFunctions } from "./forecast";
import { financial2 } from "./financial2";
import { groupFunctions } from "./groupby";
import { info } from "./info";
import { imageFunctions } from "./image";
import { info2 } from "./info2";
import { logical } from "./logical";
import { lookup } from "./lookup";
import { math } from "./math";
import { math2 } from "./math2";
import { pivot } from "./pivot";
import { regression } from "./regression";
import { stats } from "./stat";
import { sparklineFunctions } from "./sparkline";
import { subtotalFunctions } from "./subtotal";
import { stats2 } from "./stat2";
import { text } from "./text";
import { text2 } from "./text2";
import { VALUE } from "../values";
import type { FunctionDef } from "./types";

const table = new Map<string, FunctionDef>();
for (const group of [math, math2, stats, stats2, arrays, logical, info, text, text2, dates, dates2, lookup, financial, financial2, bonds, info2, pivot, databaseFunctions, imageFunctions, regression, groupFunctions, subtotalFunctions, sparklineFunctions, complexFunctions, forecastFunctions]) {
  for (const [name, def] of Object.entries(group)) table.set(name, def);
}

// Names that are the same function under another name.
for (const [alias, name] of Object.entries({ "FORECAST.LINEAR": "FORECAST" })) table.set(alias, table.get(name)!);

/** The function with this name (any case; a `_xlfn.` prefix is ignored), if Pli has it. */
/** Stands for the call with no name; never run (the evaluator handles that call itself). */
const CALLED_AT_ONCE: FunctionDef = { min: 1, max: 255, fn: () => VALUE };

export function getFunction(name: string): FunctionDef | undefined {
  // A call with no name is a function called where it stands, `LAMBDA(x,x+1)(5)` (evaluated by the evaluator itself); it is not a function that is missing.
  if (name === "") return CALLED_AT_ONCE;
  return table.get(name.toUpperCase().replace(/^_XL(FN|WS)\./, ""));
}

/** The names of all the functions Pli has, in order. */
export function functionNames(): string[] {
  return [...table.keys()].sort();
}
