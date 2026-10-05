import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:lectio/features/share/share_text.dart';
import 'package:share_plus/share_plus.dart';

/// What is shared: a day, a reading or one insight.
@immutable
class ShareContent {
  /// Creates the share of the page at [url], titled [title], with the
  /// reference [ref] and the one-line [insight] (or `null`).
  const new({
    required this.title,
    required this.ref,
    required this.insight,
    required this.url,
  });

  /// The page title: the share sheet's subject (email subject, for one).
  final String title;

  /// The reference: a day's title and date, a reading's reference or an
  /// insight's heading.
  final String ref;

  /// A one-line insight, or `null` when there is none yet.
  final String? insight;

  /// The absolute URL of the page on the site.
  final Uri url;

  /// The share text: reference, insight and link, one per line
  /// ([buildShareText]).
  String get text {
    return buildShareText(ref: ref, insight: insight, url: url.toString());
  }

  /// The subject: the title on one line.
  String get subject => oneLine(title);

  @override
  bool operator ==(Object other) {
    return other is ShareContent &&
        other.title == title &&
        other.ref == ref &&
        other.insight == insight &&
        other.url == url;
  }

  @override
  int get hashCode => Object.hash(title, ref, insight, url);

  @override
  String toString() => 'ShareContent($ref, $url)';
}

/// How a share attempt ended, as on the site.
enum ShareOutcome {
  /// The share sheet completed (or closed without saying how).
  shared,

  /// The reader closed the sheet without sharing.
  cancelled,

  /// An earlier share is still open: nothing to do.
  busy,

  /// There is no share sheet, or it failed: copy the text instead.
  fallback,
}

/// Opens share_plus's sheet with [params], as `SharePlus.instance.share`.
typedef SharePlusShare = Future<ShareResult> Function(ShareParams params);

/// The device's share sheet.
///
/// [SharePlusSheet] implements it on share_plus; tests pass a fake.
abstract interface class ShareSheet {
  /// Shares [content]; on tablets the sheet points at [origin], the shared
  /// button's rectangle in global coordinates.
  Future<ShareOutcome> share(ShareContent content, {Rect? origin});
}

/// [ShareSheet] on share_plus.
///
/// The sheet gets the share text ([ShareContent.text]) and the title as its
/// subject. One share runs at a time: a share asked for while the sheet is
/// still open is `busy` and does nothing (share_plus would otherwise answer
/// the first one as unavailable). `unavailable` means the platform could
/// not say how the sheet closed, so it counts as shared; a failure (no
/// plugin, a platform error) is the `fallback`.
class SharePlusSheet implements ShareSheet {
  /// Creates the sheet on [share] (default: `SharePlus.instance.share`).
  new({SharePlusShare? share}) : _share = share ?? SharePlus.instance.share;

  final SharePlusShare _share;
  bool _open = false;

  @override
  Future<ShareOutcome> share(ShareContent content, {Rect? origin}) async {
    if (_open) return ShareOutcome.busy;
    _open = true;
    try {
      final result = await _share(
        ShareParams(
          text: content.text,
          subject: content.subject,
          title: content.subject,
          sharePositionOrigin: origin,
        ),
      );
      if (result.status == ShareResultStatus.dismissed) {
        return ShareOutcome.cancelled;
      }
      return ShareOutcome.shared;
    } on PlatformException {
      return ShareOutcome.fallback;
    } on MissingPluginException {
      return ShareOutcome.fallback;
    } finally {
      _open = false;
    }
  }
}

ShareSheet? _appShareSheet;

/// The share sheet every share button uses, built on first use.
ShareSheet get appShareSheet => _appShareSheet ??= SharePlusSheet();

/// Replaces the shared sheet, for example with a fake in tests; `null`
/// builds a new default one on next use.
@visibleForTesting
set appShareSheet(ShareSheet? sheet) => _appShareSheet = sheet;
