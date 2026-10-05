import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/app_repository.dart';
import 'package:lectio/features/reading/reading_scope.dart';
import 'package:url_launcher/url_launcher.dart';

import 'reading_harness.dart';

void main() {
  test("the default repository is the app's shared one", () {
    expect(defaultReadingRepository(), same(appRepository));
  });

  testWidgets('without a scope, the defaults apply', (tester) async {
    late BuildContext captured;
    await tester.pumpWidget(
      Builder(
        builder: (context) {
          captured = context;
          return const SizedBox();
        },
      ),
    );
    expect(ReadingScope.maybeOf(captured), isNull);
    expect(
      identical(
        ReadingScope.repositoryOf(captured),
        defaultReadingRepository(),
      ),
      isTrue,
    );
    expect(ReadingScope.launcherOf(captured), launchExternally);
  });

  testWidgets('a scope provides its repository and launcher', (tester) async {
    final harness = ReadingHarness();
    late BuildContext captured;
    await tester.pumpWidget(
      harness.wrap(
        Builder(
          builder: (context) {
            captured = context;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(ReadingScope.repositoryOf(captured), harness.repository);
    expect(ReadingScope.launcherOf(captured), harness.launch);
  });

  test('updateShouldNotify compares the repository and launcher', () {
    final a = ReadingHarness();
    final b = ReadingHarness();
    final scope = ReadingScope(
      repository: a.repository,
      launchLink: a.launch,
      child: const SizedBox(),
    );
    final same = ReadingScope(
      repository: a.repository,
      launchLink: a.launch,
      child: const SizedBox(),
    );
    final otherRepository = ReadingScope(
      repository: b.repository,
      launchLink: a.launch,
      child: const SizedBox(),
    );
    final otherLauncher = ReadingScope(
      repository: a.repository,
      child: const SizedBox(),
    );
    expect(scope.updateShouldNotify(same), isFalse);
    expect(scope.updateShouldNotify(otherRepository), isTrue);
    expect(scope.updateShouldNotify(otherLauncher), isTrue);
  });

  test('launchExternally opens the link outside the app', () async {
    final calls = <(Uri, LaunchMode)>[];
    Future<bool> fake(Uri url, {LaunchMode mode = LaunchMode.platformDefault}) {
      calls.add((url, mode));
      return Future.value(true);
    }

    final url = Uri.parse('https://example.org/');
    expect(await launchExternally(url, launch: fake), isTrue);
    expect(calls, [(url, LaunchMode.externalApplication)]);
  });

  group('openLink', () {
    Future<BuildContext> pumpScope(
      WidgetTester tester,
      ReadingHarness harness,
    ) async {
      late BuildContext captured;
      await tester.pumpWidget(
        harness.wrap(
          Builder(
            builder: (context) {
              captured = context;
              return const SizedBox();
            },
          ),
        ),
      );
      return captured;
    }

    final url = Uri.parse('https://example.org/');

    testWidgets('opens the link quietly', (tester) async {
      final harness = ReadingHarness();
      final context = await pumpScope(tester, harness);
      await openLink(context, url);
      await tester.pump();
      expect(harness.launched, [url]);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('says so when nothing can open it', (tester) async {
      final harness = ReadingHarness()..launchResult = false;
      final context = await pumpScope(tester, harness);
      await openLink(context, url);
      await tester.pump();
      expect(find.text('The link could not be opened.'), findsOneWidget);
    });

    testWidgets('says so when the launcher fails', (tester) async {
      final harness = ReadingHarness()..launchThrows = true;
      final context = await pumpScope(tester, harness);
      await openLink(context, url);
      await tester.pump();
      expect(find.text('The link could not be opened.'), findsOneWidget);
    });

    for (final link in [
      'http://example.org/',
      'intent://scan#Intent;scheme=zxing;end',
      'javascript:alert(1)',
      'tel:+254700000000',
    ]) {
      testWidgets('refuses $link', (tester) async {
        final harness = ReadingHarness();
        final context = await pumpScope(tester, harness);
        await openLink(context, Uri.parse(link));
        await tester.pump();
        expect(harness.launched, isEmpty);
        expect(find.text('The link could not be opened.'), findsOneWidget);
      });
    }

    testWidgets('without a messenger, a failure is silent', (tester) async {
      final harness = ReadingHarness()..launchResult = false;
      late BuildContext captured;
      await tester.pumpWidget(
        ReadingScope(
          repository: harness.repository,
          launchLink: harness.launch,
          child: Builder(
            builder: (context) {
              captured = context;
              return const SizedBox();
            },
          ),
        ),
      );
      await openLink(captured, url);
      expect(harness.launched, [url]);
    });
  });
}
