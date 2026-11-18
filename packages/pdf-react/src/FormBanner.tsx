import { useContext, useEffect, useRef } from "react";
import { Dialog, Dropdown, FilePickerContext, MenuList, keepFocus, pickWith, type MenuEntry } from "@pli.dev/react";
import { useFormController, type FormController } from "./formController";
import type { PdfMenus } from "./commands";
import { FormIcons as I } from "./formIcons";
import { KINDS } from "./formsGeometry";
import { PdfIcons } from "./icons";
import { usePageTools } from "./usePageTools";

/**
 * The form's bars and menus: the banner for people filling the form (highlight, clear, flatten, dismiss), the Prepare form
 * bar (which field to add, tab order, duplicate, delete), the Form menu of the toolbar (also export and import), and the
 * dialog that explains flattening.
 */

/** "This document has fillable fields" and what can be done with them. */
function FillBanner({ c }: { c: FormController }) {
  const readOnly = c.readOnly;
  return (
    <div className="pli-pdf-banner pli-pdf-formbar" role="region" aria-label="Form">
      <span className="pli-pdf-banner-text">This document has fillable fields:</span>
      <div className="pli-pdf-banner-actions">
        <button type="button" className="pli-button" aria-pressed={c.highlight} title="Colour the fields so they can be found" onMouseDown={keepFocus} onClick={() => c.setHighlight(!c.highlight)}>
          Highlight fields
        </button>
        {!readOnly && (
          <>
            <button type="button" className="pli-button" title="Put every field back to its first value" onClick={() => c.clear()}>
              Clear form
            </button>
            <button type="button" className="pli-button" title="Draw the fields into the pages and save a copy" onClick={() => c.openDialog("flatten")}>
              Flatten…
            </button>
          </>
        )}
      </div>
      <button type="button" className="pli-tool pli-pdf-banner-close" aria-label="Dismiss form bar" title="Dismiss" onClick={() => c.closeBanner()}>
        {PdfIcons.close}
      </button>
    </div>
  );
}

/** The bar of Prepare form mode. */
function DesignBar({ c }: { c: FormController }) {
  const active = c.activeKind;
  const has = !!c.selection;
  const pending = c.radio?.points.length ?? 0;
  return (
    <div className="pli-pdf-banner pli-pdf-designbar" role="toolbar" aria-label="Prepare form tools">
      <span className="pli-pdf-banner-text">Prepare form</span>
      <div className="pli-pdf-banner-actions" role="group" aria-label="Add a field">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className="pli-tool pli-pdf-formtool"
            aria-pressed={active === k.kind}
            aria-label={k.label}
            title={`${k.label}: ${k.hint} Shift+Enter puts one in the middle of the page.`}
            onMouseDown={keepFocus}
            onClick={() => c.chooseKind(k.kind)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                c.addAtCenter(k.kind);
              }
            }}
          >
            {I[k.kind]}
            <span className="pli-pdf-formtool-label">{k.label}</span>
          </button>
        ))}
      </div>
      {pending > 0 && (
        <button type="button" className="pli-button pli-button-primary" title="Finish the radio group you are placing" onClick={() => c.finishRadio()}>
          Finish radio group ({pending})
        </button>
      )}
      <div className="pli-pdf-banner-actions" role="group" aria-label="Selected field">
        <button type="button" className="pli-tool" aria-label="Duplicate field" title="Duplicate (Ctrl+D)" disabled={!has} onMouseDown={keepFocus} onClick={() => c.duplicate()}>
          {I.duplicate}
        </button>
        <button type="button" className="pli-tool" aria-label="Delete field" title="Delete" disabled={!has} onMouseDown={keepFocus} onClick={() => c.removeSelected()}>
          {I.trash}
        </button>
        <button type="button" className="pli-tool" aria-label="Show tab order" title="Show the order Tab visits the fields in" aria-pressed={c.showOrder} onMouseDown={keepFocus} onClick={() => ((c.showOrder = !c.showOrder), c.emit())}>
          {I.order}
        </button>
      </div>
      <button type="button" className="pli-button" title="Leave Prepare form" onClick={() => c.setDesigning(false)}>
        Done
      </button>
    </div>
  );
}

/** What the last import, export or flatten said. */
function NoticeBar({ c }: { c: FormController }) {
  const n = c.notice;
  if (!n) return null;
  return (
    <div className="pli-pdf-banner pli-pdf-notice" role={n.kind === "error" ? "alert" : "status"} data-kind={n.kind}>
      <span className="pli-pdf-banner-text">{n.text}</span>
      <button type="button" className="pli-tool pli-pdf-banner-close" aria-label="Dismiss message" onClick={() => c.clearNotice()}>
        {PdfIcons.close}
      </button>
    </div>
  );
}

/** The `banner` slot of the viewer: a message, and the form bar or the Prepare form bar. */
export function FormBanner({ c }: { c: FormController }) {
  useFormController(c);
  const hasFields = c.fields.length > 0;
  return (
    <>
      {c.notice && <NoticeBar c={c} />}
      {c.designing ? <DesignBar c={c} /> : hasFields && c.bannerOpen ? <FillBanner c={c} /> : null}
    </>
  );
}

