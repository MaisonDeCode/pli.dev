---
title: Animations
description: Entrance, emphasis and exit animations for slide objects, the Motion panel, the JSON model, the session API, and how animations are read from and written to PowerPoint files.
---

An animation changes one object of a slide while the slideshow is running. It brings the object in (**entrance**), draws attention to it (**emphasis**) or takes it away (**exit**). A slide's animations are an ordered list, saved with the slide as plain JSON. Slide-to-slide effects are [transitions](/decks/ready-made-ui/). A slide's animations start after its transition has finished.

## The Motion panel

Select an object and choose **Insert > Animation**, **Slide > Motion…**, the **Motion** button in the toolbar, or **Add animation** in the object's context menu. The Motion panel opens on the right, as the Motion sidebar does in Google Slides and the Animation Pane in PowerPoint.

- **Slide transition** shows the slide's transition, with a button to change it.
- **Object animations** lists the slide's animations in the order they run. Each row has its number, the object (`Title`, `Rectangle`, or the first words of its text), an icon for entrance, emphasis or exit, the effect ("Fly in from left"), when it starts (`Click`, `With prev.`, `After prev.`) and how long it takes. Click a row to select it.
- **Add animation** gives each selected object a fade-in on click. The buttons next to it move the selected animation up or down, duplicate it and remove it. Rows can also be dragged by their grip to a new place.
- **Animation settings** for the selected row: the object it applies to, the type (Entrance, Emphasis, Exit), the effect, the direction (for Fly and Wipe), the amount (Spin: degrees; Grow/Shrink and Pulse: a scale), when it starts, the duration, a delay, a speed curve (linear, ease in, ease out, ease in and out), how many times it repeats, and, for an object with text, whether the text comes **all at once** or **by paragraph**. For a motion path the points are a list of numbers, and can be dragged on the slide too.
- **Play** previews the slide's animations on the canvas, step after step without clicks, then puts the slide back; **Stop** (or Esc) ends it at once. With reduced motion turned on in the system it jumps to the end state instead.

While the panel is open or the object is selected, an animated object shows numbered badges on the canvas (green for an entrance, yellow for emphasis, red for an exit). Click a badge to select that animation in the panel. Slides with animations get a small motion icon on their filmstrip thumbnail. Badges appear only in the editor, never in thumbnails, the slideshow or the PDF.

Everything the panel does goes through the session, so every change is undoable. A read-only editor shows the panel but doesn't let you change anything. Play still works.

| Keys in the animation list | |
| --- | --- |
| Up, Down, Home, End | Select an animation |
| Alt+Up, Alt+Down (or Ctrl/Cmd+Up, Down) | Move it earlier or later |
| Delete, Backspace | Remove it |
| Ctrl/Cmd+D | Duplicate it |

## Kinds, triggers and options

| Class | Effects |
| --- | --- |
| Entrance | Appear, Fade, Fly, Zoom, Wipe, Spin |
| Emphasis | Spin, Pulse, Grow/Shrink, Motion path |
| Exit | Appear, Fade, Fly, Zoom, Wipe, Spin |

| Start | What it does |
| --- | --- |
| On click (`onClick`) | Starts a new step: the presenter's click (or Space, Enter, an arrow key…) runs it. |
| With previous (`withPrevious`) | Starts together with the animation before it. |
| After previous (`afterPrevious`) | Starts when the animation before it has finished. |

| Option | Meaning |
| --- | --- |
| `duration` | Milliseconds (500 by default; Appear is instant). |
| `delay` | Milliseconds to wait before it starts. |
| `easing` | `linear` (default), `easeIn`, `easeOut` or `easeInOut`. |
| `repeat` | How many times it runs, 1 by default. |
| `direction` | Where Fly and Wipe come from (or go to, for an exit): `left`, `right`, `up` (the top) or `down` (the bottom). |
| `amount` | Spin: degrees (360). Grow/Shrink: the scale reached (1.5). Pulse: the scale at the peak (1.1). |
| `path` | Motion path: points in slide points from where the object is, the first being `0, 0`, joined by straight lines. |
| `text` | `paragraph` brings the paragraphs of a text object in one at a time, each with the animation's start: on click is one click per paragraph, after previous is one after another, with previous is all together. The default `all` animates the text as one. |

A slide's animations are grouped into **steps**: each `onClick` animation starts a step, and the `withPrevious` and `afterPrevious` animations after it belong to that step, running by themselves with their delays. If the first animation of a slide is not on click, that first step runs on its own as soon as the slide has appeared.

