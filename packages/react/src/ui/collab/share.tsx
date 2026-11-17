import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Grant, PliUser, Role, ShareClient } from "@pli.dev/core";
import { Dialog } from "../primitives";
import { Avatar } from "./people";
import { useShareSettings } from "./hooks";
import { CollabIcons } from "./icons";

const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", commenter: "Commenter", editor: "Editor" };
const ROLE_HINTS: Record<Role, string> = { viewer: "Can read", commenter: "Can read and comment", editor: "Can edit" };

/** A menu of roles: Viewer, Commenter, Editor, and optionally "Remove access". */
export function RoleSelect({ value, onChange, roles = ["viewer", "commenter", "editor"], disabled, label, onRemove }: { value: Role; onChange: (role: Role) => void; roles?: readonly Role[]; disabled?: boolean; label: string; /** Adds "Remove access" to the menu. */ onRemove?: () => void }) {
  return (
    <select
      className="pli-role-select"
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => {
        if (event.target.value === "__remove") onRemove?.();
        else onChange(event.target.value as Role);
      }}
    >
      {roles.map((role) => (
        <option key={role} value={role} title={ROLE_HINTS[role]}>
          {ROLE_LABELS[role]}
        </option>
      ))}
      {onRemove && <option value="__remove">Remove access</option>}
    </select>
  );
}

/** The blue pill that opens the Share dialog. A lock when the file is restricted, a globe when anyone with the link can open it. */
export function ShareButton({ onClick, label = "Share", restricted = true }: { onClick: () => void; label?: string; restricted?: boolean }) {
  return (
    <button type="button" className="pli-share-button" title={label} onClick={onClick} aria-haspopup="dialog">
      <span className="pli-share-button-icon" aria-hidden="true">
        {restricted ? CollabIcons.lock : CollabIcons.globe}
      </span>
      {label}
    </button>
  );
}

const looksLikeAddress = (text: string) => /^\S+@\S+\.\S+$/.test(text.trim());

export interface ShareDialogProps {
  client: ShareClient;
  open: boolean;
  onClose: () => void;
  /** The file's name, for the heading. */
  title?: string;
  /** Roles that can be given. Default all three. */
  roles?: readonly Role[];
  /** Called after "Copy link" has put the address on the clipboard (to show a toast). */
  onCopyLink?: (url: string) => void;
}

/**
 * "Share": add people from your directory (or by email address), set what each may do, and choose who can open the link.
 * It works on a `ShareClient`, so it needs no server of its own; a person who may not share sees the list and nothing to change.
 */
