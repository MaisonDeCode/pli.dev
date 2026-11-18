# Releasing

How the `@pli.dev/*` packages get to npm. Written for the people who publish them.

## What is published

Nine packages, always at the same version (Changesets "fixed" group in `.changeset/config.json`):

`@pli.dev/core`, `@pli.dev/docs`, `@pli.dev/react`, `@pli.dev/sheets`, `@pli.dev/sheets-react`, `@pli.dev/decks`, `@pli.dev/decks-react`, `@pli.dev/pdf`, `@pli.dev/pdf-react`

`@pli.dev/native`, `@pli.dev/editor-host` and `@pli.dev/skill` are private: they build the scripts and pages inside the Swift and Kotlin packages and the agent skill. The Swift and Kotlin packages are not on npm.

## How the packages are built

Inside the repository every package exports its TypeScript source (`"exports": { ".": "./src/index.ts" }`), so the editor, the site, the playground and the tests always run the code you are editing, with no build step.

Each package has a `publishConfig` that replaces those fields when the package is packed: `exports`, `main`, `module` and `types` then point into `dist/`. `pnpm pack` and `pnpm publish` apply it, and `npm publish` does not, so always publish with pnpm (the scripts below do).

`pnpm build` runs [tsup](https://tsup.egoist.dev) in each package (`tsup.config.ts`, shared options in `scripts/tsup-shared.ts`). It writes ES modules, a `.d.ts` for each entry, and `styles.css` with its imports inlined. Dependencies stay imports and nothing is bundled in. Internal dependencies are `workspace:^`; pnpm turns them into `^1.x.y` when it packs.

## Making a change

```bash
pnpm changeset          # pick the packages, patch / minor / major, write one sentence
```

Commit the file in `.changeset/` with the change. Breaking changes (see "Releases and versioning" in the docs) are a major.

## Releasing

CI does it. When changesets are on `main`, the `release` workflow opens a pull request called "Version packages" that bumps the versions and writes `CHANGELOG.md` in each package. Merging it publishes with `pnpm release`, with npm provenance, and creates a GitHub release.

To see exactly what would be published, without publishing:

```bash
pnpm release:dry
```

This builds, runs `pnpm release:check` (see below), and runs `pnpm publish --dry-run` for every package.

By hand, from a clean checkout of `main`, logged in to npm with an account that can publish to `@pli.dev` (this publishes for real):

```bash
pnpm install --frozen-lockfile
pnpm release
```

### Release history

`1.0.0` was the first release: the versions in the repository were already `1.0.0`, so `pnpm release` published all nine packages and tagged each one (`@pli.dev/docs@1.0.0`). Every release after that goes through a changeset, as above. `changeset publish` publishes every package whose version is not on npm yet, so running `pnpm release` again after a failure carries on where it stopped.

## The check before publishing

`pnpm release:check` (`scripts/check-publish.mjs`) fails when:

- a `package.json` field is missing or wrong: license, repository, homepage, bugs, keywords, engines, `publishConfig`, `sideEffects`, `files`, version;
- the `LICENSE` copy in a package differs from the root one, or the README is missing;
- a dependency on another package is not a `workspace:` range, or points at a private or missing package;
- `dist` is missing, or a file named in `publishConfig.exports` is not there, or an entry has no types;
- built code imports something that is not in `dependencies` or `peerDependencies`, reaches into another package's `src`, has an absolute path in it, or still has the old `@pli/` scope;
- source code imports a package it does not declare, or another package's source by path;
- the tarball made by `pnpm pack` holds anything outside `dist`, the README, the LICENSE and the changelog (tests, fixtures, source, maps, env files), the packed `package.json` still has a `workspace:` range or source exports, or `publint --strict` finds an issue.

It also prints the size of every tarball.

## One-time setup

- The `@pli.dev` scope exists on npm and the publishing account is an owner of it.
- A repository secret `NPM_TOKEN`: an npm automation (granular, publish) token for the `@pli.dev` scope, which works with two-factor authentication turned on.
- Provenance works only from GitHub Actions on the public repository; the workflow already has `id-token: write` and `NPM_CONFIG_PROVENANCE=true`.
- Repository setting: Actions may create pull requests (Settings, Actions, General, Workflow permissions).
