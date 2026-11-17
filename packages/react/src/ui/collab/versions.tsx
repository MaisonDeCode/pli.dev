import { useState } from "react";
import { describeActivity, type ActivityFeed, type NamedVersion, type VersionHistory } from "@pli.dev/core";
import { Avatar } from "./people";
import { timeAgo } from "./threads";
import { useActivity, useVersions } from "./hooks";
import { CollabIcons } from "./icons";

export interface VersionHistoryPanelProps<S, O> {
  history: VersionHistory<S, O>;
  /** The version being previewed, if the editor shows one. */
  activeId?: string | null;
  /** Called when a version is chosen to look at (or null to go back to the current file). */
  onPreview?: (version: NamedVersion<S> | null) => void;
  /** Called after a restore, with the version that was restored. */
  onRestored?: (version: NamedVersion<S>) => void;
  onClose?: () => void;
  /** Who the versions' authors are. Defaults to the history's users. */
  title?: string;
}

/**
 * Version history as a side panel: name the current version, and see every named version with who saved it and when. A
 * version can be previewed, compared with the file now ("12 cells changed"), and restored, which is an ordinary undoable edit.
 */
export function VersionHistoryPanel<S, O>({ history, activeId, onPreview, onRestored, onClose, title = "Version history" }: VersionHistoryPanelProps<S, O>) {
  const versions = useVersions(history);
  const users = history.users;
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = history.canEdit;

  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };

  return (
    <aside className="pli-versions" aria-label={title}>
      <div className="pli-comments-head">
        <strong>{title}</strong>
        {onClose && (
          <button type="button" className="pli-tool" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            {CollabIcons.close}
          </button>
        )}
      </div>
      {canEdit && (
        <form
          className="pli-version-name"
          onSubmit={(event) => {
            event.preventDefault();
            const text = name.trim();
            if (!text) return;
            void attempt(async () => {
              await history.save(text);
              setName("");
            });
          }}
        >
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the current version" aria-label="Name for the current version" />
          <button type="submit" className="pli-button pli-button-primary" disabled={!name.trim()}>
            Save
          </button>
        </form>
      )}
      {error && (
        <p className="pli-comments-note" role="alert">
          {error}
        </p>
      )}
      {history.status === "error" && (
        <p className="pli-comments-note" role="alert">
          Versions couldn't be loaded.{" "}
          <button type="button" className="pli-link-button" onClick={() => void history.reload()}>
            Try again
          </button>
        </p>
      )}
      <ul className="pli-version-list">
        {versions.map((version) => {
          const who = users?.get(version.by);
          const changed = activeId === version.id ? history.compare(version.id).lines : [];
          return (
            <li key={version.id} className="pli-version" data-active={activeId === version.id || undefined} data-automatic={version.automatic || undefined}>
              <button type="button" className="pli-version-main" aria-pressed={activeId === version.id} onClick={() => onPreview?.(activeId === version.id ? null : version)}>
                <span className="pli-version-name-text">{version.name}</span>
                <span className="pli-version-meta">
                  {who && <Avatar user={who} size={16} />}
                  <time dateTime={new Date(version.at).toISOString()} title={new Date(version.at).toLocaleString()}>
                    {timeAgo(version.at)}
                  </time>
                  {who && <span>· {who.name}</span>}
                </span>
                {version.note && <span className="pli-version-note">{version.note}</span>}
              </button>
              {changed.length > 0 && (
                <ul className="pli-version-changes" aria-label="Changes since this version">
                  {changed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="pli-version-actions">
                  {confirming === version.id ? (
                    <>
                      <span role="alert">Replace the current file with this version?</span>
                      <button
                        type="button"
                        className="pli-link-button"
                        onClick={() =>
                          void attempt(async () => {
                            const restored = await history.restore(version.id);
                            setConfirming(null);
                            onRestored?.(restored);
                          })
                        }
                      >
                        Restore
                      </button>
                      <button type="button" className="pli-link-button" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="pli-link-button" onClick={() => setConfirming(version.id)}>
                        <span aria-hidden="true">{CollabIcons.restore}</span> Restore this version
                      </button>
                      {!version.automatic && (
                        <button type="button" className="pli-link-button pli-danger" aria-label={`Delete ${version.name}`} onClick={() => void attempt(() => history.remove(version.id))}>
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {versions.length === 0 && history.status === "ready" && <p className="pli-comments-note">No named versions yet. Name the current version to keep a copy you can come back to.</p>}
    </aside>
  );
}

/** The activity feed as a list of sentences, newest first. */
export function ActivityList({ feed, limit = 50, onSelect, title = "Activity" }: { feed: ActivityFeed; limit?: number; onSelect?: (ref: string, kind: string) => void; title?: string }) {
  const events = useActivity(feed).slice(0, limit);
  return (
    <section className="pli-activity" aria-label={title}>
      <div className="pli-comments-head">
        <strong>{title}</strong>
      </div>
      <ul className="pli-activity-list">
        {events.map((event) => {
          const who = event.user ? feed.users.get(event.user) : null;
          return (
            <li key={event.id} className="pli-activity-item">
              {who ? <Avatar user={who} size={22} /> : <span className="pli-activity-icon" aria-hidden="true">{CollabIcons.activity}</span>}
              <span className="pli-activity-text">
                {event.ref && onSelect ? (
                  <button type="button" className="pli-link-button" onClick={() => onSelect(event.ref!, event.kind)}>
                    {describeActivity(event, feed.users)}
                  </button>
                ) : (
                  describeActivity(event, feed.users)
                )}
                {event.excerpt && <q className="pli-activity-excerpt">{event.excerpt}</q>}
                <time dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()}>
                  {timeAgo(event.at)}
                </time>
              </span>
            </li>
          );
        })}
      </ul>
      {events.length === 0 && <p className="pli-comments-note">Nothing has happened yet.</p>}
    </section>
  );
}
