import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/listen/listen_queue.dart';
import 'package:lectio/features/listen/listen_screen.dart';
import 'package:lectio/features/listen/listen_segment.dart';
import 'package:lectio/features/listen/listen_strings.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';

import '../../data/fake_api.dart';
import '../../data/fixtures.dart';
import 'fake_players.dart';

const String seedDate = '2026-09-20';

DateTime clock() => DateTime(2026, 9, 20, 9);

/// The day-with-audio fixture with [edit] applied, as JSON.
String editedDay(void Function(Map<String, Object?> day) edit) {
  final day = fixtureObject('day-with-audio');
  edit(day);
  return jsonEncode(day);
}

/// The masses of [day].
List<Map<String, Object?>> massesOf(Map<String, Object?> day) {
  return (day['masses']! as List<Object?>).cast<Map<String, Object?>>();
}

void main() {
  late FakeApi api;
  late MemoryApiCache cache;
  late LectioRepository repository;
  late FakeAudioFilePlayer player;
  late FakeSpeechEngine speech;
  late ListenQueue queue;
  late SettingsController settings;

  setUp(() {
    api = FakeApi()..serveFixture('days/$seedDate.json', 'day-with-audio');
    cache = MemoryApiCache();
    repository = LectioRepository(
      client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
      cache: cache,
      clock: clock,
    );
    player = FakeAudioFilePlayer();
    speech = FakeSpeechEngine();
    queue = ListenQueue(player: player, speech: speech);
    settings = SettingsController(MemoryKeyValueStore());
  });

  Widget app(Widget child) {
    return SettingsScope(
      notifier: settings,
      child: MaterialApp(home: Scaffold(body: child)),
    );
  }

  Future<void> pumpListen(
    WidgetTester tester, {
    String? date = seedDate,
    String? mass,
  }) async {
    await tester.pumpWidget(
      app(
        ListenScreen(
          repository: repository,
          queue: queue,
          date: date,
          mass: mass,
          clock: clock,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Finder tooltip(String text) => find.byTooltip(text);

  testWidgets('shows a spinner, then the queue of the day', (tester) async {
    await tester.pumpWidget(
      app(ListenScreen(repository: repository, queue: queue, clock: clock)),
    );
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpAndSettle();

    expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    expect(find.text('Mass of the day'), findsOneWidget);
    expect(find.text('1 of 3 · Mt 20:1-16a · Context'), findsOneWidget);
    expect(find.text('Labourers in the vineyard'), findsNWidgets(2));
    expect(find.text('Mt 20:1-16a · Context · 1:14'), findsOneWidget);
    expect(find.text('Mt 20:1-16a · Translation note'), findsOneWidget);
    expect(
      find.text('Mt 20:1-16a · Translation note · Device voice'),
      findsOneWidget,
    );
    expect(find.text('1×'), findsOneWidget);
    expect(tooltip(ListenStrings.play), findsOneWidget);
    expect(queue.status, ListenStatus.idle);
    expect(queue.queueId, isNull);
  });

  testWidgets('plays, shows progress and pauses', (tester) async {
    await pumpListen(tester);
    await tester.tap(tooltip(ListenStrings.play));
    await tester.pumpAndSettle();

    expect(queue.queueId, listenQueueId(seedDate, 'day'));
    expect(queue.status, ListenStatus.playing);
    expect(tooltip(ListenStrings.pause), findsOneWidget);
    expect(find.text('0:00 / 1:00'), findsOneWidget);
    expect(find.byIcon(Icons.graphic_eq), findsOneWidget);

    player.moveTo(const Duration(seconds: 30));
    await tester.pump();
    expect(find.text('0:30 / 1:00'), findsOneWidget);
    final bar = tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator),
    );
    expect(bar.value, 0.5);

    await tester.tap(tooltip(ListenStrings.pause));
    await tester.pumpAndSettle();
    expect(queue.status, ListenStatus.paused);
    expect(tooltip(ListenStrings.play), findsOneWidget);
  });

  testWidgets('a file of unknown length shows only the position', (
    tester,
  ) async {
    player.length = null;
    await pumpListen(tester);
    await tester.tap(find.text('envious · ophthalmos sou ponēros'));
    await tester.pumpAndSettle();
    expect(find.text('0:00'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsNothing);
  });

  testWidgets('a tapped segment plays; skip buttons move', (tester) async {
    await pumpListen(tester);
    await tester.tap(find.text('generous · agathos'));
    await tester.pumpAndSettle();

    expect(queue.index, 2);
    expect(queue.speaking, isTrue);
    expect(find.text('3 of 3 · Mt 20:1-16a · Translation note'), findsOne);
    expect(find.text(ListenStrings.deviceVoice), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(speech.calls.single, startsWith('speak en 1.0 Translation note'));

    await tester.tap(tooltip(ListenStrings.previous));
    await tester.pumpAndSettle();
    expect(queue.index, 1);

    await tester.tap(tooltip(ListenStrings.next));
    await tester.pumpAndSettle();
    expect(queue.index, 2);
  });

  testWidgets('says when the queue has finished', (tester) async {
    await pumpListen(tester);
    await tester.tap(find.text('generous · agathos'));
    await tester.pumpAndSettle();
    speech.complete();
    await tester.pumpAndSettle();
    expect(queue.status, ListenStatus.completed);
    expect(find.text(ListenStrings.finished), findsOneWidget);
  });

  testWidgets('starts at the Settings speed and saves a new one', (
    tester,
  ) async {
    await settings.update(const AppSettings(playbackSpeed: 1.25));
    await pumpListen(tester);
    expect(queue.speed, 1.25);
    expect(find.text('1.25×'), findsOneWidget);

    await tester.tap(tooltip(ListenStrings.speed));
    await tester.pumpAndSettle();
    await tester.tap(find.text('1.5×').last);
    await tester.pumpAndSettle();

    expect(settings.settings.playbackSpeed, 1.5);
    expect(queue.speed, 1.5);
    expect(find.text('1.5×'), findsOneWidget);
  });

  testWidgets('keeps another day playing until this one plays', (tester) async {
    await queue.load('2026-09-13/day', [testSegment(7)]);
    await queue.play();
    await pumpListen(tester);

    expect(queue.queueId, '2026-09-13/day');
    expect(queue.status, ListenStatus.playing);
    expect(tooltip(ListenStrings.play), findsOneWidget);
    expect(find.byIcon(Icons.graphic_eq), findsNothing);

    await tester.tap(tooltip(ListenStrings.play));
    await tester.pumpAndSettle();
    expect(queue.queueId, listenQueueId(seedDate, 'day'));
    expect(queue.index, 0);
  });

  testWidgets('shows the queue in play when it already holds this day', (
    tester,
  ) async {
    final day = parseApiDay(fixtureJson('day'));
    await queue.load(
      listenQueueId(seedDate, 'day'),
      segmentsForMass(day.masses.single),
    );
    await queue.skipTo(1);
    expect(queue.segments.first.usesSpeech, isTrue);

    await pumpListen(tester);

    // The newer document's audio replaces the queue's, in place.
    expect(queue.index, 1);
    expect(queue.segments.first.usesSpeech, isFalse);
    expect(find.text('2 of 3 · Mt 20:1-16a · Translation note'), findsOne);
    expect(tooltip(ListenStrings.pause), findsOneWidget);
  });

  testWidgets('offers only Masses with something to play', (tester) async {
    api.serve(
      'days/$seedDate.json',
      editedDay((day) {
        final masses = massesOf(day);
        final vigil =
            jsonDecode(jsonEncode(masses.first)) as Map<String, Object?>
              ..['id'] = 'vigil'
              ..['label'] = 'Vigil Mass';
        final readings = vigil['readings']! as List<Object?>;
        vigil['readings'] = [readings.first];
        masses.add(vigil);
      }),
    );
    await pumpListen(tester, mass: 'missing');

    expect(find.text('1 of 3 · Mt 20:1-16a · Context'), findsOneWidget);
    // A Mass with nothing to play is not offered, so there is no choice.
    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text('Mass of the day'), findsOneWidget);
  });

  testWidgets('switches Mass with the chips', (tester) async {
    api.serve(
      'days/$seedDate.json',
      editedDay((day) {
        final masses = massesOf(day);
        final vigil =
            jsonDecode(jsonEncode(masses.first)) as Map<String, Object?>
              ..['id'] = 'vigil'
              ..['label'] = 'Vigil Mass';
        final passage =
            ((vigil['readings']! as List<Object?>).last!
                    as Map<String, Object?>)['passage']!
                as Map<String, Object?>;
        passage['translationNotes'] = <Object?>[];
        masses.add(vigil);
      }),
    );
    await pumpListen(tester, mass: 'vigil');
    expect(find.text('1 of 1 · Mt 20:1-16a · Context'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Mass of the day'));
    await tester.pumpAndSettle();
    expect(find.text('1 of 3 · Mt 20:1-16a · Context'), findsOneWidget);

    await tester.tap(tooltip(ListenStrings.play));
    await tester.pumpAndSettle();
    expect(queue.queueId, listenQueueId(seedDate, 'day'));
  });

  testWidgets('a day without notes has nothing to play', (tester) async {
    api.serve(
      'days/$seedDate.json',
      editedDay((day) {
        day['celebrations'] = <Object?>[];
        for (final mass in massesOf(day)) {
          for (final reading in mass['readings']! as List<Object?>) {
            (reading! as Map<String, Object?>)['passage'] = null;
          }
        }
      }),
    );
    await pumpListen(tester);
    expect(find.text(ListenStrings.nothingToPlay), findsOneWidget);
    expect(find.text(ListenStrings.retry), findsNothing);
  });

  testWidgets('a date without a day says so', (tester) async {
    await pumpListen(tester, date: '2026-01-01');
    expect(find.text(ListenStrings.emptyDay), findsOneWidget);
    expect(find.text(ListenStrings.retry), findsNothing);
  });

  testWidgets('a failed load can be retried', (tester) async {
    api.offline = true;
    await pumpListen(tester);
    expect(find.text(ListenStrings.loadFailed), findsOneWidget);

    api.offline = false;
    await tester.tap(find.text(ListenStrings.retry));
    await tester.pumpAndSettle();
    expect(find.text('1 of 3 · Mt 20:1-16a · Context'), findsOneWidget);
  });

  testWidgets('says when it shows a saved day offline', (tester) async {
    await cache.write(
      'days/$seedDate.json',
      CachedResponse(
        body: fixture('day-with-audio'),
        fetchedAt: DateTime(2026, 9, 2),
      ),
    );
    api.offline = true;
    await pumpListen(tester);
    expect(find.text(ListenStrings.offline), findsOneWidget);
    expect(find.text('1 of 3 · Mt 20:1-16a · Context'), findsOneWidget);
  });

  testWidgets('follows a new date or Mass', (tester) async {
    await pumpListen(tester);
    api.serve(
      'days/2026-09-21.json',
      editedDay((day) => day['date'] = '2026-09-21'),
    );
    await pumpListen(tester, date: '2026-09-21');
    await tester.tap(tooltip(ListenStrings.play));
    await tester.pumpAndSettle();
    expect(queue.queueId, listenQueueId('2026-09-21', 'day'));
  });

  testWidgets('listenRoute reads the date and Mass from the location', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/listen?date=$seedDate&mass=day',
      routes: [listenRoute(repository: repository, queue: queue, clock: clock)],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      SettingsScope(
        notifier: settings,
        child: MaterialApp.router(
          routerConfig: router,
          builder: (context, child) => Scaffold(body: child),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final screen = tester.widget<ListenScreen>(find.byType(ListenScreen));
    expect(screen.date, seedDate);
    expect(screen.mass, 'day');
    expect(screen.queue, queue);
  });

  test('clockLabel writes minutes and hours', () {
    expect(clockLabel(const Duration(seconds: 5)), '0:05');
    expect(clockLabel(const Duration(minutes: 12, seconds: 3)), '12:03');
    expect(
      clockLabel(const Duration(hours: 1, minutes: 2, seconds: 3)),
      '1:02:03',
    );
  });

  test('the shared queue is built once and can be replaced', () {
    addTearDown(() => appListenQueue = null);
    final shared = appListenQueue;
    expect(appListenQueue, same(shared));
    appListenQueue = queue;
    expect(appListenQueue, same(queue));
    appListenQueue = null;
    expect(appListenQueue, isNot(same(queue)));
  });
}
