import { useState } from "react";
import { Dropdown, MenuList, keepFocus, type MenuEntry } from "@pli.dev/react";
import type { DeckSession, LayoutKind } from "@pli.dev/decks";
import { SlideView } from "./SlideView";
import { DeckIcons as I } from "./icons";
import { useDeckRevision } from "./hooks";
import { builtinThemeMaster, builtinThemes } from "./engine";

const KINDS: [LayoutKind, string][] = [
  ["title", "Title slide"],
  ["titleAndBody", "Title and body"],
  ["sectionHeader", "Section header"],
  ["titleAndTwoColumns", "Title and two columns"],
  ["titleOnly", "Title only"],
  ["oneColumnText", "One column text"],
  ["captionLeft", "Caption"],
  ["bigNumber", "Big number"],
  ["blank", "Blank"],
  ["custom", "Custom"],
];

/**
 * The master view's side pane: a switcher for the deck's masters (with add, rename and delete), the shown master's own
 * preview and its layouts (rename, duplicate, move, delete, add), and the settings of the layout being edited.
 */
export function TemplateList({ session, active, onPick, readOnly = false }: { session: DeckSession; active: string; onPick: (id: string) => void; readOnly?: boolean }) {
  useDeckRevision(session);
  const deck = session.deck;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingMaster, setRenamingMaster] = useState(false);
  const [name, setName] = useState("");
  const master = deck.masters.find((m) => m.id === active || m.layouts.some((l) => l.id === active)) ?? deck.masters[0]!;
  const activeLayout = master.layouts.find((l) => l.id === active);
  const scale = 128 / deck.size.width;
  const used = (id: string) => deck.slides.some((s) => s.layout === id);
  const masterUsed = master.layouts.some((l) => used(l.id));
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch {
      // the engine refused (a rule of masters and layouts); nothing changes
    }
  };

  const addMasterItems = (): MenuEntry[] => [
    { label: "Duplicate this master", onSelect: () => attempt(() => onPick(session.duplicateMaster(master.id).id)) },
    "separator",
    ...builtinThemes().map((t) => ({
      label: t.name,
      onSelect: () => {
        const m = builtinThemeMaster(t.id, deck.size);
        if (m) attempt(() => onPick(session.addMaster(m).id));
      },
    })),
  ];

  const deleteMaster = () => {
    const rest = deck.masters.filter((m) => m.id !== master.id);
    attempt(() => {
      session.removeMaster(master.id);
      if (rest[0]) onPick(rest[0].id);
    });
  };

  return (
    <div className="pli-deck-templates">
      <div className="pli-deck-master-switch" role="group" aria-label="Masters">
        {renamingMaster ? (
          <input
            className="pli-deck-rename"
            aria-label="Master name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim()) attempt(() => session.renameMaster(master.id, name)); setRenamingMaster(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingMaster(false); }}
          />
        ) : (
          <span className="pli-select-wrap">
            <select className="pli-select" aria-label="Choose master" value={master.id} onChange={(e) => onPick(e.target.value)}>
              {deck.masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <span className="pli-select-chevron" aria-hidden="true">{I.chevron}</span>
          </span>
        )}
        <div className="pli-deck-master-actions">
          <Dropdown label="Add master" className="pli-tool-wide" panel={(close) => <MenuList close={close} label="Add master" items={addMasterItems()} />}>
            <span className="pli-deck-with-chevron">{I.plus} <span>Master</span></span>
          </Dropdown>
          <button type="button" className="pli-tool" aria-label="Rename master" title="Rename master" disabled={readOnly} onMouseDown={keepFocus} onClick={() => { setRenamingMaster(true); setName(master.name); }}>{I.edit}</button>
          <button
            type="button"
            className="pli-tool"
            aria-label="Delete master"
            title={deck.masters.length <= 1 ? "A presentation needs a master" : masterUsed ? "Slides use this master's layouts" : "Delete master"}
            disabled={readOnly || deck.masters.length <= 1 || masterUsed}
            onMouseDown={keepFocus}
            onClick={deleteMaster}
          >
            {I.trash}
          </button>
        </div>
      </div>

      <button type="button" className="pli-deck-template-item" aria-current={active === master.id ? "true" : undefined} data-active={active === master.id ? "" : undefined} onClick={() => onPick(master.id)}>
        <SlideView scene={session.scene(master.id)} scale={scale} prompts />
        <span>{master.name} (master)</span>
      </button>
      <div role="list" aria-label="Layouts">
        {master.layouts.map((l, i) => (
          <div key={l.id} role="listitem" className="pli-deck-template-row" data-active={active === l.id ? "" : undefined}>
            <button type="button" className="pli-deck-template-item" aria-current={active === l.id ? "true" : undefined} onClick={() => onPick(l.id)}>
              <SlideView scene={session.scene(l.id)} scale={scale} prompts />
              {renaming === l.id ? (
                <input
                  className="pli-deck-rename"
                  aria-label="Layout name"
                  value={name}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => { if (name.trim()) session.patchLayout(l.id, { name: name.trim() }); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
                />
              ) : (
                <span>{l.name}</span>
              )}
            </button>
            <div className="pli-deck-template-actions">
              <button type="button" className="pli-tool" aria-label={`Rename layout ${l.name}`} title="Rename layout" disabled={readOnly} onClick={() => { setRenaming(l.id); setName(l.name); }}>{I.edit}</button>
              <button type="button" className="pli-tool" aria-label={`Duplicate layout ${l.name}`} title="Duplicate layout" disabled={readOnly} onClick={() => onPick(session.duplicateLayout(l.id).id)}>{I.copy}</button>
              <button type="button" className="pli-tool" aria-label={`Move layout ${l.name} up`} title="Move up" disabled={readOnly || i === 0} onClick={() => session.moveLayout(l.id, "up")}><span style={{ display: "inline-block", transform: "rotate(90deg)" }}>{I.prev}</span></button>
              <button type="button" className="pli-tool" aria-label={`Move layout ${l.name} down`} title="Move down" disabled={readOnly || i === master.layouts.length - 1} onClick={() => session.moveLayout(l.id, "down")}><span style={{ display: "inline-block", transform: "rotate(90deg)" }}>{I.next}</span></button>
              <button type="button" className="pli-tool" aria-label={`Delete layout ${l.name}`} disabled={readOnly || used(l.id) || master.layouts.length <= 1} title={used(l.id) ? "Slides use this layout" : "Delete layout"} onClick={() => { session.removeLayout(l.id); if (active === l.id) onPick(master.id); }}>{I.trash}</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="pli-button" disabled={readOnly} onClick={() => { const l = session.addLayout(master.id, "New layout", "custom", master.layouts.find((x) => x.id === active)?.id); onPick(l.id); }}>
        {I.plus} Add layout
      </button>

      {activeLayout && (
        <fieldset className="pli-deck-layout-settings" disabled={readOnly}>
          <legend>Layout settings</legend>
          <label className="pli-deck-check">
            <input
              type="checkbox"
              aria-label="Show master shapes"
              checked={activeLayout.showMasterElements !== false}
              onChange={(e) => session.patchLayout(activeLayout.id, { showMasterElements: e.target.checked ? null : false })}
            />
            <span>Show master shapes</span>
          </label>
          <label className="pli-deck-field">
            <span>Layout type</span>
            <span className="pli-select-wrap">
              <select className="pli-select" aria-label="Layout type" value={activeLayout.kind ?? "custom"} onChange={(e) => session.patchLayout(activeLayout.id, { kind: e.target.value as LayoutKind })}>
                {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <span className="pli-select-chevron" aria-hidden="true">{I.chevron}</span>
            </span>
          </label>
        </fieldset>
      )}
    </div>
  );
}
