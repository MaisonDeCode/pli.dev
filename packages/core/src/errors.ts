export type PliErrorCode =
  | "not_found"
  | "out_of_range"
  | "invalid_operation"
  | "invalid_document"
  | "unsupported"
  /** A file store failed, or can't do what was asked of it. */
  | "storage"
  /** The caller cancelled the work. */
  | "cancelled";

export class PliError extends Error {
  readonly code: PliErrorCode;

  constructor(code: PliErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PliError";
    this.code = code;
  }
}
