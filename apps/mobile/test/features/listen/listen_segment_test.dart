import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/features/listen/listen_segment.dart';

import '../../data/fixtures.dart';

void main() {
  group('spokenText', () {
    test('drops claim markers and joins lines', () {
      expect(
        spokenText(
          'A denarius was pay. [c1] For a day [c2][c3]\n  in  Galilee.',
        ),
        'A denarius was pay. For a day in Galilee.',
      );
    });
  });

  group('segmentsForMass', () {
    test('follows the API order with audio where rendered', () {
      final day = parseApiDay(fixtureJson('day-with-audio'));
      final segments = segmentsForMass(day.masses.single);

      expect(segments.map((s) => s.id), [
        'MT.20.1-16/context',
        'MT.20.1-16/note/v15-evil-eye',
        'MT.20.1-16/note/v15-agathos',
      ]);
      final [context, evilEye, agathos] = segments;
      expect(context.kind, SegmentKind.context);
      expect(context.slot, 'gospel');
      expect(context.passageKey, 'MT.20.1-16');
      expect(context.ref, 'Mt 20:1-16a');
      expect(context.locale, 'en');
      expect(context.title, 'Labourers in the vineyard');
      expect(
        context.audio?.url,
        Uri.parse('https://audio.example/audio/v1/0123abcd.mp3'),
      );
      expect(context.usesSpeech, isFalse);
      expect(context.script, startsWith('Context for Mt 20:1-16a. '));
      expect(context.script, contains('Labourers in the vineyard.'));
      expect(context.script, isNot(contains('[c')));

      expect(evilEye.kind, SegmentKind.translationNote);
      expect(evilEye.title, 'envious · ophthalmos sou ponēros');
      expect(
        evilEye.script,
        startsWith(
          'Translation note on Mt 20:1-16a, verse 20:15, the word “envious”. '
          'Literally “your eye evil”. ',
        ),
      );
      expect(evilEye.audio, isNotNull);
      expect(agathos.usesSpeech, isTrue);
    });

    test('narrates a passage read twice once, and skips readings without '
        'notes', () {
      final json = fixtureObject('day');
      final mass = (json['masses']! as List<Object?>).single!;
      final readings = (mass as Map<String, Object?>)['readings']!;
      final list = readings as List<Object?>;
      list.add(list.last);
      final day = parseApiDay(json);

      final segments = segmentsForMass(day.masses.single);
      expect(segments, hasLength(3));
    });

    test('keeps a title that already ends a sentence', () {
      final json = fixtureObject('day');
      final mass = (json['masses']! as List<Object?>).single!;
      final readings = (mass as Map<String, Object?>)['readings']!;
      final gospel = (readings as List<Object?>).last! as Map<String, Object?>;
      final passage = gospel['passage']! as Map<String, Object?>;
      (passage['context']! as Map<String, Object?>)
        ..['title'] = 'Who is first?'
        ..['paragraphs'] = <Object?>['', 'Last'];
      final notes = passage['translationNotes']! as List<Object?>;
      (notes.first! as Map<String, Object?>)['anchor'] = 'evil eye';

      final segments = segmentsForMass(parseApiDay(json).masses.single);
      expect(
        segments.first.script,
        'Context for Mt 20:1-16a. Who is first? Last.',
      );
      expect(segments[1].script, contains('the words “evil eye”'));
    });
  });
}
