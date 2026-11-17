---
title: PliScripts
description: Scripts that read and change documents in a Pli editor. Planned.
sidebar:
  badge:
    text: Planned
    variant: caution
---

**Status:** planned, number 8 on the [roadmap](/roadmap/). The session that scripts drive is built. The sandboxed runtime is not.

PliScripts lets the people using an app built on Pli write code that reads and edits their own documents.

## Planned scope

- A script-facing document API, such as `doc.blocks()` and `block.format()`
- Scripts that create documents and add content to them
- Custom menu items and triggers (on open, on edit)
- TypeScript definitions for autocomplete
- A switch for developers to turn scripting off

The full list is on the [Pli.Scripts roadmap](/scripts/roadmap/).

## How it will be offered

Like [Documents](/documents/), PliScripts will come in two layers:

- **Ready-made UI:** a code editor where users write custom scripts for the editor. Developers can turn it off with a boolean option.
- **Build your own:** a headless engine on the same operations, selection and history foundation as Documents, so you can drive it from your own interface, from Swift or Kotlin code, or from a script.

It will run on the same portable engine as every other editor ([Architecture](/platform/architecture/)).
