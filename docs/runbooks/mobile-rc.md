# Runbook: the mobile release candidate

Phase 3 ends with an installable build of the Flutter app (`apps/mobile`), made by CI without store secrets (L-117,
issue #99). This page records the release candidate: the commit, the CI runs and their artifacts, what was tested, and
what is still missing before a store release. The release pipeline itself is described in the
[fastlane README](../../apps/mobile/fastlane/README.md).

## The candidate

|             |                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Commit      | `f14c8bf0e5e099f9da3ae4a0ab396425c7f47b63` on `main` (L-109: Mobile release pipelines, PR #258)           |
| Flutter run | https://github.com/nyabongo/lectio/actions/runs/37357017081 (`push` to `main`; `flutter` and `ios` green) |
| Recorded    | 2026-10-05                                                                                                |

Artifacts attached to that run (GitHub keeps them for 14 days, so download them before 2026-10-19):

| Artifact                | What it is                                                     | Job                                                                                       |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lectio-debug-apk`      | `app-debug.apk`, Android debug build (95 MB zipped)            | [`flutter`](https://github.com/nyabongo/lectio/actions/runs/37357017081/job/111921894472) |
| `lectio-ios-debug`      | `Runner.app`, iOS `--no-codesign --debug` build (50 MB zipped) | [`ios`](https://github.com/nyabongo/lectio/actions/runs/37357017081/job/111924806584)     |
| `flutter-coverage-lcov` | `lcov.info` of the Dart tests                                  | `flutter`                                                                                 |
| `flutter-goldens`       | the golden screenshots the tests compared against              | `flutter`                                                                                 |

The APK is debug-signed and installs on any Android device or emulator with "install unknown apps" allowed
(`adb install app-debug.apk`). The iOS `Runner.app` is a `--no-codesign` debug build: it proves the committed `ios/`
project compiles, but it does not install on a device until it is signed.

To make a new candidate, merge to `main` (a change under `apps/mobile`, the schema fixtures, the string catalogs or
`flutter.yml` runs the full `flutter` and `ios` jobs) or run the Flutter workflow by hand from the Actions tab, then
replace the tables above.

## Release dry run (L-109)

The Mobile release workflow (`.github/workflows/mobile-release.yml`) builds both apps the way a release would, with no
secret referenced by any job. Its dry run is a `workflow_dispatch`: Actions → Mobile release → Run workflow, on `main`.

|          |                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Dry run  | https://github.com/nyabongo/lectio/actions/runs/37352978073                                                                    |
| Commit   | `343c343` on the L-109 branch (PR #258), through a temporary `push` trigger since reverted                                     |
| Jobs     | `plan`, `android`, `ios` and `merge-rule` green; `secrets`, `android-release`, `ios-release` skipped (no secrets on a dry run) |
| Artifact | `lectio-aab-debug-signed` (Android app bundle, debug-signed, 59 MB)                                                            |

The workflow file in that run is the one merged to `main` in `f14c8bf`, apart from the temporary trigger line. The
app code differs: `main` also has PR #256 (Listen segments). No dispatch of the dry run on `main` has been recorded yet,
because starting workflow runs was outside what the L-117 agent was permitted to do. The owner can start one from the Actions tab (it reads
no secrets) and add its link here.

## What was tested

There is no physical device or emulator in the environment that made this candidate, so **nothing was smoke-tested by
hand on a device**. What ran, all in CI on Linux (Android) or macOS (iOS) runners:

- `flutter analyze`, `dart format` and the l10n sync check (`tool/sync_l10n.dart --check`).
- `flutter test --coverage`: the unit and widget tests under `apps/mobile/test`, including the golden screenshots
  (`test/goldens/screens/`, drawn on Linux), the contrast and accessibility checks (tap targets, labels) and the English
  and Kiswahili localization tests. Run 37357017081: 922 tests passed.
- The Dart coverage gate (`tool/check_coverage.dart`, minimum 96%): 99.91% of `lib/` lines (3347/3350).
- `flutter build apk --debug` (with the bundle id check) and `flutter build ios --no-codesign --debug` (with the
  committed `ios/` project, Info.plist keys and an unchanged-project check).
- The release dry run above: `fastlane android build` (app bundle) and `flutter build ipa --no-codesign`, and the store
  metadata drafts check.

Not tested:

- Installing and launching the APK or the iOS app on a device or emulator; there are no `integration_test` (on-device)
  tests in the app yet.
- Background audio, lock-screen controls, text-to-speech voices, the daily notification firing, and share and deep
  links on a real OS. The widget tests use fakes for these platform plugins.
- Signed builds, and any upload to Play or TestFlight.

## Known gaps

- **No signing or store secrets.** None of the 11 secrets listed in the
  [fastlane README](../../apps/mobile/fastlane/README.md#secrets-owner) exist, so a `mobile-v*` tag would build, skip
  signing and upload, and say so in the job summary.
- **No store upload.** Store submission is out of scope for L-117. The first Play bundle must be uploaded by hand in the
  Play Console ([the owner's first release](../../apps/mobile/fastlane/README.md#the-owners-first-release)), and App
  Store Connect needs a privacy policy URL, which the site does not have yet. The store metadata drafts are English
  only.
- **Owner steps from PR #258** (repository settings, not done by agents):
  - a protected `mobile-release` environment holding the 11 store secrets, with a deployment rule for `mobile-v*` tags
    only (optionally a required reviewer), declared as `environment: mobile-release` on the `secrets`,
    `android-release` and `ios-release` jobs;
  - a tag ruleset restricting who can create `mobile-v*` tags.

  Until both exist, the workflow's "tag on `main`" check is advisory.

- **Universal links** need `Runner.entitlements` and the matching App Store profile ([apps/mobile
  README](../../apps/mobile/README.md#share-and-deep-links-l-107)).
- **No native-speaker review of the Kiswahili text.** The app's Kiswahili strings come from the site's catalogs
  (L-110, L-114) and have not been read by a native speaker.
- **`flutter` is not a required check yet.** The `main` ruleset's required status checks list is empty, although
  `.github/required-checks/flutter.json` registers the `flutter` job. Re-running
  [`scripts/repo/setup.sh`](../../scripts/repo/setup.sh) is an owner step (it changes repository settings); see
  [Repository settings and branch protection](../operator-handbook.md#repository-settings-and-branch-protection).

## L-117 acceptance criteria

| Criterion                                                                       | State                                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `flutter.yml` green on `main`, with a debug APK and an iOS no-codesign artifact | Met: run 37357017081, `flutter` and `ios` green, `lectio-debug-apk` and `lectio-ios-debug` attached               |
| L-109 dry run green                                                             | Partly met: green on the L-109 branch (run 37352978073); the owner must dispatch it on `main`                     |
| `setup.sh` re-run after L-100 merged; `flutter` appears as a required check     | **Not met**: an owner step (see above)                                                                            |
| Dart line coverage ≥ 96%, TypeScript unit coverage ≥ 96%, CI green              | Met: Dart 99.91% (run 37357017081); TypeScript 99.99 / 99.99 / 100 / 100 (statements, branches, functions, lines) |
