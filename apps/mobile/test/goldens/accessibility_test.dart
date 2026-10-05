import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

import 'lectio_harness.dart';

/// The same accessibility bar as the site (L-108): text contrast, tap
/// targets with labels, screen-reader semantics, and every screen at 200%
/// text without overflowing.
void main() {
  /// Every guideline Flutter checks, on what [tester] shows.
  Future<void> expectGuidelines(WidgetTester tester) async {
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  }

  group('guidelines', () {
    for (final screen in Screen.values) {
      for (final brightness in Brightness.values) {
        testWidgets('${screen.name} in ${brightness.name}', (tester) async {
          final semantics = tester.ensureSemantics();
          useSize(tester, Device.phone.size);
          serveSeedDay();
          await pumpScreen(tester, screen, brightness: brightness);

          await expectGuidelines(tester);
          semantics.dispose();
        });
      }
    }
  });

  group('accent contrast on Today', () {
    for (final colour in LiturgicalColour.values) {
      for (final brightness in Brightness.values) {
        testWidgets('${colour.name} in ${brightness.name}', (tester) async {
          final semantics = tester.ensureSemantics();
          useSize(tester, Device.phone.size);
          serveSeedDay(dayJson: seedDayIn(colour.name));
          await pumpScreen(tester, Screen.today, brightness: brightness);

          // The day's colour tints the screen.
          final context = tester.element(find.text(TodayStrings.listen));
          expect(
            Theme.of(context).colorScheme.primary,
            colour.accent(brightness),
          );
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          semantics.dispose();
        });
      }
    }
  });

  group('200% text', () {
    // A RenderFlex overflow anywhere fails the test. The tall view lays out
    // every item of the scrolling lists; the phone checks fixed headers.
    final sizes = {
      'phone': Device.phone.size,
      'tall phone': const Size(360, 4000),
    };
    for (final screen in Screen.values) {
      for (final MapEntry(key: name, value: size) in sizes.entries) {
        testWidgets('${screen.name} fits a $name', (tester) async {
          useSize(tester, size);
          useDeviceTextScale(tester, 2);
          serveSeedDay();
          await pumpScreen(tester, screen);

          final context = tester.element(find.byType(Scaffold).first);
          expect(MediaQuery.textScalerOf(context).scale(10), 20);
          expect(tester.takeException(), isNull);
        });
      }
    }
  });

  group('semantics', () {
    testWidgets('Today names each button after its reading', (tester) async {
      final semantics = tester.ensureSemantics();
      useSize(tester, const Size(360, 4000));
      serveSeedDay();
      await pumpScreen(tester, Screen.today);

      expect(
        tester.getSemantics(find.text(TodayStrings.notes)),
        containsSemantics(
          label: notesSemantics('Mt 20:1-16a'),
          isButton: true,
          hasTapAction: true,
        ),
      );
      // The link-out keeps its tap action under its spoken label.
      expect(
        tester.getSemantics(find.text(TodayStrings.text).last),
        containsSemantics(
          label: linkoutSemantics(
            'Mt 20:1-16a',
            Uri.parse('https://www.drbo.org/chapter/47020.htm'),
          ),
          isButton: true,
          hasTapAction: true,
        ),
      );
      expect(
        tester.getSemantics(find.text('Twenty-fifth Sunday in Ordinary Time')),
        containsSemantics(isHeader: true),
      );
      semantics.dispose();
    });

    testWidgets('Reading marks its headings, citations and links', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      useSize(tester, const Size(360, 4000));
      serveSeedDay();
      await pumpScreen(tester, Screen.reading);

      expect(
        tester.getSemantics(find.text('Mt 20:1-16a')),
        containsSemantics(isHeader: true),
      );
      expect(
        tester.getSemantics(find.text('Labourers in the vineyard')),
        containsSemantics(isHeader: true),
      );
      expect(find.bySemanticsLabel(RegExp('Source 6')), findsWidgets);

      await tester.tap(find.textContaining('Verified ·').first);
      await tester.pumpAndSettle();
      expect(
        tester.getSemantics(find.textContaining('Liddell, Scott, Jones').first),
        containsSemantics(isLink: true, hasTapAction: true),
      );
      semantics.dispose();
    });

    final headings = {Screen.settings: 'Text size', Screen.bookmarks: 'Notes'};
    for (final MapEntry(key: screen, value: heading) in headings.entries) {
      testWidgets('${screen.name} marks its section headings', (tester) async {
        final semantics = tester.ensureSemantics();
        useSize(tester, const Size(360, 4000));
        serveSeedDay();
        await pumpScreen(tester, screen);

        expect(
          tester.getSemantics(find.text(heading)),
          containsSemantics(isHeader: true),
        );
        semantics.dispose();
      });
    }
  });
}
