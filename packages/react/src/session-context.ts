import { createContext } from "react";
import type { DocumentSession } from "@pli.dev/docs";

/**
 * The session an editing surface renders. Pieces deep in the document, such as an image that shows its
 * upload progress or resolves a stored file's address, read it from here instead of through props.
 */
export const EditorSessionContext = createContext<DocumentSession | null>(null);
