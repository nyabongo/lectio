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

  group('segmentsForMass in Kiswahili', () {
    /// The seed Mass with the Gospel's notes in [locale], without audio.
    Mass<DayReading> mirrorMass(String locale) {
      final json = fixtureObject('day-with-audio');
      final mass = (json['masses']! as List<Object?>).single!;
      final readings = (mass as Map<String, Object?>)['readings']!;
      final gospel = (readings as List<Object?>).last! as Map<String, Object?>;
      final passage = gospel['passage']! as Map<String, Object?>;
      passage['locale'] = locale;
      final context = passage['context']! as Map<String, Object?>
        ..['audio'] = null
        ..['title'] = 'Wafanyakazi shambani';
      context['paragraphs'] = <Object?>['Dinari moja. [c1]'];
      for (final note in passage['translationNotes']! as List<Object?>) {
        (note! as Map<String, Object?>)['audio'] = null;
      }
      return parseApiDay(json).masses.single;
    }

    final english = parseApiDay(fixtureJson('day-with-audio')).masses.single;

    test('narrates reviewed translations with the English as fallback', () {
      final segments = segmentsForMass(
        english,
        localized: mirrorMass('sw'),
        language: 'sw',
      );
      expect(segments, hasLength(3));
      final [context, evilEye, _] = segments;
      expect(context.locale, 'sw');
      expect(context.title, 'Wafanyakazi shambani');
      expect(context.script, 'Wafanyakazi shambani. Dinari moja.');
      expect(context.usesSpeech, isTrue);
      expect(context.fallback?.id, context.id);
      expect(context.fallback?.locale, 'en');
      expect(context.fallback?.audio, isNotNull);
      expect(
        evilEye.script,
        startsWith('“envious”: ophthalmos sou ponēros, “your eye evil”. '),
      );
      expect(evilEye.fallback?.id, evilEye.id);
    });

    test('keeps English notes the mirror has not translated', () {
      final segments = segmentsForMass(
        english,
        localized: mirrorMass('en'),
        language: 'sw',
      );
      expect(segments.first.locale, 'en');
      expect(segments.first.audio, isNotNull);
      expect(segments.first.fallback, isNull);
    });

    test('ignores the mirror in English', () {
      final segments = segmentsForMass(english, localized: mirrorMass('sw'));
      expect(segments.first.locale, 'en');
    });
  });

  group('segmentsForMass from the API segments', () {
    Map<String, Object?> massOf(Map<String, Object?> json) {
      return (json['masses']! as List<Object?>).single! as Map<String, Object?>;
    }

    List<Map<String, Object?>> segmentsOf(Map<String, Object?> json) {
      return [
        for (final item in massOf(json)['segments']! as List<Object?>)
          item! as Map<String, Object?>,
      ];
    }

    final englishJson = fixtureObject('day-with-segments');
    final english = parseApiDay(englishJson).masses.single;
    final mirror = parseApiDay(fixtureJson('day-sw-with-segments'))
        .masses
        .single;

    test('reads the API script, with the passage reference', () {
      final segments = segmentsForMass(english);
      final api = segmentsOf(englishJson);
      expect(segments.map((s) => s.id), [for (final s in api) s['id']]);
      expect(segments.map((s) => s.script), [for (final s in api) s['script']]);
      final [context, evilEye, agathos] = segments;
      expect(context.kind, SegmentKind.context);
      expect(context.ref, 'Mt 20:1-16a');
      expect(context.slot, 'gospel');
      expect(context.passageKey, 'MT.20.1-16');
      expect(context.locale, 'en');
      expect(context.title, 'Labourers in the vineyard');
      expect(
        context.script,
        startsWith('Context for Matthew chapter 20, verses 1 to 16. '),
      );
      expect(context.usesSpeech, isFalse);
      expect(evilEye.kind, SegmentKind.translationNote);
      expect(evilEye.title, 'envious · ophthalmos sou ponēros');
      expect(agathos.usesSpeech, isTrue);
      expect(agathos.fallback, isNull);
    });

    test('leaves out kinds it does not know and passages without a '
        'reading', () {
      final json = fixtureObject('day-with-segments');
      final [context, evilEye, _] = segmentsOf(json);
      context['kind'] = 'reading-intro';
      evilEye['passageKey'] = 'JN.1.1-5';
      final segments = segmentsForMass(parseApiDay(json).masses.single);
      expect(segments.map((s) => s.id), ['MT.20.1-16/note/v15-agathos']);
      expect(segments.single.ref, 'Mt 20:1-16a');
    });

    test('uses Kiswahili segments only for a Kiswahili mirror passage', () {
      final json = fixtureObject('day-sw-with-segments');
      final gospel =
          (massOf(json)['readings']! as List<Object?>).last!
              as Map<String, Object?>;
      (gospel['passage']! as Map<String, Object?>)['locale'] = 'en';
      final segments = segmentsForMass(
        english,
        localized: parseApiDay(json).masses.single,
        language: 'sw',
      );
      expect(segments.map((s) => s.locale).toSet(), {'en'});
    });

    test('ignores the mirror in English', () {
      final segments = segmentsForMass(english, localized: mirror);
      expect(segments.map((s) => s.locale).toSet(), {'en'});
    });

    test("reads the mirror's Kiswahili script, with the English segment as "
        'fallback', () {
      final segments = segmentsForMass(
        english,
        localized: mirror,
        language: 'sw',
      );
      final api = segmentsOf(fixtureObject('day-sw-with-segments'));
      expect(segments.map((s) => s.script), [for (final s in api) s['script']]);
      final [context, evilEye, _] = segments;
      expect(context.locale, 'sw');
      expect(context.title, 'Wafanyakazi katika shamba la mizabibu');
      expect(context.script, startsWith('Muktadha wa Mathayo sura ya 20'));
      expect(context.ref, 'Mt 20:1-16a');
      expect(context.usesSpeech, isTrue);
      expect(context.fallback?.locale, 'en');
      expect(context.fallback?.script, segmentsForMass(english).first.script);
      expect(context.fallback?.audio, isNotNull);
      expect(evilEye.fallback?.id, evilEye.id);
    });

    test('builds the Kiswahili from the notes when the mirror has no '
        'segments', () {
      final json = fixtureObject('day-sw-with-segments');
      massOf(json)['segments'] = <Object?>[];
      final segments = segmentsForMass(
        english,
        localized: parseApiDay(json).masses.single,
        language: 'sw',
      );
      final [context, evilEye, _] = segments;
      expect(context.locale, 'sw');
      expect(
        context.script,
        startsWith('Wafanyakazi katika shamba la mizabibu. Mathayo peke'),
      );
      expect(context.script, isNot(contains('[c')));
      expect(context.fallback?.script, startsWith('Context for Matthew'));
      expect(evilEye.script, startsWith('“wivu”: ophthalmos sou ponēros'));
    });

    test('keeps the English segments the mirror has not translated', () {
      final json = fixtureObject('day-sw-with-segments');
      final gospel =
          (massOf(json)['readings']! as List<Object?>).last!
              as Map<String, Object?>;
      (gospel['passage']! as Map<String, Object?>)['locale'] = 'en';
      for (final segment in segmentsOf(json)) {
        segment['locale'] = 'en';
      }
      final segments = segmentsForMass(
        english,
        localized: parseApiDay(json).masses.single,
        language: 'sw',
      );
      expect(segments.first.locale, 'en');
      expect(segments.first.audio, isNotNull);
      expect(segments.first.fallback, isNull);
    });

    test('in Kiswahili without the mirror, plays the English', () {
      final segments = segmentsForMass(english, language: 'sw');
      expect(segments.map((s) => s.locale).toSet(), {'en'});
    });
  });
}
