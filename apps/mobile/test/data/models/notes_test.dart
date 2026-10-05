import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';

import '../fixtures.dart';

/// The notes of the Gospel in `test/fixtures/<name>.json`.
PassageNotes gospelNotes(String name) {
  final day = parseApiDay(fixtureJson(name));
  return day.readings.last.passage!;
}

void main() {
  group('Audio', () {
    test('reads url and duration', () {
      final audio = Audio.fromJson({
        'url': 'https://audio.test/a.mp3',
        'durationSeconds': 74.5,
      });
      expect(audio.url, Uri.parse('https://audio.test/a.mp3'));
      expect(audio.durationSeconds, 74.5);
      expect(audio.duration, const Duration(milliseconds: 74500));
    });

    test('an absent or null duration is unknown', () {
      final absent = Audio.fromJson({'url': 'https://audio.test/a.mp3'});
      expect(absent.durationSeconds, isNull);
      expect(absent.duration, isNull);
      final explicit = Audio.fromJson({
        'url': 'https://audio.test/a.mp3',
        'durationSeconds': null,
      });
      expect(explicit.durationSeconds, isNull);
    });

    test('an integer duration reads as a double', () {
      final audio = Audio.fromJson({
        'url': 'https://audio.test/a.mp3',
        'durationSeconds': 60,
      });
      expect(audio.duration, const Duration(minutes: 1));
    });

    test('rejects a missing url', () {
      expect(() => Audio.fromJson(<String, Object?>{}), throwsFormatException);
    });
  });

  group('PassageNotes', () {
    test('reads the notes of the fixture day', () {
      final notes = gospelNotes('day');
      expect(notes.key, 'MT.20.1-16');
      expect(notes.ref, 'Mt 20:1-16a');
      expect(notes.locale, 'en');
      expect(notes.summary, startsWith('A landowner'));
      expect(notes.context.title, 'Labourers in the vineyard');
      expect(notes.context.paragraphs, hasLength(2));
      expect(notes.context.paragraphs.first, contains('[c1]'));
      expect(notes.context.audio, isNull);

      final note = notes.translationNotes.first;
      expect(note.id, 'v15-evil-eye');
      expect(note.verse, '20:15');
      expect(note.anchor, 'envious');
      expect(note.original.lang, 'grc');
      expect(note.original.text, isNotEmpty);
      expect(note.original.translit, 'ophthalmos sou ponēros');
      expect(note.original.gloss, 'your eye evil');
      expect(note.summary, isNotEmpty);
      expect(note.body, contains('[c3]'));
      expect(note.audio, isNull);

      final review = notes.review;
      expect(review.status, 'approved');
      expect(review.method, 'human');
      expect(review.lastReviewedAt, DateTime.utc(2026, 9, 3, 17, 5));
    });

    test('reads narration when present, with or without duration', () {
      final notes = gospelNotes('day-with-audio');
      expect(notes.context.audio!.durationSeconds, 74.5);
      final first = notes.translationNotes[0].audio!;
      expect(first.url.host, 'audio.example');
      expect(first.durationSeconds, isNull);
      expect(notes.translationNotes[1].audio, isNull);
    });

    test('reads claims and sources and looks them up by id', () {
      final notes = gospelNotes('day');
      final claim = notes.claim('c5')!;
      expect(claim.text, contains('agathos'));
      expect(claim.sourceIds, ['mt-19-17']);
      expect(claim.sensitive, isTrue);
      expect(notes.claim('c99'), isNull);

      final scripture = notes.source('mt-19-17')!;
      expect(scripture.type, 'scripture');
      expect(scripture.citation, 'Matthew 19:17');
      expect(scripture.ref, 'Mt 19:17');
      expect(scripture.excerpt, isNotNull);
      expect(scripture.excerptLang, 'grc');
      expect(scripture.url, isNull);

      final web = notes.source('lsj-ophthalmos')!;
      expect(web.url!.host, 'www.perseus.tufts.edu');
      expect(web.archivedUrl!.host, 'web.archive.org');
      expect(web.retrievedAt, DateTime.utc(2026, 9, 1, 8, 30));
      expect(notes.source('nowhere'), isNull);
    });

    test('ignores unknown fields at every level (v1 is additive)', () {
      final json = fixtureObject('day-with-audio');
      Map<String, Object?> at(Object? value) => value! as Map<String, Object?>;
      List<Object?> list(Object? value) => value! as List<Object?>;
      final mass = at(list(json['masses']).single);
      final reading = at(list(mass['readings']).last)..['segments'] = [1];
      final passage = at(reading['passage'])..['provenanceV2'] = {'x': 1};
      at(at(passage['context'])['audio'])['segments'] = <Object?>[];
      final note = at(list(passage['translationNotes']).first)
        ..['emphasis'] = 'strong';
      at(note['audio'])['voice'] = 'alto';
      at(note['original'])['strongs'] = 'G4190';
      at(list(passage['claims']).first)['confidence'] = 0.9;
      at(list(passage['sources']).first)['isbn'] = '978';
      at(passage['review'])['reviewers'] = 2;
      mass['rite'] = 'roman';

      final notes = parseApiDay(json).readings.last.passage!;
      expect(notes.context.audio!.durationSeconds, 74.5);
      expect(notes.translationNotes.first.audio!.durationSeconds, isNull);
      expect(notes.translationNotes.first.original.gloss, 'your eye evil');
      expect(notes.claims.first.id, 'c1');
      expect(notes.sources.first.id, 'mt-20-2');
      expect(notes.review.method, 'human');
    });

    test('a null review date is unknown', () {
      final review = Review.fromJson({
        'status': 'approved',
        'method': 'auto',
        'lastReviewedAt': null,
      });
      expect(review.method, 'auto');
      expect(review.lastReviewedAt, isNull);
    });

    test('rejects a malformed note', () {
      expect(
        () => TranslationNote.fromJson({'id': 'x'}),
        throwsFormatException,
      );
      expect(() => Claim.fromJson('c1'), throwsFormatException);
      expect(() => Source.fromJson(null), throwsFormatException);
      expect(() => ContextNote.fromJson(<Object?>[]), throwsFormatException);
      expect(() => OriginalText.fromJson(1), throwsFormatException);
      expect(() => PassageNotes.fromJson(true), throwsFormatException);
    });
  });
}
