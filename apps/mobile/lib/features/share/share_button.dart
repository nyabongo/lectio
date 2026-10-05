import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/reading/reading_view.dart';
import 'package:lectio/features/share/share_sheet.dart';
import 'package:lectio/features/share/site_links.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// The share strings in the UI language: the site's `share` messages, and
/// the app's own (`app_share_*`).
class ShareStrings {
  /// The strings of [_l10n].
  const new(this._l10n);

  /// The strings of the nearest localizations (English without them).
  factory of(BuildContext context) {
    return ShareStrings(LectioLocalizations.of(context));
  }

  /// The English strings.
  static final ShareStrings en = ShareStrings(LectioLocalizations.en);

  final LectioLocalizations _l10n;

  /// The button's tooltip, which screen readers say: `Share Mt 20:1-16a`.
  String shareLabel(String what) {
    return _l10n.text('share_buttonLabel', {'what': what});
  }

  /// Shown when the text was copied instead of shared.
  String get copied => _l10n.text('share_copied');

  /// Shown when neither sharing nor copying worked.
  String get failed => _l10n.text('app_share_failed');

  /// Shown when a link opened Today because the app has no page for it.
  String get linkNotRecognised => _l10n.text('app_share_linkNotRecognised');
}

/// The site path [path] (relative to the site root) of the page in
/// [language]: Kiswahili pages live under `sw/` (`sw/2026-09-20/gospel/`),
/// English ones at the root.
String localizedPagePath(String path, String language) {
  return language == 'sw' ? 'sw/$path' : path;
}

/// Writes [text] to the clipboard.
typedef ClipboardWriter = Future<void> Function(String text);

Future<void> _copyToClipboard(String text) {
  return Clipboard.setData(ClipboardData(text: text));
}

/// The approved notes' summary of [reading], or `null`.
String? _summary(DayReading reading) {
  final passage = reading.passage;
  return passage != null && isApproved(passage) ? passage.summary : null;
}

/// The one-line insight of [day]: its Gospel's summary, else the first
/// reading summary, else `null` (approved notes only), as on the site.
String? dayInsight(ApiDay day) {
  final readings = [for (final mass in day.masses) ...mass.readings];
  final gospels = readings.where((reading) => reading.slot == 'gospel');
  final gospel = gospels.map(_summary).nonNulls.firstOrNull;
  return gospel ?? readings.map(_summary).nonNulls.firstOrNull;
}

/// The share of a day: `Twenty-fifth Sunday in Ordinary Time, Sunday 20
/// September 2026`, the [dayInsight] and the day's page on [site] (default:
/// [siteBaseUrl]), all in [language] (the `sw/` page in Kiswahili).
ShareContent dayShare(ApiDay day, {Uri? site, String language = 'en'}) {
  final l10n = LectioLocalizations.forLanguage(language);
  final date = formatLongDate(day.date, language);
  final celebration = day.celebrations.firstOrNull?.nameIn(language).text;
  final ref = celebration == null
      ? date
      : l10n.text('day_pageTitle', {'title': celebration, 'date': date});
  return ShareContent(
    title: ref,
    ref: ref,
    insight: dayInsight(day),
    url: siteUrl(
      localizedPagePath(dayPagePath(day.date), language),
      site: site,
    ),
  );
}

/// The share of [reading] on the ISO [date]: its reference, its notes'
/// summary when approved, and its page on [site] (default: [siteBaseUrl]),
/// in [language].
ShareContent readingShare(
  String date,
  DayReading reading, {
  Uri? site,
  String language = 'en',
}) {
  final l10n = LectioLocalizations.forLanguage(language);
  final slot = slotLabelIn(l10n, reading.slot);
  return ShareContent(
    title: l10n.text('reading_pageTitle', {'ref': reading.ref, 'slot': slot}),
    ref: reading.ref,
    insight: _summary(reading),
    url: siteUrl(
      localizedPagePath(readingPagePath(date, reading.slot), language),
      site: site,
    ),
  );
}

/// The share of one insight, [note] in [passage], whose reading is at the
/// site path [page] (`2026-09-20/gospel/`): `“anchor” · Mt 20:1-16a, verse
/// 15`, the note's summary and its page on [site] (default: [siteBaseUrl]),
/// in [language].
ShareContent noteShare(
  PassageNotes passage,
  TranslationNote note,
  String page, {
  Uri? site,
  String language = 'en',
}) {
  final heading = LectioLocalizations.forLanguage(language).text(
    'insight_pageTitle',
    {
      'anchor': note.anchor,
      'ref': passage.ref,
      'verse': verseLabel(passage, note),
    },
  );
  return ShareContent(
    title: heading,
    ref: heading,
    insight: note.summary,
    url: siteUrl(
      localizedPagePath('${page}notes/${note.id}/', language),
      site: site,
    ),
  );
}

/// Shares [content] on [sheet] (default: [appShareSheet]), the sheet
/// pointing at [context]'s widget. When there is no share sheet or it
/// fails, copies the share text with [copy] (default: the clipboard) and
/// says so in a snack bar.
Future<ShareOutcome> shareFrom(
  BuildContext context,
  ShareContent content, {
  ShareSheet? sheet,
  ClipboardWriter copy = _copyToClipboard,
}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final strings = ShareStrings.of(context);
  final box = context.findRenderObject();
  Rect? origin;
  if (box is RenderBox && box.hasSize) {
    origin = box.localToGlobal(Offset.zero) & box.size;
  }
  final target = sheet ?? appShareSheet;
  final outcome = await target.share(content, origin: origin);
  if (outcome != ShareOutcome.fallback) return outcome;
  var message = strings.copied;
  try {
    await copy(content.text);
  } on Exception {
    message = strings.failed;
  }
  messenger?.showSnackBar(SnackBar(content: Text(message)));
  return outcome;
}

/// The Share button of a day, a reading or an insight: opens the device's
/// share sheet with the share text ([ShareContent.text]).
class ShareButton extends StatelessWidget {
  /// Creates the button that shares [content] on [sheet] (default:
  /// [appShareSheet]).
  const new({required this.content, this.sheet, super.key});

  /// What the button shares.
  final ShareContent content;

  /// The share sheet, for tests.
  final ShareSheet? sheet;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: ShareStrings.of(context).shareLabel(content.ref),
      icon: const Icon(Icons.share_outlined),
      onPressed: () => unawaited(shareFrom(context, content, sheet: sheet)),
    );
  }
}
