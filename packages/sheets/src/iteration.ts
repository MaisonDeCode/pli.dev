import { PliError } from "@pli.dev/core";
import type { IterationSettings } from "./model";

/** What Excel starts with when iterative calculation is turned on. */
export const DEFAULT_ITERATION: IterationSettings = { maxIterations: 100, maxChange: 0.001 };
export const MAX_ITERATIONS = 32767;

/** The settings after checking them (anything left out takes Excel's default), or an error saying what is wrong. */
export function cleanIteration(it: Partial<IterationSettings> | undefined): IterationSettings {
  if (!it || typeof it !== "object") throw new PliError("invalid_operation", "Iteration settings are an object");
  const maxIterations = it.maxIterations ?? DEFAULT_ITERATION.maxIterations;
  const maxChange = it.maxChange ?? DEFAULT_ITERATION.maxChange;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS)
    throw new PliError("invalid_operation", `The most iterations is a whole number from 1 to ${MAX_ITERATIONS}`);
  if (typeof maxChange !== "number" || !Number.isFinite(maxChange) || maxChange < 0) throw new PliError("invalid_operation", "The greatest change is a number that is not negative");
  return { maxIterations, maxChange };
}
