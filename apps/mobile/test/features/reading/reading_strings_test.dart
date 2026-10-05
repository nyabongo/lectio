import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/reading/reading_strings.dart';

void main() {
  const strings = ReadingStrings.en;

  test('slot labels match the site', () {
    expect(strings.slotLabel('first-reading'), 'First reading');
    expect(strings.slotLabel('psalm'), 'Psalm');
    expect(strings.slotLabel('second-reading'), 'Second reading');
    expect(strings.slotLabel('gospel'), 'Gospel');
    expect(strings.slotLabel('epistle'), 'Epistle');
    expect(strings.slotLabel('reading-3'), 'Reading 3');
    expect(strings.slotLabel('psalm-2'), 'Psalm 2');
    expect(strings.slotLabel('responsory'), 'Reading');
  });

  test('the verified badge counts sources', () {
    expect(strings.verified(1), 'Verified · 1 source');
    expect(strings.verified(3), 'Verified · 3 sources');
  });

  test('citations read as words', () {
    expect(strings.cite([6]), 'Source 6');
    expect(strings.cite([4, 5]), 'Sources 4, 5');
  });

  test('the review method', () {
    expect(strings.method('human'), contains('human reviewer'));
    expect(strings.method('auto'), contains('two independent AI verifiers'));
  });

  test('messages with values', () {
    expect(strings.noSuchReading('epistle'), 'This day has no Epistle.');
    expect(
      strings.textLabel('Mt 20:1-16a', 'drbo.org'),
      'Read the text of Mt 20:1-16a at drbo.org (opens outside the app)',
    );
    expect(strings.verse('15'), 'Verse 15');
    expect(
      strings.lastReviewed('3 September 2026'),
      'Last reviewed 3 September 2026',
    );
  });

  test('fixed messages are not empty', () {
    final messages = [
      strings.contextTab,
      strings.originalTab,
      strings.textTab,
      strings.loading,
      strings.loadFailed,
      strings.retry,
      strings.offline,
      strings.noReadings,
      strings.pending,
      strings.noNotes,
      strings.sources,
      strings.archived,
      strings.originalLabel,
      strings.translitLabel,
      strings.glossLabel,
      strings.unverified,
      strings.report,
      strings.linkFailed,
      strings.disclaimer,
    ];
    expect(messages.where((message) => message.isEmpty), isEmpty);
  });
}
