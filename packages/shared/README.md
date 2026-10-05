# @lectio/shared

Small helpers every package may use, the logic behind the repo tooling in `scripts/`, and the template for new
packages.

## API

| Import                            | Exports                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@lectio/shared`                  | `assertNever`, `Result<T, E>` (`ok`, `err`, `isOk`, `isErr`, `unwrap`, `mapResult`), `IsoDate`, `isIsoDate`, `addDays`, `dateRange`, `toIsoDateInZone` |
| `@lectio/shared/test-server`      | `server`: the msw server started by the root `vitest.setup.ts` (offline guard)                                                                         |
| `@lectio/shared/coverage-floor`   | `checkCoverageFloor` (used by `npm run coverage:floor`)                                                                                                |
| `@lectio/shared/coverage-summary` | `renderCoverageSummary` (CI job summary)                                                                                                               |
| `@lectio/shared/required-checks`  | `validateRequiredChecks` (used by `npm run required-checks`)                                                                                           |
| `@lectio/shared/planned-script`   | `planScriptRun` (used by `scripts/run-planned.mjs`), `checkRootScripts`                                                                                |

## Template for a new package

```
packages/foo/
  package.json      name "@lectio/foo", "private": true, "type": "module",
                    "exports": { ".": "./src/index.ts" }, "scripts": { "typecheck": "tsc -p tsconfig.json" }
  tsconfig.json     { "extends": "../../tsconfig.base.json", "include": ["src/**/*"] }
  src/index.ts      the public API (relative imports end in .ts)
  src/*.test.ts     vitest tests next to the code
```

Run `npm install` once to link it. Typecheck, lint, format, vitest and coverage pick it up with no root config
change; vitest names the project after the package (`npx vitest --project @lectio/foo`).
