import { useEffect, useRef, useState } from "react";
import { Dropdown, MenuList, keepFocus, type MenuEntry } from "@pli.dev/react";
import { PdfIcons as I } from "./icons";
import { PageIcons as P } from "./pageIcons";
import type { FileActions } from "./fileActions";
import { MOD } from "./shortcuts";
import { useStore } from "./store";

/** The Save button: on while there is something to save, and the host gave `onSave`. */
export function SaveButton({ files, dirty }: { files: FileActions; dirty: boolean }) {
  useStore(files);
  if (!files.hooks.onSave || files.readOnly) return null;
  return (
    <button type="button" className="pli-tool pli-pdf-tool" aria-label="Save" title={`Save (${MOD}S)`} data-command="save" disabled={!dirty || !!files.busy} onMouseDown={keepFocus} onClick={() => void files.save()}>
      {I.save}
    </button>
  );
}

/**
 * The file commands of a toolbar with no menu bar: the Save button and a File menu with the entries you give (`PliPdf` gives
 * the entries of its own File menu, so the two are the same list). Without `items` there is only the Save button.
 */
export function FileMenu({ files, dirty, items }: { files: FileActions; dirty: boolean; items?: MenuEntry[] }) {
  useStore(files);
  return (
    <>
      <SaveButton files={files} dirty={dirty} />
      {items && items.length > 0 && (
        <Dropdown label="File" align="end" panel={(close) => <MenuList label="File" items={items} close={close} />}>
          {P.file}
        </Dropdown>
      )}
    </>
  );
}

/** The document's name with a dot when there are unsaved changes. Click the name to rename the document. */
export function DocumentTitle({ files, dirty }: { files: FileActions; dirty: boolean }) {
  useStore(files);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const name = files.name;
  const commit = (value: string) => {
    setEditing(false);
    files.rename(value);
  };
  return (
    <div className="pli-pdf-title" data-dirty={dirty ? "" : undefined}>
      {dirty && <span className="pli-pdf-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
      {editing ? (
        <input
          ref={input}
          className="pli-pdf-title-input"
          aria-label="Document name"
          defaultValue={name}
          autoFocus
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit(e.currentTarget.value);
            else if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="pli-pdf-title-name" title={files.readOnly ? name : `${name} (click to rename)`} aria-label={files.readOnly ? `Document: ${name}` : `Rename ${name}`} disabled={files.readOnly} onClick={() => setEditing(true)}>
          {name}
        </button>
      )}
    </div>
  );
}
