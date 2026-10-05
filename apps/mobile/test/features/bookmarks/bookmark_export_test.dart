import 'dart:convert';

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/bookmarks/bookmark_export.dart';

void main() {
  test('shares the export as a JSON file', () async {
    const origin = Rect.fromLTWH(10, 20, 30, 40);
    final params = bookmarkExportParams('{"a":1}', origin: origin);

    final file = params.files!.single;
    expect(file.mimeType, 'application/json');
    expect(utf8.decode(await file.readAsBytes()), '{"a":1}');
    expect(params.fileNameOverrides, [exportFileName]);
    expect(exportFileName, 'lectio-bookmarks.json');
    expect(params.subject, 'Lectio bookmarks and notes');
    expect(params.sharePositionOrigin, origin);
  });

  test('the default share sheet is share_plus', () {
    expect(defaultShareSheet(), isA<ShareSheet>());
  });

  test('a box that is not laid out has no origin', () {
    expect(shareOrigin(null), isNull);
    final box = RenderConstrainedBox(
      additionalConstraints: const BoxConstraints(),
    );
    expect(shareOrigin(box), isNull);
  });

  testWidgets('a laid-out box anchors the share sheet', (tester) async {
    final key = GlobalKey();
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Align(
          alignment: Alignment.topLeft,
          child: Padding(
            padding: const EdgeInsets.only(left: 5, top: 7),
            child: SizedBox(key: key, width: 30, height: 40),
          ),
        ),
      ),
    );

    final rect = shareOrigin(key.currentContext!.findRenderObject());
    expect(rect, const Rect.fromLTWH(5, 7, 30, 40));
  });
}
