/// Shared set-up for the accessibility, text-scaling and golden tests
/// (L-108): the whole app over a fake API serving the seed day, at a fixed
/// size, theme and text scale, with real fonts for the goldens.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/bookmarks/bookmark.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/src/app.dart';

import '../data/fake_api.dart';
import '../data/fixtures.dart';

/// The date of the seed day fixture.
const String seedDate = '2026-09-20';

/// A screen of the app, at its location.
enum Screen {
  /// Today, on the seed day.
  today('/today?date=$seedDate'),

  /// The seed Gospel's Context tab.
  reading('/reading?date=$seedDate&mass=day&slot=gospel'),

  /// The seed Gospel's Original tab.
  original('/reading?date=$seedDate&mass=day&slot=gospel&tab=original'),

  /// Listen.
  listen('/listen'),

  /// Calendar.
  calendar('/calendar'),

  /// Settings.
  settings('/settings'),

  /// Bookmarks and notes, with one of each saved.
  bookmarks('/settings/bookmarks');

  const Screen(this.location);

  /// Where the router opens it.
  final String location;
}

/// A fixed logical screen size.
enum Device {
  /// A small Android phone, 360 × 780.
  phone(Size(360, 780)),

  /// A tablet in portrait, 800 × 1280.
  tablet(Size(800, 1280));

  const Device(this.size);

  /// The logical size, at a device pixel ratio of 1.
  final Size size;
}

/// Sets the test view to [size] logical pixels (ratio 1) until the test
/// ends.
void useSize(WidgetTester tester, Size size) {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Sets the device's own text scale to [factor] (`2` is 200%) until the test
/// ends.
void useDeviceTextScale(WidgetTester tester, double factor) {
  tester.platformDispatcher.textScaleFactorTestValue = factor;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

/// The seed day with its celebrations in [colour], as JSON.
String seedDayIn(String colour) {
  final day = fixtureObject('day');
  for (final item in day['celebrations']! as List<Object?>) {
    (item! as Map<String, Object?>)['colour'] = colour;
  }
  return jsonEncode(day);
}

/// Points the shared repository at a fake API serving [dayJson] (default:
/// the seed day) for [seedDate], until the test ends.
void serveSeedDay({String? dayJson}) {
  final api = FakeApi()
    ..serve('days/$seedDate.json', dayJson ?? fixture('day'));
  appRepository = LectioRepository(
    client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
    cache: MemoryApiCache(),
  );
  addTearDown(() => appRepository = null);
}

/// Bookmarks with one saved reading and one personal note, so the Bookmarks
/// screen shows both lists.
Future<BookmarksController> savedBookmarks() async {
  final controller = BookmarksController(
    MemoryKeyValueStore(),
    clock: () => DateTime.utc(2026, 9, 20, 9),
  );
  const target = BookmarkTarget(date: seedDate, slot: 'gospel');
  await controller.toggleBookmark(target, title: 'Mt 20:1-16a');
  await controller.saveNote(
    target,
    title: 'Mt 20:1-16a',
    text: 'The last hired are paid first. Read again on Friday.',
  );
  return controller;
}

/// Shows [screen] in the whole app, in [brightness] at the reader's
/// [textSize], and waits for the seed day to load.
///
/// Call [serveSeedDay] first.
Future<void> pumpScreen(
  WidgetTester tester,
  Screen screen, {
  Brightness brightness = Brightness.light,
  TextSize textSize = TextSize.standard,
}) async {
  final settings = SettingsController(
    MemoryKeyValueStore({
      SettingsController.storageKey: jsonEncode(
        AppSettings(
          theme: brightness == Brightness.dark
              ? ThemePreference.dark
              : ThemePreference.light,
          textSize: textSize,
        ).toJson(),
      ),
    }),
  );
  final bookmarks = screen == Screen.bookmarks
      ? await savedBookmarks()
      : null;
  await tester.pumpWidget(
    LectioApp(
      initialLocation: screen.location,
      settings: settings,
      bookmarks: bookmarks,
    ),
  );
  await tester.pumpAndSettle();
}

/// The Flutter SDK's Material fonts directory (Roboto), which `flutter test`
/// does not load by default: from `FLUTTER_ROOT`, else next to the
/// `flutter_tester` engine binary running the tests.
Directory materialFontsDirectory() {
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root != null) {
    return Directory('$root/bin/cache/artifacts/material_fonts');
  }
  // <sdk>/bin/cache/artifacts/engine/<platform>/flutter_tester
  final engine = File(Platform.resolvedExecutable).parent.parent.parent;
  return Directory('${engine.path}/material_fonts');
}

/// Loads Roboto (the Material font on Android) from the SDK and the fonts the
/// app bundles (Material Icons), so goldens show real text and icons instead
/// of the test font's boxes. The same SDK in CI draws the same pixels.
Future<void> loadGoldenFonts() async {
  final directory = materialFontsDirectory();
  final files =
      directory
          .listSync()
          .whereType<File>()
          .where((file) {
            final name = file.uri.pathSegments.last;
            return name.startsWith('Roboto-') && name.endsWith('.ttf');
          })
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));
  if (files.isEmpty) {
    throw StateError('No Roboto fonts in ${directory.path}');
  }
  final roboto = FontLoader('Roboto');
  for (final file in files) {
    roboto.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
  }
  await roboto.load();

  final manifest =
      jsonDecode(await rootBundle.loadString('FontManifest.json'))
          as List<Object?>;
  for (final entry in manifest.cast<Map<String, Object?>>()) {
    final loader = FontLoader(entry['family']! as String);
    final fonts = entry['fonts']! as List<Object?>;
    for (final font in fonts.cast<Map<String, Object?>>()) {
      loader.addFont(rootBundle.load(font['asset']! as String));
    }
    await loader.load();
  }
}
