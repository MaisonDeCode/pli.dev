# Contributing to Pli

Thank you for helping. This file is the short version. The Contributing section of the docs site has the rest:

- [Contributing overview](https://pli.dev/platform/contributing/): the repository, what each package is for
- [Setting up and running](https://pli.dev/platform/contributing/setup/): the playground, tests, fuzzers and the checks against other programs
- [Working on Pli itself](https://pli.dev/platform/contributing/working-on-pli/): the rules, how to add features, functions, themes, tools and fonts
- [Releases and versioning](https://pli.dev/platform/contributing/releases/)
- [Reporting bugs and proposing changes](https://pli.dev/platform/contributing/bugs-and-changes/)

## Set up

You need Node 20 or later and [pnpm](https://pnpm.io) 10.

```sh
git clone https://github.com/MaisonDeCode/pli.dev.git
cd pli.dev
pnpm install
pnpm test          # unit tests
pnpm typecheck
pnpm playground    # the editors on a dev server at http://localhost:5180
pnpm site:dev      # the docs site at http://localhost:4321
```

## Before you open a pull request

- Run `pnpm test` and `pnpm typecheck`.
- Docs ship with the code: a feature isn't done until it is on the site (`apps/site/src/content/docs`). Anything not finished or not checked goes on the roadmap of its editor.
- The engines stay portable: no DOM, no Node built-ins, plain-JSON state, and every change is an invertible operation.
- If users of the packages would notice the change, add a changeset with `pnpm changeset` and say whether it is a patch, a minor or a major change. The nine published packages share one version number. See [Releases and versioning](https://pli.dev/platform/contributing/releases/).

## Things to know

- `@pli.dev/native`, `@pli.dev/editor-host` and `@pli.dev/skill` are private. They are not published to npm.
- After a change to the engines, `pnpm native` rebuilds the scripts inside the Swift and Kotlin packages, and `pnpm native:test` runs their tests too.
- Please keep names and email addresses of people out of the code and the docs.

## Behaviour

Be kind and specific. The [Code of Conduct](CODE_OF_CONDUCT.md) applies to everything in the project.

## License

By contributing you agree that your work is licensed under the Apache License 2.0, like the rest of Pli.
