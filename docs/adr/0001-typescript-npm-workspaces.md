# ADR 0001: TypeScript and npm workspaces

- Status: accepted
- Date: 2026-10-04
- Issue: L-001

## Context

Lectio is a static site, a set of content gates, a local research CLI and a handful of libraries (references,
corpora, calendar, providers). They share types (the content schema above all) and are developed in parallel by
several agents, one pull request each. The mobile apps are Flutter, but everything else should share one language
and one toolchain.

## Decision

- TypeScript (strict, `noUncheckedIndexedAccess`, ES2023, NodeNext) on Node 22, ESM only (`"type": "module"`).
- One repository, npm workspaces `apps/*` and `packages/*`; packages are named `@lectio/<dir>`.
- Packages export their `src/*.ts` directly; there is no build step for libraries. Tests run through vitest, CLIs
  through tsx.
- Vitest at the root (one project per package), ESLint flat config with typescript-eslint, Prettier.
- L-001 writes every planned workspace manifest, its dependencies and its scripts, and the lockfile, once for the
  whole roadmap, so parallel issues add source files without touching shared manifests.

## Consequences

- One `npm ci` installs everything; one `npm run verify` checks everything.
- npm workspaces are the least exotic option (no pnpm/yarn/turbo to learn); the cost is less caching, which this
  repository's size does not need.
- Pre-declaring dependencies means a package may list a dependency before its code uses it.
- Flutter (apps/mobile) sits in the same repository but outside the npm toolchain; it has its own CI workflow.
