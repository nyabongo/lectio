import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:lectio/data/models/documents.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/listen/locale.dart';

import '../../data/fixtures.dart';

/// A text-to-speech engine with the voices in [available], recording the
/// language it was set to.
class FakeTtsVoices implements TtsVoices {
  /// Creates the fake.
  new(this.available);

  /// The voices the device has.
  final Set<String> available;

  /// Every voice asked about, in order.
  final List<String> asked = [];

  /// The voice set last, or `null`.
  String? language;

  @override
  Future<bool> isLanguageAvailable(String language) async {
    asked.add(language);
    return available.contains(language);
  }

  @override
  Future<void> setLanguage(String language) async {
    this.language = language;
  }
}

/// The fixture passage in [locale], with audio on its context note when
/// [withAudio].
PassageNotes passageIn(String locale, {bool withAudio = false}) {
  final json = fixtureObject('passage');
  final passage = json['passage']! as Map<String, Object?>;
  passage['locale'] = locale;
  if (withAudio) {
    (passage['context']! as Map<String, Object?>)['audio'] = {
      'url': 'https://audio.example/context.mp3',
    };
  }
  return ApiPassage.fromJson(json).passage;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('NarrationLocale', () {
    test('Kiswahili notes are spoken in Kiswahili, the rest in English', () {
      expect(NarrationLocale.of('sw'), NarrationLocale.sw);
      expect(NarrationLocale.of('en'), NarrationLocale.en);
      expect(NarrationLocale.of('fr'), NarrationLocale.en);
      expect(NarrationLocale.sw.voices.first, 'sw-KE');
      expect(NarrationLocale.en.voices.first, 'en-GB');
    });
  });

  group('narratedPassage', () {
    final english = passageIn('en', withAudio: true);
    final translated = passageIn('sw');
    final fallback = passageIn('en');

    test('uses the Kiswahili segments when the mirror has them', () {
      expect(
        narratedPassage(
          language: 'sw',
          english: english,
          localized: translated,
        ),
        same(translated),
      );
    });

    test('falls back to the English notes and their audio', () {
      expect(
        narratedPassage(language: 'sw', english: english, localized: fallback),
        same(english),
      );
      expect(narratedPassage(language: 'sw', english: english), same(english));
      expect(
        narratedPassage(
          language: 'en',
          english: english,
          localized: translated,
        ),
        same(english),
      );
    });
  });

  group('narrationSegments', () {
    test('queues the context, then each note, in the passage language', () {
      final segments = narrationSegments(passageIn('sw'));
      expect(segments.map((segment) => segment.id), [
        'context',
        'v15-evil-eye',
        'v15-agathos',
      ]);
      expect(
        segments.map((segment) => segment.locale).toSet(),
        {NarrationLocale.sw},
      );
      expect(segments.every((segment) => segment.usesTextToSpeech), isTrue);
    });

    test('drops claim markers from the spoken text', () {
      final segments = narrationSegments(passageIn('en'));
      expect(segments.first.text, startsWith('Labourers in the vineyard\n\n'));
      expect(segments.first.text, isNot(contains('[c')));
      expect(segments[1].text, endsWith('loses the echo of Mt 6:22-23.'));
    });

    test('plays rendered audio when there is some', () {
      final context = narrationSegments(passageIn('en', withAudio: true)).first;
      expect(context.usesTextToSpeech, isFalse);
      expect(context.audio!.url, Uri.parse('https://audio.example/context.mp3'));
      expect(context.locale, NarrationLocale.en);
    });
  });

  group('useVoiceFor', () {
    test('picks the first Kiswahili voice the device has', () async {
      final tts = FakeTtsVoices({'sw-TZ', 'en-GB'});
      expect(await useVoiceFor(NarrationLocale.sw, tts), 'sw-TZ');
      expect(tts.language, 'sw-TZ');
      expect(tts.asked, ['sw-KE', 'sw-TZ']);
    });

    test('falls back to an English voice without a Kiswahili one', () async {
      final tts = FakeTtsVoices({'en-US'});
      expect(await useVoiceFor(NarrationLocale.sw, tts), 'en-US');
      expect(tts.asked, ['sw-KE', 'sw-TZ', 'sw', 'en-GB', 'en-US']);
    });

    test('asks for each English voice once', () async {
      final tts = FakeTtsVoices({});
      expect(await useVoiceFor(NarrationLocale.en, tts), isNull);
      expect(tts.language, isNull);
      expect(tts.asked, ['en-GB', 'en-US', 'en']);
    });
  });

  group('FlutterTtsVoices', () {
    const channel = MethodChannel('flutter_tts');
    late List<MethodCall> calls;
    late Object? availability;

    setUp(() {
      calls = [];
      availability = true;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
            return call.method == 'isLanguageAvailable' ? availability : 1;
          });
    });

    tearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });

    test('asks flutter_tts whether a voice exists', () async {
      final voices = FlutterTtsVoices(tts: FlutterTts());
      expect(await voices.isLanguageAvailable('sw-KE'), isTrue);
      availability = 1;
      expect(await voices.isLanguageAvailable('sw-KE'), isTrue);
      availability = false;
      expect(await voices.isLanguageAvailable('sw-KE'), isFalse);
      expect(calls.last.method, 'isLanguageAvailable');
      expect('${calls.last.arguments}', contains('sw-KE'));
    });

    test('sets the flutter_tts language', () async {
      await FlutterTtsVoices().setLanguage('sw-KE');
      expect(calls.last.method, 'setLanguage');
      expect('${calls.last.arguments}', contains('sw-KE'));
    });
  });
}
