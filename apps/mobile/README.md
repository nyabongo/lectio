# Lectio mobile

The Flutter app for Android and iOS (bundle id `io.github.nyabongo.lectio`). It reads the same `/api/v1` JSON the
site publishes. Flutter is pinned in `pubspec.yaml` (`environment.flutter`) and is not needed locally: everything
builds and tests in GitHub Actions (`.github/workflows/flutter.yml`), so iterate on a draft PR.

What CI runs, from this directory:

```sh
dart format --set-exit-if-changed .
flutter analyze
flutter test --coverage
dart run tool/check_coverage.dart   # Dart line coverage >= 96%, every lib/ file loaded by a test
flutter build apk --debug
```

`tool/check_coverage.dart` declares `const double minCoverage = 96;`. `npm run coverage:floor` reads it and fails if
it is lowered; CODEOWNERS routes the file to the owner. Generated `*.g.dart` and `*.freezed.dart` files are excluded.

The `android/` and `ios/` folders are not committed yet. Until they are, CI materialises them with
`flutter create --org io.github.nyabongo --project-name lectio --platforms android,ios .` (which never overwrites
existing files) and uploads them as the `mobile-platforms` artifact; the first issue that needs native changes
commits them.
