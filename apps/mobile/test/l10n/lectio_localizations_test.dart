import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

void main() {
  final en = LectioLocalizations.en;
  final sw = LectioLocalizations.forLanguage('sw');

  group('supportedLanguage', () {
    test('keeps a language the app has', () {
      expect(supportedLanguage('sw'), 'sw');
      expect(supportedLanguage('en'), 'en');
    });

    test('falls back to English', () {
      expect(supportedLanguage('fr'), 'en');
      expect(supportedLanguage(null), 'en');
    });
  });

  test('pluralCategory picks one for 1 only', () {
    expect(pluralCategory('en', 1), 'one');
    expect(pluralCategory('sw', 1), 'one');
    expect(pluralCategory('en', 0), 'other');
    expect(pluralCategory('sw', 2), 'other');
  });

  group('forLanguage', () {
    test('caches one instance per language', () {
      expect(identical(LectioLocalizations.forLanguage('sw'), sw), isTrue);
      expect(en.languageCode, 'en');
      expect(sw.locale, const Locale('sw'));
    });

    test('gives English for a language the app does not have', () {
      expect(identical(LectioLocalizations.forLanguage('fr'), en), isTrue);
    });
  });

  group('text', () {
    test('reads the site catalogs and the app catalog', () {
      expect(en.text('day_todayHeading'), 'Today');
      expect(sw.text('day_todayHeading'), 'Leo');
      expect(en.text('app_tabs_listen'), 'Listen');
      expect(sw.text('app_tabs_listen'), 'Sikiliza');
    });

    test('fills placeholders', () {
      expect(
        sw.text('day_cycles', {'sunday': 'A', 'weekday': 'II'}),
        'Mzunguko wa Dominika A · Mzunguko wa siku za juma II',
      );
    });

    test('picks the plural form for count', () {
      expect(en.text('reading_verified', {'count': 1}), contains('1 source'));
      expect(en.text('reading_verified', {'count': 4}), contains('4 sources'));
      expect(sw.text('reading_verified', {'count': 1}), contains('chanzo 1'));
    });

    test('rejects an unknown key', () {
      expect(() => en.text('nope_nothing'), throwsArgumentError);
    });

    test('rejects a missing parameter', () {
      expect(() => en.text('day_cycles', {'sunday': 'A'}), throwsArgumentError);
    });

    test('rejects a plural message without a numeric count', () {
      expect(() => en.text('reading_verified'), throwsArgumentError);
      expect(
        () => en.text('reading_verified', {'count': 'two'}),
        throwsArgumentError,
      );
    });
  });

  test('every English key has a Kiswahili message', () {
    // The sync tool enforces this; the run-time fallback to English is a
    // safety net only.
    for (final key in ['day_slot_gospel', 'settings_title', 'app_comingSoon']) {
      expect(sw.text(key), isNot(en.text(key)));
    }
  });

  group('delegate', () {
    const delegate = LectioLocalizations.delegate;

    test('supports English and Kiswahili only', () {
      expect(delegate.isSupported(const Locale('en')), isTrue);
      expect(delegate.isSupported(const Locale('sw', 'KE')), isTrue);
      expect(delegate.isSupported(const Locale('fr')), isFalse);
      expect(delegate.shouldReload(delegate), isFalse);
    });

    test('loads the strings of the locale', () async {
      expect(await delegate.load(const Locale('sw')), same(sw));
    });

    test('is listed with the Flutter delegates', () {
      expect(lectioLocalizationsDelegates.first, delegate);
      expect(supportedLocales, const [Locale('en'), Locale('sw')]);
    });
  });

  group('of', () {
    testWidgets('reads the app locale', (tester) async {
      late LectioLocalizations found;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('sw'),
          supportedLocales: supportedLocales,
          localizationsDelegates: lectioLocalizationsDelegates,
          home: Builder(
            builder: (context) {
              found = LectioLocalizations.of(context);
              return Text(MaterialLocalizations.of(context).okButtonLabel);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(found, same(sw));
    });

    testWidgets('is English without the app delegates', (tester) async {
      late LectioLocalizations found;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              found = LectioLocalizations.of(context);
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(found, same(en));
    });
  });
}
