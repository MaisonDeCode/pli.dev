import { useMemo, useRef, useState } from "react";
import { presentUsers, userColor, userInitials, type Peer, type PliUser, type PresenceActivity, type PresentUser } from "@pli.dev/core";
import { CollabIcons } from "./icons";
import { Popover } from "./popover";

/** A person's picture, or their initials on their color. */
export function Avatar({ user, size = 24, color, activity }: { user: PliUser; size?: number; /** Overrides the person's colour (an assigned presence colour). */ color?: string; /** Fades the avatar of someone who is idle or away. */ activity?: PresenceActivity }) {
  return (
    <span className="pli-avatar" data-activity={activity && activity !== "active" ? activity : undefined} style={{ width: size, height: size, background: user.avatar ? undefined : (color ?? user.color), fontSize: size * 0.4 }} title={activity && activity !== "active" ? `${user.name} (${activity})` : user.name} aria-label={user.name} role="img">
      {user.avatar ? <img src={user.avatar} alt="" /> : userInitials(user)}
    </span>
  );
}

const ACTIVITY_LABEL: Record<PresenceActivity, string> = { active: "", idle: "idle", away: "away" };

export interface AvatarStackProps {
  /** The people to show, you left out: `presentUsers(peers, you)` or `usePresentUsers(room, you)`. */
  people: readonly PresentUser[];
  /** How many avatars to show before "+N". Default 4. */
  max?: number;
  size?: number;
  /** Called with a person chosen from the full list. */
  onSelect?: (person: PresentUser) => void;
}

/**
 * Overlapping avatars of the people in a file, each with a ring in their colour, faded when they are idle or away, and a
 * "+N" that opens the whole list. The group has the name "N other people here".
 */
export function AvatarStack({ people, max = 4, size = 26, onSelect }: AvatarStackProps) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="pli-presence" role="group" aria-label={`${people.length} other ${people.length === 1 ? "person" : "people"} here`}>
      {shown.map((p) => (
        <Avatar key={p.user.id} user={p.user} size={size} color={p.color} activity={p.activity} />
      ))}
      {rest > 0 && (
        <>
          <button ref={more} type="button" className="pli-avatar pli-avatar-more" style={{ width: size, height: size }} aria-haspopup="dialog" aria-expanded={open} aria-label={`${rest} more ${rest === 1 ? "person" : "people"}`} onClick={() => setOpen((v) => !v)}>
            +{rest}
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchor={more} label="People here" align="end">
            <ul className="pli-people-list">
              {people.map((p) => (
                <li key={p.user.id}>
                  <button type="button" className="pli-people-item" onClick={() => (onSelect?.(p), setOpen(false))} disabled={!onSelect}>
                    <Avatar user={p.user} size={24} color={p.color} activity={p.activity} />
                    <span className="pli-people-name">{p.user.name}</span>
                    {p.activity !== "active" && <span className="pli-people-state">{ACTIVITY_LABEL[p.activity]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        </>
      )}
    </div>
  );
}

/** Who else is in the file, as a row of pictures. The ready-made one for a toolbar: pass the room's `peers` and the current user. */
export function PresenceBar({ peers, you, max, size }: { peers: readonly Peer[]; you?: PliUser | null; max?: number; size?: number }) {
  // One person with two tabs open is one person. Colours are the people's own, so they match the cursors drawn for them.
  const people = useMemo(
    () => presentUsers(peers, you).map((p) => ({ ...p, color: p.user.color ?? userColor(p.user.id) })),
    [peers, you],
  );
  return <AvatarStack people={people} max={max} size={size} />;
}

/** The icon-only "people here" mark used where there is no room for faces. */
export const PeopleIcon = CollabIcons.people;
