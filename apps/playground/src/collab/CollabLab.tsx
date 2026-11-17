import { useEffect, useState, useSyncExternalStore } from "react";
import { userColor, type PliUser } from "@pli.dev/docs";
import { ActivityList, ActivityToasts, Avatar, PliDocument, ToastProvider } from "@pli.dev/react";
import { BackToDemos } from "../BackToDemos";
import type { Teammate } from "./bots";
import { Lab } from "./lab";
import type { WireEvent } from "./wire";

const withColor = (user: PliUser): PliUser => ({ ...user, color: user.color ?? userColor(user.id) });

/**
 * The collaboration playground: your document in a room with simulated teammates. Hit a teammate's buttons, or leave
 * them on autopilot and type alongside them; invite a second tab to be a real second person; and watch what goes over
 * the wire and into your comment store.
 */
export function CollabLab() {
  const [lab] = useState(() => new Lab());
  const [panel, setPanel] = useState(() => !window.matchMedia?.("(max-width: 800px)").matches);

  useEffect(() => {
    lab.start();
    return () => lab.stop();
  }, [lab]);

  return (
    <div className="playground" data-lab={panel || undefined}>
      <ToastProvider>
      <ActivityToasts feed={lab.activity} user={lab.me.id} />
      <PliDocument
        session={lab.session}
        sync={lab.sync}
        room={lab.room}
        share={lab.share}
        history={lab.history}
        autoFocus
        aria-label="Shared document"
        actions={
          <>
            <BackToDemos />
            <button className="output-toggle" onClick={() => setPanel((v) => !v)} aria-pressed={panel}>
              Lab
            </button>
          </>
        }
      />
      {panel && <LabPanel lab={lab} />}
      </ToastProvider>
    </div>
  );
}

function LabPanel({ lab }: { lab: Lab }) {
  const pilot = useSyncExternalStore(lab.subscribe, () => lab.snapshot);
  return (
    <aside className="lab" aria-label="Collaboration lab">
      <header className="lab-head">
        <h2>Collaboration lab</h2>
        <p>
          {lab.guest
            ? `You joined as ${lab.me.name}. The teammates are in the tab that invited you.`
            : "You are in a room with simulated teammates. Each has a connection of their own to the server, so their typing and comments reach you the way a real second person's would, merged with yours."}
        </p>
      </header>

      <Network lab={lab} />

      <Invite lab={lab} />

      {!lab.guest && (
        <section className="lab-section">
          <h3>Teammates</h3>
          <ul className="lab-team">
            {lab.teammates.map((t) => (
              <TeammateCard key={t.user.id} teammate={t} />
            ))}
          </ul>
          <label className="lab-row">
            <input type="checkbox" checked={pilot.autopilot} onChange={(e) => lab.setAutopilot(e.target.checked)} />
            <span>Autopilot: teammates type, comment and edit on their own</span>
          </label>
          <label className="lab-row">
            <span>Pace</span>
            <select value={pilot.pace} onChange={(e) => lab.setPace(Number(e.target.value))} aria-label="Pace">
              <option value={0.6}>Calm</option>
              <option value={1}>Normal</option>
              <option value={2.2}>Busy</option>
            </select>
          </label>
        </section>
      )}

      <ActivityList feed={lab.activity} limit={8} />

      <WireView lab={lab} />

      <footer className="lab-note">
        This all runs through the playground's own server (<code>server/collab-server.ts</code>, started with{" "}
        <code>pnpm playground</code>): Socket.io carries the messages, a sequencer puts everyone's changes in one order, and
        the document and comments are kept there. It forgets them when it stops.
      </footer>
    </aside>
  );
}

/** Whether you can reach the server, and a way to cut yourself off to see what happens to changes made offline. */
function Network({ lab }: { lab: Lab }) {
  const { network } = useSyncExternalStore(lab.subscribe, () => lab.snapshot);
  if (network === "unreachable") {
    return (
      <section className="lab-section lab-warning" role="alert">
        <h3>Can't reach the server</h3>
        <p>
          Live editing needs the playground's collaboration server, which <code>pnpm playground</code> starts with the dev
          server. A static build of the playground doesn't have one.
        </p>
      </section>
    );
  }
  const up = network === "online" || network === "connecting";
  return (
    <section className="lab-section">
      <div className="lab-row lab-network">
        <span className="lab-status">{network === "offline" ? "You are offline" : network === "connecting" ? "Connecting…" : "Connected"}</span>
        <button type="button" className="lab-button" onClick={() => lab.setNetwork(!up)}>
          {up ? "Go offline" : "Reconnect"}
        </button>
      </div>
      {network === "offline" && <p>Keep typing: your changes are kept. When you reconnect they are merged with what everyone did meanwhile.</p>}
    </section>
  );
}

