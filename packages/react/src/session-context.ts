import { createContext } from "react";
import type { DocumentSession } from "@pli.dev/docs";

/**
 * The session an editing surface renders. Pieces deep in the document, such as an image that shows its
 * upload progress or resolves a stored file's address, read it from here instead of through props.
 */
export const EditorSessionContext = createContext<DocumentSession | null>(null);

/** How `{{ … }}` in the text is drawn. */
export interface PlaceholderMode {
  /**
   * Gives a tag's name in plain words (for `{{ client.name }}`, "Client name"). When it is there the tag is shown as that name and
   * its text is hidden, and the caret treats the tag as one character. When it returns `undefined` the tag is shown as written.
   */
  label?: (tag: string) => string | undefined;
}

/**
 * Whether and how `{{ … }}` in the text is drawn as a chip. Set by `PliDocument`'s `placeholders` option (or `PliEditor`'s); read by
 * the blocks deep in the page. `false` draws the text as it is.
 */
export const PlaceholdersContext = createContext<PlaceholderMode | false>(false);
