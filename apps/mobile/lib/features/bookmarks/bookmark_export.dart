import 'dart:convert';

import 'package:flutter/rendering.dart';
import 'package:share_plus/share_plus.dart';

/// Opens the platform share sheet; [defaultShareSheet] in the app, a fake in
/// tests.
typedef ShareSheet = Future<ShareResult> Function(ShareParams params);

/// The share sheet of share_plus.
ShareSheet defaultShareSheet() => SharePlus.instance.share;

/// The file name the export is shared as.
const String exportFileName = 'lectio-bookmarks.json';

/// What the share sheet gets for an export: [json] as a file named
/// [exportFileName]. [origin] anchors the sheet on iPad.
ShareParams bookmarkExportParams(String json, {Rect? origin}) {
  return ShareParams(
    files: [XFile.fromData(utf8.encode(json), mimeType: 'application/json')],
    fileNameOverrides: const [exportFileName],
    subject: 'Lectio bookmarks and notes',
    sharePositionOrigin: origin,
  );
}

/// Where [box] is on screen, to anchor the share sheet; `null` when it is
/// not laid out as a box.
Rect? shareOrigin(RenderObject? box) {
  if (box is! RenderBox || !box.hasSize) return null;
  return box.localToGlobal(Offset.zero) & box.size;
}