function Invite({ lab }: { lab: Lab }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const make = async () => {
    const url = lab.invitationLink();
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="lab-section">
      <button type="button" className="lab-button lab-primary" onClick={make}>
        Invite someone
      </button>
      {link && (
        <div className="lab-invite">
          <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
          <p>
            {copied ? "Link copied. " : ""}Open it in another tab, window or browser on this machine to join as a second person: you will edit the same
            document, and see each other's cursors and comments.
          </p>
        </div>
      )}
    </section>
  );
}

function TeammateCard({ teammate }: { teammate: Teammate }) {
  const state = useSyncExternalStore(teammate.subscribe, () => teammate.snapshot);
  const user = withColor(teammate.user);
  return (
    <li className="lab-mate" data-here={state.here || undefined}>
      <Avatar user={user} size={30} />
      <div className="lab-mate-text">
        <strong>{user.name}</strong>
        <span className="lab-status">{state.here ? state.status : "Away"}</span>
      </div>
      <button type="button" className="lab-button" onClick={() => (state.here ? teammate.leave() : void teammate.join())}>
        {state.here ? "Send away" : "Bring in"}
      </button>
      <div className="lab-mate-actions">
        <button type="button" className="lab-button" disabled={!state.here} onClick={() => void teammate.type()}>
          Type
        </button>
        <button type="button" className="lab-button" disabled={!state.here} onClick={() => void teammate.comment()}>
          Comment
        </button>
        <button type="button" className="lab-button" disabled={!state.here} onClick={() => void teammate.editYourText()}>
          Edit your text
        </button>
      </div>
    </li>
  );
}

type Filter = "all" | "changes" | "cursors" | "comments" | "store";

const matches = (event: WireEvent, filter: Filter) =>
  filter === "all" ||
  (filter === "changes" && event.kind === "sync") ||
  (filter === "cursors" && (event.kind === "presence" || event.kind === "hello")) ||
  (filter === "comments" && event.kind === "comment") ||
  (filter === "store" && event.dir === "store");

function WireView({ lab }: { lab: Lab }) {
  const events = useSyncExternalStore(lab.wire.subscribe, () => lab.wire.events);
  const [filter, setFilter] = useState<Filter>("changes");
  const [open, setOpen] = useState<number | null>(null);
  const shown = events.filter((e) => matches(e, filter)).slice().reverse();
  return (
    <section className="lab-section lab-wire">
      <div className="lab-wire-head">
        <h3>On the wire</h3>
        <button type="button" className="lab-link" onClick={() => lab.wire.clear()}>
          Clear
        </button>
      </div>
      <div className="lab-filters" role="group" aria-label="Filter">
        {(["changes", "comments", "store", "cursors", "all"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "store" ? "Your store" : f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="lab-empty">Nothing yet. Type something, comment on some text, or wait for a teammate to.</p>}
      <ol className="lab-events">
        {shown.map((event) => (
          <li key={event.id} data-dir={event.dir} data-open={open === event.id || undefined}>
            <button type="button" className="lab-event" onClick={() => setOpen(open === event.id ? null : event.id)} aria-expanded={open === event.id}>
              <span className="lab-dir" title={event.dir === "in" ? "Received from the room" : event.dir === "out" ? "Sent to the room" : "Saved to your CommentStore"}>
                {event.dir === "in" ? "←" : event.dir === "out" ? "→" : "▤"}
              </span>
              <span className="lab-event-text">
                <strong>{event.who}</strong> {event.summary}
                {event.count > 1 && <em> ×{event.count}</em>}
              </span>
            </button>
            {open === event.id && <pre className="lab-json">{JSON.stringify(event.data, null, 2)}</pre>}
          </li>
        ))}
      </ol>
    </section>
  );
}
