import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/features/share/share_button.dart';
import 'package:lectio/features/share/share_sheet.dart';

import '../../data/fixtures.dart';
import '../reading/reading_harness.dart';

final Uri _site = Uri.parse('https://nyabongo.github.io/lectio/');

const String _gospelSummary =
    'A landowner pays the last hired the same as the first, and asks whether '
    'his goodness is a cause for resentment.';

/// A share sheet that records what it shares and answers [outcome].
class FakeShareSheet implements ShareSheet {
  /// Creates a sheet answering [outcome].
  new([this.outcome = ShareOutcome.shared]);

  /// What every share answers.
  ShareOutcome outcome;

  /// Everything shared, with the sheet's origin.
  final List<(ShareContent, Rect?)> shared = [];

  @override
  Future<ShareOutcome> share(ShareContent content, {Rect? origin}) async {
    shared.add((content, origin));
    return outcome;
  }
}

void main() {
  final day = parseApiDay(fixtureJson('day'));
  final gospel = day.masses.first.readings.last;
  final passage = gospel.passage!;

  group('content', () {
    test('a day: its title and date, the Gospel summary and its page', () {
      final content = dayShare(day, site: _site);
      const ref =
          'Twenty-fifth Sunday in Ordinary Time, Sunday 20 September 2026';
      expect(content.title, ref);
      expect(content.ref, ref);
      expect(content.insight, _gospelSummary);
      expect(content.url.toString(), '${_site}2026-09-20/');
      expect(dayShare(day).url.path, endsWith('/2026-09-20/'));
    });

    test('a day without a celebration is its date', () {
      final json = seedDay()..['celebrations'] = <Object?>[];
      final content = dayShare(parseApiDay(json), site: _site);
      expect(content.ref, 'Sunday 20 September 2026');
    });

    test('a day insight is the first summary when the Gospel has none', () {
      final json = seedDay();
      final readings = readingsOf(json);
      final first = readings.first! as Map<String, Object?>;
      final last = readings.last! as Map<String, Object?>;
      first['passage'] = last['passage'];
      last['passage'] = null;
      expect(dayInsight(parseApiDay(json)), _gospelSummary);
    });

    test('notes that are not approved have no insight', () {
      final json = seedDay();
      final review = gospelOf(json)['review']! as Map<String, Object?>;
      review['status'] = 'draft';
      final draft = parseApiDay(json);
      expect(dayInsight(draft), isNull);
      final reading = draft.masses.first.readings.last;
      expect(readingShare(seedDate, reading).insight, isNull);
    });

    test('a reading: its reference, summary and page', () {
      final content = readingShare(seedDate, gospel, site: _site);
      expect(content.title, 'Mt 20:1-16a · Gospel');
      expect(content.ref, 'Mt 20:1-16a');
      expect(content.insight, _gospelSummary);
      expect(content.url.toString(), '${_site}2026-09-20/gospel/');
    });

    test('an insight: its heading, summary and page', () {
      final note = passage.translationNotes.first;
      final content = noteShare(passage, note, '2026-09-20/gospel/');
      expect(content.title, '“envious” · Mt 20:1-16a, verse 15');
      expect(content.ref, content.title);
      expect(content.insight, note.summary);
      expect(
        noteShare(passage, note, '2026-09-20/gospel/', site: _site).text,
        '“envious” · Mt 20:1-16a, verse 15\n'
        '${note.summary}\n'
        '${_site}2026-09-20/gospel/notes/v15-evil-eye/',
      );
    });
  });

  group('ShareButton', () {
    final content = readingShare(seedDate, gospel, site: _site);

    Future<void> pumpButton(WidgetTester tester, ShareSheet sheet) {
      return tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: ShareButton(content: content, sheet: sheet),
            ),
          ),
        ),
      );
    }

    testWidgets('opens the share sheet at the button', (tester) async {
      final sheet = FakeShareSheet();
      await pumpButton(tester, sheet);
      expect(find.byTooltip('Share Mt 20:1-16a'), findsOneWidget);

      await tester.tap(find.byType(ShareButton));
      await tester.pump();

      final (shared, origin) = sheet.shared.single;
      expect(shared, content);
      expect(origin, tester.getRect(find.byType(IconButton)));
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('copies the text when there is no sheet', (tester) async {
      final copied = <Object?>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') copied.add(call.arguments);
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await pumpButton(tester, FakeShareSheet(ShareOutcome.fallback));

      await tester.tap(find.byType(ShareButton));
      await tester.pump();

      expect(copied, [
        {'text': content.text},
      ]);
      expect(find.text(ShareStrings.copied), findsOneWidget);
    });

    testWidgets('says so when copying fails too', (tester) async {
      await pumpButton(tester, FakeShareSheet(ShareOutcome.fallback));
      final outcome = await shareFrom(
        tester.element(find.byType(ShareButton)),
        content,
        sheet: FakeShareSheet(ShareOutcome.fallback),
        copy: (_) => throw PlatformException(code: 'denied'),
      );
      await tester.pump();
      expect(outcome, ShareOutcome.fallback);
      expect(find.text(ShareStrings.failed), findsOneWidget);
    });

    testWidgets('does nothing more when cancelled or busy', (tester) async {
      await pumpButton(tester, FakeShareSheet());
      for (final outcome in [ShareOutcome.cancelled, ShareOutcome.busy]) {
        final result = await shareFrom(
          tester.element(find.byType(ShareButton)),
          content,
          sheet: FakeShareSheet(outcome),
          copy: (_) => fail('copied'),
        );
        expect(result, outcome);
      }
      await tester.pump();
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('uses the app share sheet by default', (tester) async {
      final sheet = FakeShareSheet();
      appShareSheet = sheet;
      addTearDown(() => appShareSheet = null);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ShareButton(content: content)),
        ),
      );
      await tester.tap(find.byType(ShareButton));
      await tester.pump();
      expect(sheet.shared.single.$1, content);
    });
  });
}
