import type { PliUser, UserDirectory } from "@pli.dev/docs";

/** The person at the keyboard. */
export const ME: PliUser = { id: "u_you", name: "Alex Morgan" };

/** Simulated teammates who live in the lab and can be sent into the document. */
export const TEAM: PliUser[] = [
  { id: "u_ben", name: "Ben Ito" },
  { id: "u_cleo", name: "Cleo Park" },
  { id: "u_dev", name: "Dev Patel" },
];

/** Who a second browser tab is, when you invite someone. */
export const GUESTS: PliUser[] = [
  { id: "u_mia", name: "Mia Chen" },
  { id: "u_noah", name: "Noah Okafor" },
  { id: "u_zoe", name: "Zoe Larsen" },
];

export const EVERYONE = [ME, ...TEAM, ...GUESTS];

/**
 * What an app gives Pli so it can show people: here, a list in memory. In a real app `lookup` asks your server
 * and `search` powers @mentions.
 */
export function directory(current: PliUser): UserDirectory {
  return {
    current,
    lookup: (ids) => EVERYONE.filter((p) => ids.includes(p.id)),
    search: (query) => EVERYONE.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
  };
}

export const nameOf = (id: string) => EVERYONE.find((p) => p.id === id)?.name ?? id;