/** Asks before flattening. */
export function FlattenDialog({ c }: { c: FormController }) {
  const open = c.dialog === "flatten";
  const n = c.fields.length;
  return (
    <Dialog
      open={open}
      title="Flatten form fields"
      onClose={() => c.openDialog(null)}
      onSubmit={() => void c.flatten()}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => c.openDialog(null)}>
            Cancel
          </button>
          <button type="submit" className="pli-button pli-button-danger" disabled={n === 0}>
            Flatten and save a copy
          </button>
        </>
      }
    >
      <p>
        Flattening draws every field into the page as ordinary text and shapes, then takes the fields out. {n === 0 ? "This document has no fields." : `${n} ${n === 1 ? "field is" : "fields are"} affected.`}
      </p>
      <p>
        <strong>It cannot be undone in the saved file.</strong> Nobody can fill in or change the values again, because they are no longer fields. This window keeps the form as it is, and the flattened copy is saved as a new file.
      </p>
    </Dialog>
  );
}

/** The entries of the Form menu: the toolbar's Form button and Tools > Form open the same list. */
export function formMenuItems(c: FormController): MenuEntry[] {
  const readOnly = c.readOnly;
  const hasFields = c.fields.length > 0;
  return [
    { label: "Highlight fields", checked: c.highlight, onSelect: () => c.setHighlight(!c.highlight), disabled: !hasFields },
    { label: "Clear form", onSelect: () => c.clear(), disabled: readOnly || !hasFields },
    "separator",
    { label: "Export data…", onSelect: () => void c.exportData(), disabled: !hasFields },
    { label: "Import data…", onSelect: () => c.actions.pickFile?.(), disabled: readOnly || !hasFields },
    { label: "Flatten…", onSelect: () => c.openDialog("flatten"), disabled: readOnly || !hasFields },
    "separator",
    { label: "Prepare form", checked: c.designing, onSelect: () => c.setDesigning(!c.designing), disabled: readOnly },
    ...(hasFields && !c.bannerOpen ? [{ label: "Show form bar", onSelect: () => c.openBanner() }] : []),
  ];
}

/** What the form tools add to the menus: the form fields under Insert, the Form menu under Tools, and Highlight fields under View. */
export function formMenus(c: FormController): PdfMenus {
  const hasFields = c.fields.length > 0;
  return {
    View: hasFields ? [{ label: "Highlight form fields", checked: c.highlight, onSelect: () => c.setHighlight(!c.highlight) }] : [],
    Insert: c.readOnly ? [] : [{ label: "Form field", items: KINDS.map((k) => ({ label: k.label, onSelect: () => (c.setDesigning(true), c.chooseKind(k.kind)) })) }],
    Tools: [...(c.readOnly ? [] : [{ label: "Prepare form", checked: c.designing, onSelect: () => c.setDesigning(!c.designing) }]), { label: "Form", items: formMenuItems(c) }],
  };
}

/**
 * What the toolbar gets (with `topToolbar`): the Form menu and the Prepare form switch. The menus of the menu bar have both (Tools
 * > Form, Tools > Prepare form), so the buttons are the extra.
 */
export function FormsToolbar({ c }: { c: FormController }) {
  useFormController(c);
  const readOnly = c.readOnly;
  const hasFields = c.fields.length > 0;
  const items = formMenuItems(c);
  if (!hasFields && readOnly) return null;
  return (
    <>
      <Dropdown label="Form" className="pli-pdf-formmenu" panel={(close) => <MenuList label="Form" items={items} close={close} />}>
        <span className="pli-pdf-form-label">
          {I.form}
          Form {PdfIcons.chevron}
        </span>
      </Dropdown>
      {!readOnly && (
        <button type="button" className="pli-tool pli-pdf-tool" aria-label="Prepare form" title="Prepare form: add and edit fields" aria-pressed={c.designing} onMouseDown={keepFocus} onClick={() => c.setDesigning(!c.designing)}>
          {I.prepare}
        </button>
      )}
    </>
  );
}

/**
 * What the form tools need on screen all the time, toolbar or not: the hidden file input for importing data, the flatten
 * dialog and a live region for screen readers. Also where the controller learns about the viewer (`setView`).
 */
export function FormsHost({ c }: { c: FormController }) {
  useFormController(c);
  const input = useRef<HTMLInputElement>(null);
  c.files = usePageTools()?.files ?? null;
  const picker = useContext(FilePickerContext);
  useEffect(() => {
    c.actions.pickFile = picker
      ? () => void pickWith(picker, { purpose: "import", accept: "application/json,.json", label: "Import form data" }).then(([file]) => (file ? c.importFile(file) : undefined))
      : () => input.current?.click();
    return () => {
      c.actions.pickFile = undefined;
    };
  }, [c, picker]);
  return (
    <>
      {!picker && (
        <input
          ref={input}
          type="file"
          hidden
          accept="application/json,.json"
          aria-label="Import form data"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void c.importFile(file);
          }}
        />
      )}
      <FlattenDialog c={c} />
      <span className="pli-pdf-sr" role="status" aria-live="polite">
        {c.live}
      </span>
    </>
  );
}
