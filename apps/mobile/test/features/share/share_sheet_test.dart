import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/share/share_sheet.dart';
import 'package:share_plus/share_plus.dart';

final ShareContent _content = ShareContent(
  title: 'Mt 20:1-16a ·\nGospel',
  ref: 'Mt 20:1-16a',
  insight: 'A landowner pays the last hired the same as the first.',
  url: Uri.parse('https://example.org/lectio/2026-09-20/gospel/?utm=x'),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ShareContent', () {
    test('builds the share text and the subject', () {
      expect(
        _content.text,
        'Mt 20:1-16a\n'
        'A landowner pays the last hired the same as the first.\n'
        'https://example.org/lectio/2026-09-20/gospel/',
      );
      expect(_content.subject, 'Mt 20:1-16a · Gospel');
    });

    test('is a value', () {
      final same = ShareContent(
        title: _content.title,
        ref: _content.ref,
        insight: _content.insight,
        url: _content.url,
      );
      expect(same, _content);
      expect(same.hashCode, _content.hashCode);
      expect(_content, isNot(same.copyWithRef('Mt 20:1')));
      expect(_content.toString(), contains('Mt 20:1-16a'));
    });
  });

  group('SharePlusSheet', () {
    late List<ShareParams> calls;

    SharePlusSheet sheetAnswering(Future<ShareResult> Function() answer) {
      calls = [];
      return SharePlusSheet(
        share: (params) {
          calls.add(params);
          return answer();
        },
      );
    }

    test('shares the text, with the title as subject and the origin', () async {
      final sheet = sheetAnswering(
        () async => const ShareResult('app', ShareResultStatus.success),
      );
      const origin = Rect.fromLTWH(1, 2, 3, 4);
      expect(await sheet.share(_content, origin: origin), ShareOutcome.shared);
      final params = calls.single;
      expect(params.text, _content.text);
      expect(params.subject, 'Mt 20:1-16a · Gospel');
      expect(params.title, 'Mt 20:1-16a · Gospel');
      expect(params.uri, isNull);
      expect(params.sharePositionOrigin, origin);
    });

    test('a dismissed sheet is cancelled', () async {
      final sheet = sheetAnswering(
        () async => const ShareResult('', ShareResultStatus.dismissed),
      );
      expect(await sheet.share(_content), ShareOutcome.cancelled);
    });

    test('an unknown ending counts as shared', () async {
      final sheet = sheetAnswering(() async => ShareResult.unavailable);
      expect(await sheet.share(_content), ShareOutcome.shared);
    });

    test('a failure is the fallback', () async {
      var sheet = sheetAnswering(
        () => throw PlatformException(code: 'error'),
      );
      expect(await sheet.share(_content), ShareOutcome.fallback);
      sheet = sheetAnswering(() => throw MissingPluginException());
      expect(await sheet.share(_content), ShareOutcome.fallback);
      // The sheet is free again after a failure.
      expect(await sheet.share(_content), ShareOutcome.fallback);
      expect(calls, hasLength(2));
    });

    test('a share while the sheet is open is busy', () async {
      final open = Completer<ShareResult>();
      final sheet = sheetAnswering(() => open.future);
      final first = sheet.share(_content);
      expect(await sheet.share(_content), ShareOutcome.busy);
      expect(calls, hasLength(1));
      open.complete(const ShareResult('app', ShareResultStatus.success));
      expect(await first, ShareOutcome.shared);
    });
  });

  test('appShareSheet is built once and can be replaced', () {
    final sheet = appShareSheet;
    expect(sheet, isA<SharePlusSheet>());
    expect(appShareSheet, same(sheet));
    final other = SharePlusSheet();
    appShareSheet = other;
    expect(appShareSheet, same(other));
    appShareSheet = null;
    expect(appShareSheet, isNot(same(other)));
  });
}

extension on ShareContent {
  ShareContent copyWithRef(String ref) {
    return ShareContent(title: title, ref: ref, insight: insight, url: url);
  }
}
