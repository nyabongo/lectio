import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/reading/reading_view.dart';

import 'reading_harness.dart';

/// The day document [json], parsed.
ApiDay dayFrom(Map<String, Object?> json) => parseApiDay(json);

/// The Gospel notes of the seed day.
PassageNotes seedNotes() => dayFrom(seedDay()).readings.last.passage!;

/// A reading without notes in [slot].
Map<String, Object?> reading(String slot, {String ref = 'Ref'}) {
  return {
    'slot': slot,
    'ref': ref,
    'key': 'MT.1.1',
    'linkout': 'https://www.drbo.org/chapter/47001.htm',
    'passage': null,
  };
}

void main() {
  group('readingsBySlot', () {
    test('lists the slots of the seed day in order', () {
      final bySlot = readingsBySlot(dayFrom(seedDay()));
      expect(bySlot.keys, [
        'first-reading',
        'psalm',
        'second-reading',
        'gospel',
      ]);
    });

    test('the Mass during the Day wins a shared slot', () {
      final json = seedDay();
      (json['masses']! as List<Object?>).insert(0, {
        'id': 'vigil',
        'label': 'Vigil Mass',
        'readings': [
          reading('gospel', ref: 'Vigil gospel'),
          reading('epistle', ref: 'Vigil epistle'),
        ],
      });
      final bySlot = readingsBySlot(dayFrom(json));
      expect(bySlot['gospel']!.ref, 'Mt 20:1-16a');
      expect(bySlot['epistle']!.ref, 'Vigil epistle');
      expect(bySlot.keys.last, 'epistle');
    });
  });

  group('pickReading', () {
    test('a named slot, or null when the day has none', () {
      final day = dayFrom(seedDay());
      expect(pickReading(day, 'psalm')!.slot, 'psalm');
      expect(pickReading(day, 'epistle'), isNull);
    });

    test('defaults to the Gospel', () {
      expect(pickReading(dayFrom(seedDay()), null)!.slot, 'gospel');
    });

    test('without a Gospel, the first reading with notes', () {
      final json = seedDay();
      (readingsOf(json).last! as Map<String, Object?>)['slot'] = 'reading-4';
      expect(pickReading(dayFrom(json), null)!.slot, 'reading-4');
    });

    test('without notes, the first reading; none on an empty day', () {
      final json = seedDay();
      final readings = readingsOf(json)..removeLast();
      expect(readings, hasLength(3));
      expect(pickReading(dayFrom(json), null)!.slot, 'first-reading');
      readings.clear();
      expect(pickReading(dayFrom(json), null), isNull);
    });
  });

  test('textDirectionFor is right to left for Hebrew-script tags', () {
    for (final lang in ['hbo', 'he', 'he-IL', 'arc', 'ar', 'syc']) {
      expect(textDirectionFor(lang), TextDirection.rtl, reason: lang);
    }
    for (final lang in ['grc', 'lat', 'en', 'el']) {
      expect(textDirectionFor(lang), TextDirection.ltr, reason: lang);
    }
  });

  test('localeFor maps lat to la', () {
    expect(localeFor('lat'), const Locale('la'));
    expect(localeFor('grc'), const Locale('grc'));
  });

  group('citations', () {
    test('citedClaims lists each claim once, in order', () {
      expect(citedClaims('a [c2] b [c1][c2] c [c10]'), ['c2', 'c1', 'c10']);
      expect(citedClaims('no markers'), isEmpty);
    });

    test('sourcesForClaims numbers sources by their position', () {
      final sources = sourcesForClaims(seedNotes(), ['c2', 'c1', 'c9']);
      expect(sources.map((s) => s.number), [1, 6]);
      expect(sources.map((s) => s.source.id), ['mt-20-2', 'davies-allison']);
    });

    test('segments split prose at marker runs', () {
      final notes = seedNotes();
      final out = segments(notes, 'One. [c1] Two [c3][c4]');
      expect(out, hasLength(4));
      expect((out[0] as TextSegment).text, 'One.');
      expect((out[1] as CiteSegment).sources.map((s) => s.number), [6]);
      expect((out[2] as TextSegment).text, ' Two');
      final cite = out[3] as CiteSegment;
      expect(cite.sources.map((s) => s.number), [2, 4, 5]);
    });

    test('segments handle a leading marker, trailing text and unknowns', () {
      final out = segments(seedNotes(), '[c9] tail');
      expect((out[0] as CiteSegment).sources, isEmpty);
      expect((out[1] as TextSegment).text, ' tail');
      expect(segments(seedNotes(), ''), isEmpty);
    });

    test('context and note sources', () {
      final notes = seedNotes();
      expect(contextSources(notes).map((s) => s.number), [1, 2, 4, 5, 6]);
      final evilEye = notes.translationNotes.first;
      expect(noteSources(notes, evilEye).map((s) => s.number), [2, 4, 5]);
    });
  });

  group('verseLabel', () {
    TranslationNote noteAt(String verse) {
      final note = seedNotes().translationNotes.first;
      return TranslationNote(
        id: note.id,
        verse: verse,
        anchor: note.anchor,
        original: note.original,
        summary: note.summary,
        body: note.body,
      );
    }

    test('drops the chapter of the passage', () {
      expect(verseLabel(seedNotes(), noteAt('20:15')), '15');
    });

    test('keeps another chapter or an unusual verse', () {
      expect(verseLabel(seedNotes(), noteAt('21:3')), '21:3');
      expect(verseLabel(seedNotes(), noteAt('15')), '15');
    });

    test('a key without a chapter keeps the verse', () {
      final notes = seedNotes();
      final odd = PassageNotes(
        key: 'MT',
        ref: notes.ref,
        locale: notes.locale,
        summary: notes.summary,
        context: notes.context,
        translationNotes: notes.translationNotes,
        claims: notes.claims,
        sources: notes.sources,
        review: notes.review,
      );
      expect(verseLabel(odd, noteAt('20:15')), '20:15');
    });
  });

  test('isApproved reads the review status', () {
    expect(isApproved(seedNotes()), isTrue);
    final json = seedDay();
    (gospelOf(json)['review']! as Map<String, Object?>)['status'] = 'pending';
    expect(isApproved(dayFrom(json).readings.last.passage!), isFalse);
  });

  test('readingPagePath is the site path', () {
    expect(readingPagePath('2026-09-20', 'gospel'), '2026-09-20/gospel/');
  });

  test('reportIssueUrl prefills the content issue form', () {
    final url = reportIssueUrl(
      passage: 'MT.20.1-16',
      note: 'v15-agathos',
      page: '2026-09-20/gospel/',
    );
    expect(url.origin, 'https://github.com');
    expect(url.path, '/nyabongo/lectio/issues/new');
    expect(url.queryParameters, {
      'template': 'content-issue.yml',
      'title': 'Content issue: MT.20.1-16 (v15-agathos)',
      'passage': 'MT.20.1-16',
      'note': 'v15-agathos',
      'page': '2026-09-20/gospel/',
    });
  });

  test('linkoutSource names the host', () {
    expect(linkoutSource(Uri.parse('https://www.drbo.org/x.htm')), 'drbo.org');
    expect(linkoutSource(Uri.parse('https://bible.test/x')), 'bible.test');
    expect(linkoutSource(Uri.parse('urn:x')), 'urn:x');
  });
}
