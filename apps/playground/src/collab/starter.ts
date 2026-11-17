import { createDoc, heading, listItem, paragraph, quote, setIdGenerator, subtitle, text, title, type Doc } from "@pli.dev/docs";

/** The paragraph each teammate types in, by user id. */
export const NOTES: Record<string, string> = { u_ben: "notes_ben", u_cleo: "notes_cleo", u_dev: "notes_dev" };

/** Builds a document with the same block ids every time, so a comment made in one tab points at the same text in another. */
export function withStableIds<T>(build: () => T): T {
  let n = 0;
  setIdGenerator(() => `lab${(n++).toString(36)}`);
  try {
    return build();
  } finally {
    setIdGenerator(() => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4));
  }
}

const note = (id: string, who: string, color: string): ReturnType<typeof paragraph> => ({ ...paragraph([text(`${who}: `, { bold: true, color })]), id });

export function labDocument(): Doc {
  return withStableIds(() =>
    createDoc("Q3 planning sync", [
      title("Q3 planning sync"),
      subtitle("Shared notes: everyone in the room can see this page"),
      quote("Try it: select some words and add a comment (Ctrl/Cmd+Alt+M), or just start typing. Your teammates are in this document too."),
      heading(1, "Agenda"),
      listItem("bullet", "Review last quarter's launch"),
      listItem("bullet", "Pick the three projects for Q3"),
      listItem("bullet", "Decide who owns what"),
      heading(1, "Discussion"),
      paragraph(
        "The launch went better than we planned for: signups were up by a third in the first week, and support tickets stayed flat. The onboarding checklist is the most likely reason, and we should keep it as it is.",
      ),
      paragraph(
        "For next quarter we want fewer, bigger bets. The shortlist is a faster editor, a public API for exports, and a rebuilt settings page. Each needs an owner and a rough date before the end of the week.",
      ),
      paragraph(
        "Pricing is the open question. Some of us want to keep the free plan as it is; others think it should have a smaller limit. We should look at the numbers before deciding anything.",
      ),
      heading(1, "Action items"),
      listItem("bullet", "Ana to draft the Q3 roadmap"),
      listItem("bullet", "Ben to size the export API"),
      listItem("bullet", "Cleo to collect settings page feedback"),
      heading(1, "Notes from the team"),
      note(NOTES.u_ben!, "Ben", "#1c7ed6"),
      note(NOTES.u_cleo!, "Cleo", "#c2255c"),
      note(NOTES.u_dev!, "Dev", "#2f9e44"),
      paragraph(""),
    ]),
  );
}
