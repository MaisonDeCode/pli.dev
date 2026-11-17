import { useEffect, useReducer } from "react";
import { userInitials, type DocumentSession, type PliUser, type SuggestionInfo } from "@pli.dev/docs";
import { Avatar, timeAgo } from "./comments";
import { Icons } from "./icons";
import { useSessionRevision } from "../hooks";

export interface SuggestionsPanelProps {
  session: DocumentSession;
  onClose: () => void;
}

/** The suggestions in the document, in the order they appear, each to accept or reject by the people who may. */
export function SuggestionsPanel({ session, onClose }: SuggestionsPanelProps) {
  useSessionRevision(session);
  const users = session.suggestionUsers;
  const list = session.suggestions;
  // Ask the directory about everyone at once, and draw again when it has answered.
  const [, answered] = useReducer((n: number) => n + 1, 0);
  const authors = list.map((s) => s.by).join(",");
  useEffect(() => users?.subscribe(answered), [users]);
  useEffect(() => users?.prefetch(authors ? authors.split(",") : []), [users, authors]);
  const person = (id: string): PliUser => users?.get(id) ?? { id, name: id };
  const canAcceptAny = list.some((s) => session.canResolveSuggestion(s, "accept"));
  const canRejectAny = list.some((s) => session.canResolveSuggestion(s, "reject"));

  const show = (s: SuggestionInfo) => {
    const end = Math.min(s.from + s.text.length, s.from + 1000);
    session.select({ anchor: { block: s.block, offset: s.from }, focus: { block: s.block, offset: end } });
  };

  return (
    <aside className="pli-comments pli-suggestions" aria-label="Suggestions">
      <div className="pli-comments-head">
        <strong>Suggestions</strong>
        <span className="pli-comments-count">{list.length}</span>
        <button type="button" className="pli-tool" aria-label="Close suggestions" onClick={onClose}>
          {Icons.close}
        </button>
      </div>
      {list.length > 1 && (canAcceptAny || canRejectAny) && (
        <div className="pli-suggestion-bulk">
          {canAcceptAny && (
            <button type="button" className="pli-button" onClick={() => session.acceptAllSuggestions()}>
              Accept all
            </button>
          )}
          {canRejectAny && (
            <button type="button" className="pli-button" onClick={() => session.rejectAllSuggestions()}>
              Reject all
            </button>
          )}
        </div>
      )}
      {list.length === 0 && (
        <p className="pli-comments-note">{session.canSuggest ? "Turn on Suggesting and your edits will appear here for someone to accept." : "No suggestions yet."}</p>
      )}
      <ul className="pli-thread-list">
        {list.map((s) => {
          const author = person(s.by);
          return (
            <li key={s.id} className="pli-thread pli-suggestion" data-kind={s.kind} data-suggestion={s.id}>
              <div className="pli-comment-head">
                <Avatar user={{ ...author, color: author.color }} size={22} />
                <span className="pli-comment-author">{author.name || userInitials(author)}</span>
                <time className="pli-comment-time" dateTime={new Date(s.at).toISOString()} title={new Date(s.at).toLocaleString()}>
                  {timeAgo(s.at)}
                </time>
              </div>
              <button type="button" className="pli-thread-quote pli-suggestion-text" onClick={() => show(s)} aria-label="Go to the suggested text">
                <span className="pli-suggestion-kind">{s.kind === "insert" ? "Add" : "Delete"}</span>{" "}
                <span className={s.kind === "delete" ? "pli-suggestion-struck" : undefined}>{s.text.length > 120 ? `${s.text.slice(0, 120)}…` : s.text}</span>
              </button>
              <div className="pli-thread-actions">
                {session.canResolveSuggestion(s, "reject") && (
                  <button type="button" className="pli-button" onClick={() => session.rejectSuggestion(s.id)}>
                    Reject
                  </button>
                )}
                {session.canResolveSuggestion(s, "accept") && (
                  <button type="button" className="pli-button pli-button-primary" onClick={() => session.acceptSuggestion(s.id)}>
                    Accept
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
