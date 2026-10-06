# Store releases (fastlane)

`.github/workflows/mobile-release.yml` (L-109) builds the app for the stores with the lanes in `Fastfile`:

| Lane                         | What it does                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `check_metadata`             | The store metadata drafts exist, fit the store limits, and iOS privacy is "no data collected". |
| `android build`              | `flutter build appbundle --release`; signed when the workflow passes the upload key.          |
| `android internal`           | Uploads the bundle to the Play **internal testing** track (`PLAY_SERVICE_ACCOUNT_JSON`).      |
| `ios build`                  | `flutter build ipa --release --no-codesign` (dry run).                                        |
| `ios build signed:true`      | Imports the distribution certificate and profile, signs manually, exports an App Store ipa.   |
| `ios beta`                   | Uploads the ipa to **TestFlight** (internal testers) with the App Store Connect API key.      |

fastlane (`2.240.1`) and CocoaPods (`1.17.0`, the version `ios/Podfile.lock` was written with; setup-ruby replaces the
runner's Ruby and its CocoaPods) are pinned in `Gemfile`, Ruby 3.3 in CI. Run lanes from `apps/mobile`:

```sh
BUNDLE_GEMFILE=fastlane/Gemfile bundle install
BUNDLE_GEMFILE=fastlane/Gemfile bundle exec fastlane check_metadata
```

`Gemfile.lock` is committed and CI installs it frozen; a run without it fails. After changing the `Gemfile`, run
`bundle lock --add-platform ruby x86_64-linux arm64-darwin` here and commit the lock.

## When it runs

- **Tag `mobile-v<major>.<minor>.<patch>` on a commit of main**: a release. The tag is the version name; the
  workflow's run number is the build number (Android `versionCode`, iOS `CFBundleVersion`), so every run gets a
  higher one. To retry a failed upload, push a new tag rather than re-running the old run (a re-run reuses its
  number, which the stores reject once a build with it was uploaded).
- **workflow_dispatch** (Actions → Mobile release → Run workflow, any branch): a dry run. It checks the metadata,
  builds a debug-signed release bundle and an unsigned iOS archive. No job of a dispatch run references a secret:
  the secret-presence check runs only on tag pushes, and the signing jobs (`android-release`, `ios-release`) only
  when it found the signing secrets.

A tag run without the secrets below builds what it can and skips signing and upload with a note in the job summary;
it does not fail.

## Secrets (owner)

Repository secrets (Settings → Secrets and variables → Actions). Each step gets only the secrets it uses. The
decoded keystore, `.p12`, profile and export options are created with mode 600 (the step's `umask 077`, the
Fastfile's `write_private_file`), so no other user can read them at any point, and live in `$RUNNER_TEMP` only while
their build step runs (the Fastfile's `ensure` and the step's `trap` delete them; an always-run step deletes them
again with the keychain).

| Secret                                    | What                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64`          | The upload keystore (`.jks`), `base64 -w0 upload-keystore.jks`.            |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD`        | Its store password.                                                        |
| `ANDROID_UPLOAD_KEY_ALIAS`                | The key alias.                                                             |
| `ANDROID_UPLOAD_KEY_PASSWORD`             | The key password.                                                          |
| `PLAY_SERVICE_ACCOUNT_JSON`               | A Google Cloud service account JSON key with release access in Play.       |
| `IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64` | The Apple Distribution certificate and private key as `.p12`, base64.      |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`   | The `.p12` export password (not empty).                                    |
| `IOS_PROVISIONING_PROFILE_BASE64`         | An App Store provisioning profile for `io.github.nyabongo.lectio`, base64. |
| `APP_STORE_CONNECT_API_KEY_ID`            | App Store Connect API key id (role App Manager or higher).                 |
| `APP_STORE_CONNECT_API_ISSUER_ID`         | Its issuer id.                                                             |
| `APP_STORE_CONNECT_API_KEY_P8_BASE64`     | The `.p8` key file, base64.                                                |

The Android key is the **upload key** (Play App Signing holds the app-signing key). It reaches Gradle as the
`android.injected.signing.*` properties, so `android/app/build.gradle.kts` keeps its debug fallback for local
`flutter run --release`. The `android build` lane takes them from `ANDROID_UPLOAD_KEYSTORE_FILE` (the decoded
keystore's path, set by the workflow) and the three `ANDROID_UPLOAD_KEY*` secrets of the same names, and writes them,
escaped for `java.util.Properties` (so a leading space or a backslash survives), to the `gradle.properties` of a
`GRADLE_USER_HOME` of its own: a new directory (mode 700, file mode 600) set only for `flutter build` and deleted
after it. Not `-P` or `GRADLE_OPTS` (the passwords would be on the command line), and not
`ORG_GRADLE_PROJECT_android.injected.signing.*` variables (`gradlew` runs under `/bin/sh`, which drops names with
dots). The Gradle daemon is off and stopped after the build, and the bundle's signer must match the upload key's
SHA-256 fingerprint. The helpers are in `lib/lectio_signing.rb`; `ruby test/lectio_signing_test.rb` (run by
`ci.yml`) tests them, including a round trip through Java. The team id and profile name come
from the provisioning profile itself.

Repository variable `PLAY_RELEASE_STATUS` (optional): the Play release status, `draft` by default. Play only accepts
draft releases until the app has a reviewed release; afterwards set it to `completed` so internal testers get the
build without a click in the Play Console.

## The owner's first release

1. Play Console: create the app (package `io.github.nyabongo.lectio`), enrol in Play App Signing, and upload the
   first bundle by hand (the Play API cannot create the first release). A signed bundle from a tag run is in the
   `lectio-release-aab` artifact. Invite the service account with release permissions.
2. App Store Connect: create the app with bundle id `io.github.nyabongo.lectio`, then the API key above.
3. Add the secrets and push `mobile-v0.1.0` (or the next version) on main.

Store review and the first real upload are outside L-109.

Hardening for the owner (repository settings, not done by L-109): a tag on any commit runs that commit's copy of
this workflow, so the "tag on main" check is advisory. To enforce it, move the 11 store secrets into a protected
`mobile-release` environment whose deployment rule allows only `mobile-v*` tags (optionally with a required
reviewer), declare `environment: mobile-release` on the `secrets`, `android-release` and `ios-release` jobs, and add a tag
ruleset that restricts who can create `mobile-v*` tags.

## Store metadata drafts

`metadata/android/en-US/` (Play listing: title, short and full description) and `metadata/ios/en-US/` (name,
subtitle, description, keywords, promotional text, support and marketing URLs) are drafts for the owner to review.
The upload lanes skip metadata; once reviewed, upload them with `fastlane supply --skip_upload_aab true
--metadata_path fastlane/metadata/android` and `fastlane deliver --skip_binary_upload true --metadata_path
fastlane/metadata/ios`. They never quote reading text.

## Privacy declarations

The app collects no data, and the drafts say so:

- It has no account, ads, analytics or crash reporting. Bookmarks, personal notes and settings are stored on the
  device only; a bookmark export goes wherever the reader sends it through the share sheet.
- Its only network requests fetch public files: the Lectio API (`LECTIO_API_BASE_URL`, by default
  `https://nyabongo.github.io/lectio/api/v1/`) and the narration audio files the API links to (public object storage,
  `config.tts.storage.publicBaseUrl`). Nothing about the reader is sent. Links to reading texts and sources open in
  the browser at the reader's tap.
- Daily reminders are local notifications; text to speech uses the device's engine.

App Store privacy: `metadata/ios/app_privacy_details.json` is "Data Not Collected" (upload with
`fastlane run upload_app_privacy_details_to_app_store json_path:fastlane/metadata/ios/app_privacy_details.json`).
Play Data safety form: "Does your app collect or share any of the required user data types?" → **No**; data is
encrypted in transit (HTTPS) → **Yes**; no account, so no deletion request mechanism is needed.

Before review, App Store Connect also needs a privacy policy URL; the site has no privacy page yet.
