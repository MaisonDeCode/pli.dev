# @pli.dev/core

The pieces every Pli editor shares: operation sessions with undo and redo, ids and errors, people, comments, live editing over your own transport, file storage, version history and fonts. It has no screen and no DOM.

Website and documentation: [pli.dev](https://pli.dev)

## Install

```sh
npm install @pli.dev/core
```

Each editor package already depends on this one, so you only install it yourself when your own code imports from it, for example to set up comments, people or live editing. No peer dependencies. Runs in browsers, in Node 20 or later and in web views. ESM only, with TypeScript types. With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names.

## Example

```ts
import { Session, createId, type Reducer } from "@pli.dev/core";

type Counter = { count: number };
type Op = { add: number };

// A reducer applies one operation and returns the operation that undoes it.
const counter: Reducer<Counter, Op> = {
  apply: (state, op) => ({ state: { count: state.count + op.add }, inverse: { add: -op.add } }),
};

const session = new Session<Counter, Op>({ count: 0 }, counter);
session.subscribe(({ state }) => console.log(state.count));

session.transact([{ add: 2 }]);   // logs 2
session.undo();                   // logs 0

createId("note_");                // a new unique id, "note_..."
```

## Documentation

- [Architecture](https://pli.dev/platform/architecture/)
- [Comments](https://pli.dev/platform/comments/), [users](https://pli.dev/platform/users/), [realtime](https://pli.dev/platform/realtime/) and [live editing](https://pli.dev/platform/live-editing/)
- [Fonts](https://pli.dev/platform/fonts/)
- [Package names](https://pli.dev/platform/package-names/)

## License

Apache-2.0.

Part of [Pli](https://pli.dev), an open-source editor SDK ([source on GitHub](https://github.com/MaisonDeCode/pli.dev)). All Pli packages are released together and share one version number: see [Releases and versioning](https://pli.dev/platform/contributing/releases/).
