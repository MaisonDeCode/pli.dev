import { createContext, useCallback, useContext, type ReactNode } from "react";

/** What the person is choosing a file for. */
export type FilePickPurpose =
  /** A picture to put in the document, sheet, slide or PDF page. */
  | "image"
  /** A file to open instead of the current one (or to start a new one from). */
  | "open"
  /** A file whose contents are brought into the current one: a DOCX to import, a theme, a form's data, pages from another PDF. */
  | "import";

/** What an editor asks your picker for. */
export interface FilePickRequest {
  purpose: FilePickPurpose;
  /** The kinds of file that fit, as the `accept` list of a file input: `"image/*"`, `".docx,.pdf"`. Use it to filter your own list. */
  accept: string;
  /** Whether more than one file can be used. */
  multiple: boolean;
  /** What the person is doing, in words: "Insert a picture", "Import a DOCX file". A good title for your own dialog. */
  label: string;
  /**
   * Opens the browser's own file chooser and resolves with what was chosen (an empty list if it was cancelled). Put it behind a
   * "From your computer" button in your picker. It has to be called from a click, which a button in your own dialog is.
   */
  browse: () => Promise<File[]>;
}

/**
 * Your own way of choosing a file. Called whenever an editor needs one; show your own dialog (a list of the files in your app, a
 * drive, a camera), then give back what was chosen as `File` objects: `await fetch(url).then((r) => r.blob())` and `new File(...)`
 * turns a stored file into one. Return `null` (or an empty list) when the person cancels. Left out, the editor opens the browser's chooser.
 */
export type FilePicker = (request: FilePickRequest) => Promise<File | File[] | null | undefined> | File | File[] | null | undefined;

/** Shows the browser's file chooser and resolves with the chosen files (none when it is cancelled). Call it from a click. */
export function browseFiles(options: { accept: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = options.multiple === true;
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    document.body.append(input);
    input.click();
  });
}

/** The picker an editor was given (`filePicker`), for the components inside it. `undefined` means the browser's own chooser. */
export const FilePickerContext = createContext<FilePicker | undefined>(undefined);

/** Gives the editor's components your picker. Editors wrap themselves in this for their `filePicker` prop. */
export function FilePickerProvider({ picker, children }: { picker: FilePicker | undefined; children: ReactNode }) {
  return <FilePickerContext.Provider value={picker}>{children}</FilePickerContext.Provider>;
}

export interface PickOptions {
  purpose: FilePickPurpose;
  accept: string;
  multiple?: boolean;
  label: string;
}

/**
 * A modal `<dialog>` is drawn in the browser's top layer, above everything else on the page, so a picker the app shows from inside one
 * (a normal React modal, say) would open behind it. While a custom picker is open, the dialogs that are showing are held as plain
 * (non-modal) ones, and put back as modals afterwards. Their own `onClose` is not told, since they are not closing.
 */
function holdModalDialogs(): () => void {
  const held: HTMLDialogElement[] = [];
  const swallow = (event: Event) => event.stopImmediatePropagation();
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
    let modal = false;
    try {
      modal = dialog.matches(":modal");
    } catch {
      // A browser that doesn't know `:modal` doesn't have the top layer problem either.
    }
    if (!modal || typeof dialog.show !== "function") continue;
    dialog.addEventListener("close", swallow, { capture: true });
    dialog.close();
    dialog.show();
    held.push(dialog);
  }
  return () => {
    for (const dialog of held) {
      if (dialog.isConnected && dialog.open) {
        dialog.close();
        dialog.showModal();
      }
      // The `close` events from the calls above are fired a moment later: stop swallowing after them.
      setTimeout(() => dialog.removeEventListener("close", swallow, { capture: true }), 0);
    }
  };
}

/** Asks `picker` (or the browser's chooser when there is none) for files. The result is always a list, empty when nothing was chosen. */
export async function pickWith(picker: FilePicker | undefined, options: PickOptions): Promise<File[]> {
  const multiple = options.multiple === true;
  const browse = () => browseFiles({ accept: options.accept, multiple });
  if (!picker) return browse();
  const release = holdModalDialogs();
  try {
    const got = await picker({ purpose: options.purpose, accept: options.accept, multiple, label: options.label, browse });
    const files = got == null ? [] : Array.isArray(got) ? got : [got];
    return multiple ? files : files.slice(0, 1);
  } finally {
    release();
  }
}

/** `pick(options)`: choose files the way the editor was set up to (see `FilePicker`). Call it from a click handler. */
export function useFilePicker(): (options: PickOptions) => Promise<File[]> {
  const picker = useContext(FilePickerContext);
  return useCallback((options) => pickWith(picker, options), [picker]);
}

export interface FileInputProps extends PickOptions {
  /** Called with the chosen files (never empty). */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  /** The text of the button when a custom picker is in use. Default: the `label`. */
  buttonText?: ReactNode;
}

/**
 * A file field. With no `filePicker` it is the browser's own `<input type="file">`; with one it is a button that asks the picker, so a
 * dialog that has a file field shows your chooser too.
 */
export function FileInput({ purpose, accept, multiple, label, onFiles, disabled, className, buttonText }: FileInputProps) {
  const picker = useContext(FilePickerContext);
  if (!picker) {
    return (
      <input
        type="file"
        aria-label={label}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className={className}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={className ? `pli-button ${className}` : "pli-button"}
      disabled={disabled}
      onClick={() => {
        void pickWith(picker, { purpose, accept, multiple, label }).then((files) => {
          if (files.length) onFiles(files);
        });
      }}
    >
      {buttonText ?? label}
    </button>
  );
}