export function ShareDialog({ client, open, onClose, title, roles = ["viewer", "commenter", "editor"], onCopyLink }: ShareDialogProps) {
  const settings = useShareSettings(client);
  const canInvite = client.can("invite");
  const canChange = client.can("changeRole");
  const canLink = client.can("link");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PliUser[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [picked, setPicked] = useState<(PliUser | string)[]>([]);
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  // Ask the directory what has been typed. A slower answer to an earlier question is ignored.
  useEffect(() => {
    const text = query.trim();
    if (!open || text === "" || !client.users.canSearch) {
      setMatches([]);
      return;
    }
    let current = true;
    client
      .search(text)
      .then((found) => {
        if (!current) return;
        setMatches(found.filter((u) => !picked.some((p) => typeof p !== "string" && p.id === u.id)).slice(0, 6));
        setHighlight(0);
      })
      .catch(() => current && setMatches([]));
    return () => {
      current = false;
    };
  }, [client, open, query, picked]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPicked([]);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  // Names of people with access come from the directory.
  const ids = useMemo(() => settings.grants.flatMap((g) => (g.userId ? [g.userId] : [])).concat(settings.owner ? [settings.owner] : []), [settings]);
  useEffect(() => client.users.prefetch(ids), [client, ids]);

  const pick = (person: PliUser | string) => {
    setPicked((list) => [...list, person]);
    setQuery("");
    setMatches([]);
    setError(null);
    input.current?.focus();
  };
  const add = (): boolean => {
    const text = query.trim();
    if (!text) return false;
    if (matches[highlight]) pick(matches[highlight]!);
    else if (looksLikeAddress(text)) pick(text);
    else setError(`"${text}" isn't someone in your directory or an email address`);
    return true;
  };
  const send = () => {
    try {
      if (query.trim()) add();
      if (picked.length === 0) return;
      client.invite(picked, role);
      setPicked([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share");
    }
  };
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change that");
    }
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setHighlight((i) => (i + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
    } else if (event.key === "Enter" || event.key === ",") {
      if (!query.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      add();
    } else if (event.key === "Backspace" && query === "" && picked.length > 0) {
      setPicked((list) => list.slice(0, -1));
    } else if (event.key === "Escape" && matches.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setMatches([]);
    }
  };

  const link = settings.link;
  const url = client.linkUrl;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      onCopyLink?.(url);
    } catch {
      setError("Couldn't copy the link. Select it and copy it by hand.");
    }
  };
  const owner = settings.owner ? client.users.get(settings.owner) : null;
  const rows: Grant[] = settings.grants.filter((g) => g.userId !== settings.owner);

  return (
    <Dialog
      open={open}
      title={title ? `Share “${title}”` : "Share"}
      onClose={onClose}
      onSubmit={send}
      actions={
        <>
          <button type="button" className="pli-button pli-share-copy" onClick={() => void copy()} disabled={!url} title={url ? "Copy the link to the clipboard" : "Turn on the link to copy it"}>
            <span aria-hidden="true">{CollabIcons.link}</span> {copied ? "Link copied" : "Copy link"}
          </button>
          <button type="button" className="pli-button pli-button-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="pli-share">
        {canInvite ? (
          <div className="pli-share-add">
            <div className="pli-share-field">
              {picked.map((p, i) => (
                <span key={typeof p === "string" ? p : p.id} className="pli-share-chip">
                  {typeof p === "string" ? p : p.name}
                  <button type="button" aria-label={`Remove ${typeof p === "string" ? p : p.name}`} onClick={() => setPicked((list) => list.filter((_, j) => j !== i))}>
                    {CollabIcons.close}
                  </button>
                </span>
              ))}
              <input
                ref={input}
                type="text"
                value={query}
                placeholder={picked.length === 0 ? "Add people by name or email" : ""}
                aria-label="Add people"
                role="combobox"
                aria-expanded={matches.length > 0}
                aria-controls={matches.length > 0 ? listId : undefined}
                aria-autocomplete="list"
                aria-activedescendant={matches.length > 0 ? `${listId}-${highlight}` : undefined}
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setError(null);
                }}
                onKeyDown={onKeyDown}
              />
            </div>
            {matches.length > 0 && (
              <ul className="pli-surface pli-share-matches" role="listbox" id={listId} aria-label="People">
                {matches.map((user, i) => (
                  <li
                    key={user.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === highlight}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(user);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                  >
                    <Avatar user={user} size={28} />
                    <span className="pli-share-match-text">
                      <span>{user.name}</span>
                      {user.email && <small>{user.email}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(picked.length > 0 || query.trim() !== "") && (
              <div className="pli-share-send">
                <RoleSelect value={role} onChange={setRole} roles={roles} label="Role for the people you are adding" />
                <button type="button" className="pli-button pli-button-primary" onClick={send}>
                  Send
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="pli-share-note">You can see who has access, but only editors can change it.</p>
        )}
        {error && (
          <p className="pli-share-error" role="alert">
            {error}
          </p>
        )}

        <h3 className="pli-share-heading">People with access</h3>
        <ul className="pli-share-people" aria-label="People with access">
          {owner && (
            <li className="pli-share-person">
              <Avatar user={owner} size={32} />
              <span className="pli-share-name">
                <span>{owner.name}{client.users.current?.id === owner.id ? " (you)" : ""}</span>
                {owner.email && <small>{owner.email}</small>}
              </span>
              <span className="pli-share-owner">Owner</span>
            </li>
          )}
          {rows.map((grant) => {
            const who = grant.userId ? client.users.get(grant.userId) : ({ id: grant.email ?? "", name: grant.email ?? "", email: grant.email } as PliUser);
            const key = grant.userId ?? grant.email ?? "";
            return (
              <li key={key} className="pli-share-person">
                <Avatar user={{ ...who, color: who.color }} size={32} />
                <span className="pli-share-name">
                  <span>{who.name}{client.users.current?.id === who.id ? " (you)" : ""}</span>
                  {grant.userId ? who.email && <small>{who.email}</small> : <small>Invited</small>}
                </span>
                {canChange ? (
                  <RoleSelect value={grant.role} roles={roles} label={`Role of ${who.name}`} onChange={(r) => attempt(() => client.setRole({ userId: grant.userId, email: grant.email }, r))} onRemove={() => attempt(() => client.remove({ userId: grant.userId, email: grant.email }))} />
                ) : (
                  <span className="pli-share-owner">{ROLE_LABELS[grant.role]}</span>
                )}
              </li>
            );
          })}
        </ul>

        <h3 className="pli-share-heading">General access</h3>
        <div className="pli-share-link">
          <span className="pli-share-link-icon" data-open={link.enabled || undefined} aria-hidden="true">
            {link.enabled ? CollabIcons.globe : CollabIcons.lock}
          </span>
          <span className="pli-share-link-text">
            <select
              className="pli-role-select pli-share-audience"
              aria-label="Who can open the link"
              disabled={!canLink}
              value={!link.enabled ? "off" : (link.audience ?? "anyone")}
              onChange={(e) => attempt(() => (e.target.value === "off" ? client.setLink({ enabled: false }) : client.setLink({ enabled: true, audience: e.target.value as "anyone" | "signed-in" })))}
            >
              <option value="off">Restricted</option>
              <option value="anyone">Anyone with the link</option>
              <option value="signed-in">Signed-in people with the link</option>
            </select>
            <small>{link.enabled ? ROLE_HINTS[link.role] : "Only people added above can open this"}</small>
          </span>
          {link.enabled && <RoleSelect value={link.role} roles={roles} disabled={!canLink} label="What people with the link can do" onChange={(r) => attempt(() => client.setLink({ role: r }))} />}
        </div>
      </div>
    </Dialog>
  );
}
