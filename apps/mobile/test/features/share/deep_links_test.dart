import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/share/deep_links.dart';
import 'package:lectio/src/app.dart';
import 'package:lectio/src/routing/router.dart';

import '../../data/fake_api.dart';

final Uri _site = Uri.parse('https://nyabongo.github.io/lectio/');

const String _note =
    '/reading?date=2026-09-20&slot=gospel&tab=original&note=v15-evil-eye';

/// The router's current location.
String location(GoRouter router) {
  return router.routerDelegate.currentConfiguration.uri.toString();
}

/// The router of the app on screen.
GoRouter appRouter(WidgetTester tester) {
  final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
  return app.routerConfig! as GoRouter;
}

void main() {
  // The screens read a fake API that publishes no days, so tests stay
  // offline.
  setUp(() {
    appRepository = LectioRepository(
      client: ApiClient(httpClient: FakeApi().client, baseUrl: FakeApi.baseUrl),
      cache: MemoryApiCache(),
    );
  });
  tearDown(() => appRepository = null);

  group('DeepLinks', () {
    test('keeps the first link until a router is attached', () {
      final links = DeepLinks(site: _site);
      expect(links.takeInitialLocation(), isNull);
      expect(links.openLink(Uri.parse('https://example.org/')), isFalse);
      expect(links.openReminder('not a date'), isFalse);
      expect(links.takeInitialLocation(), isNull);

      expect(links.openLink(_site.resolve('2026-09-19/')), isTrue);
      expect(links.openReminder('2026-09-20'), isTrue);
      // The latest one wins, once.
      expect(links.takeInitialLocation(), '/today?date=2026-09-20');
      expect(links.takeInitialLocation(), isNull);
    });

    test('listens to a stream of links and ignores its errors', () async {
      final links = DeepLinks(site: _site);
      final source = StreamController<Uri>();
      final subscription = links.listen(source.stream);
      source
        ..addError(StateError('bad link'))
        ..add(Uri.parse('lectio://2026-09-20/gospel/notes/v15-evil-eye'));
      await pumpEventQueue();
      await subscription.cancel();
      await source.close();
      expect(links.takeInitialLocation(), _note);
    });

    test('defaults to the site of this build', () {
      expect(DeepLinks().openLink(Uri.parse('lectio://')), isTrue);
    });
  });

  group('site paths in the router', () {
    for (final (path, expected) in [
      ('/2026-09-20', '/today?date=2026-09-20'),
      ('/2026-09-20/listen', '/listen?date=2026-09-20'),
      ('/2026-09-20/gospel', '/reading?date=2026-09-20&slot=gospel'),
      ('/2026-09-20/gospel/notes/v15-evil-eye', _note),
      ('/sw/2026-09-20', '/today?date=2026-09-20'),
      ('/sw/2026-09-20/gospel/notes/v15-evil-eye', _note),
    ]) {
      testWidgets('$path opens $expected', (tester) async {
        await tester.pumpWidget(const LectioApp());
        await tester.pump();
        final router = appRouter(tester)..go(path);
        await tester.pump();
        await tester.pump();
        expect(location(router), expected);
      });
    }

    testWidgets('other paths are not found', (tester) async {
      await tester.pumpWidget(const LectioApp());
      await tester.pump();
      appRouter(tester).go('/2026-09-20/Gospel');
      await tester.pump();
      await tester.pump();
      expect(find.byType(NotFoundScreen), findsOneWidget);
    });
  });

  group('the app', () {
    testWidgets('starts at the link that launched it', (tester) async {
      final links = DeepLinks(site: _site)
        ..openLink(_site.resolve('2026-09-20/gospel/'));
      await tester.pumpWidget(LectioApp(links: links));
      await tester.pump();
      expect(
        location(appRouter(tester)),
        '/reading?date=2026-09-20&slot=gospel',
      );
    });

    testWidgets('opens later links and reminder taps', (tester) async {
      final links = DeepLinks(site: _site);
      await tester.pumpWidget(LectioApp(links: links));
      await tester.pump();
      final router = appRouter(tester);
      expect(location(router), '/today');

      links.openLink(Uri.parse('lectio://2026-09-20/gospel/notes/v15-a'));
      await tester.pump();
      expect(location(router), _note.replaceAll('v15-evil-eye', 'v15-a'));

      links.openReminder('2026-09-21');
      await tester.pump();
      expect(location(router), '/today?date=2026-09-21');

      // Once the app is gone, links wait for the next one.
      await tester.pumpWidget(const SizedBox());
      links.openReminder('2026-09-22');
      expect(links.takeInitialLocation(), '/today?date=2026-09-22');
    });

    testWidgets('detach leaves another router attached', (tester) async {
      final links = DeepLinks(site: _site);
      final first = createRouter();
      final second = createRouter();
      addTearDown(first.dispose);
      addTearDown(second.dispose);
      links
        ..openReminder('2026-09-19')
        ..attach(first)
        ..detach(second)
        ..openReminder('2026-09-20');
      expect(links.takeInitialLocation(), isNull);
      // The waiting link went to the router when it was attached.
      expect(
        first.routeInformationProvider.value.uri.toString(),
        '/today?date=2026-09-20',
      );
    });
  });
}