## Presenting

While presenting, objects whose first animation is an entrance start hidden. Moving forward plays the next step; when none are left, it goes to the next slide. Going back first undoes a step (instantly, with no reverse animation), and only then goes to the previous slide, which opens with all its animations done. Pressing forward while a step is still playing finishes that step instead of skipping one.

| Key | |
| --- | --- |
| Click, Space, Enter, Right or Down arrow, Page Down, `N` | Next animation step, then next slide |
| Left or Up arrow, Page Up, Backspace, `P`, Shift+Space | Back one animation step, then previous slide |
| `A` (or the "Skip animations" button in the slideshow controls) | Finish all the slide's remaining animations |
| Home, End, a number and Enter | Go to that slide, shown as it starts |

When the system asks for reduced motion (`prefers-reduced-motion: reduce`), every step completes the moment it starts, and objects appear in their end state with no movement. `PresentMode` also takes `reduceMotion` to force it on or off and `animations={false}` to show slides as they are drawn in the editor, with all animations ignored. The presenter view shows the same animation state as the main screen, and the next-slide preview shows the next slide as it will first appear.

## The model

Animations are in `slide.animations`, in the order they run, each pointing at a top-level element of the slide by id:

```json
{
  "id": "s_2",
  "layout": "l_titleAndBody",
  "elements": [{ "type": "shape", "id": "e_title" }, { "type": "shape", "id": "e_body" }],
  "animations": [
    { "id": "a_1", "target": "e_title", "class": "entrance", "kind": "fly", "direction": "left", "duration": 600, "easing": "easeOut" },
    { "id": "a_2", "target": "e_body", "class": "entrance", "kind": "fade", "text": "paragraph", "duration": 400 },
    { "id": "a_3", "target": "e_title", "class": "emphasis", "kind": "pulse", "trigger": "afterPrevious", "amount": 1.1 }
  ]
}
```

An animation whose target is gone is dropped with the element, and undo brings both back. Copying and pasting objects, duplicating them, and duplicating a slide carry their animations to the copies. Grouping objects animates the group as a whole: the animations of the first animated member move to the group and the others' are removed.

## From code

```ts
import { DeckSession, buildTimeline, poseAt, finalPoses } from "@pli.dev/decks";

const a = session.addAnimation(slideId, { target: boxId, kind: "fly", direction: "left" });   // an entrance on click
session.addAnimation(slideId, { target: otherId, kind: "fade", trigger: "withPrevious", delay: 200 });
session.updateAnimation(slideId, a.id, { duration: 900, easing: "easeOut", delay: null });    // null goes back to the default
session.moveAnimation(slideId, a.id, "down");                                                 // or an index
session.removeAnimations(slideId, [a.id]);
session.animations(slideId);                                                                  // the list, in order
session.setAnimations(slideId, list);                                                         // replace the whole list
```

Each call is one undoable change. A problem (an unknown target or kind, a motion path with fewer than two points, Pulse as an entrance) throws a `PliError` with the reason. `makeAnimation` fills in what a kind needs (the direction of a Fly, the 360 degrees of a Spin), and `KINDS_BY_CLASS` says which effects fit each class.

To draw animations yourself, `buildTimeline(slide)` gives the steps, `poseAt(slide, { steps, step, t }, frames, size)` says where every animated object is at a moment (visible or not, opacity, offset, scale, rotation, wipe clip, paragraph opacity), and `finalPoses` the state after everything has run. `SlideView` from `@pli.dev/decks-react` takes those poses in its `poses` prop and draws them (rotation composes with the object's own, scale and turn are about its centre, a wipe is a clip); `StepPlayer` is the click-by-click state machine `PresentMode` uses.

## PowerPoint files

Animations are exported as PowerPoint object animations (`p:timing`), so they play in PowerPoint. When a PowerPoint file is opened, its object animations come in as Pli animations; effects PowerPoint has that Pli doesn't are mapped to the nearest and reported as import warnings, shown in the editor's notes banner. See [Files and formats](/decks/files/).

## Limits

- A motion path is straight segments between points: no curves.
- Text builds are by paragraph only (no per-word or per-letter), and paragraphs come in with a fade, whatever the effect.
- Nothing starts by clicking a shape (no triggers other than the three above), and there is no sound.
- A group is animated as a whole; the objects inside it can't be animated one by one.
- Animations belong to slides: layouts and masters can't have them.
