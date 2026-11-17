# Changesets

Every change that people who use the packages would notice gets a changeset: a small file that says which packages change and how (patch, minor or major), with a sentence for the changelog.

```bash
pnpm changeset
```

The nine published packages (`@pli.dev/core`, `docs`, `react`, `sheets`, `sheets-react`, `decks`, `decks-react`, `pdf`, `pdf-react`) share one version number. A changeset for any of them moves all of them, so `@pli.dev/docs@1.4.0` always goes with `@pli.dev/react@1.4.0`.

When changesets reach `main`, the release workflow opens a "Version packages" pull request that updates the versions and the changelogs. Merging that pull request publishes to npm. See [RELEASING.md](../RELEASING.md).
