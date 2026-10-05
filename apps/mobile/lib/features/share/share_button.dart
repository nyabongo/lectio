import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/reading/reading_strings.dart';
import 'package:lectio/features/reading/reading_view.dart';
import 'package:lectio/features/share/share_sheet.dart';
import 'package:lectio/features/share/site_links.dart';
import 'package:lectio/features/today/today_labels.dart';

/// The share strings (L-114 translates them), as on the site.
abstract final class ShareStrings {
  /// The button's tooltip, which screen readers say: `Share Mt 20:1-16a`.
  static String shareLabel(String what) => 'Share $what';

  /// Shown when the text was copied instead of shared.
  static const String copied = 'Copied the link with its reference.';

  /// Shown when neither sharing nor copying worked.
  static const String failed = 'Could not share or copy the link.';

  /// Shown when a link opened Today because the app has no page for it.
  static const String linkNotRecognised =
      'Lectio has no page for that link, so it opened Today.';
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
/// [siteBaseUrl]).
ShareContent dayShare(ApiDay day, {Uri? site}) {
  final date = formatDayDate(day.date);
  final celebration = day.celebrations.firstOrNull?.name;
  final ref = celebration == null ? date : '$celebration, $date';
  return ShareContent(
    title: ref,
    ref: ref,
    insight: dayInsight(day),
    url: siteUrl(dayPagePath(day.date), site: site),
  );
}

/// The share of [reading] on the ISO [date]: its reference, its notes'
/// summary when approved, and its page on [site] (default: [siteBaseUrl]).
ShareContent readingShare(String date, DayReading reading, {Uri? site}) {
  final slot = ReadingStrings.en.slotLabel(reading.slot);
  return ShareContent(
    title: '${reading.ref} · $slot',
    ref: reading.ref,
    insight: _summary(reading),
    url: siteUrl(readingPagePath(date, reading.slot), site: site),
  );
}

/// The share of one insight, [note] in [passage], whose reading is at the
/// site path [page] (`2026-09-20/gospel/`): `“anchor” · Mt 20:1-16a, verse
/// 15`, the note's summary and its page on [site] (default: [siteBaseUrl]).
ShareContent noteShare(
  PassageNotes passage,
  TranslationNote note,
  String page, {
  Uri? site,
}) {
  final verse = verseLabel(passage, note);
  final heading = '“${note.anchor}” · ${passage.ref}, verse $verse';
  return ShareContent(
    title: heading,
    ref: heading,
    insight: note.summary,
    url: siteUrl('${page}notes/${note.id}/', site: site),
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
  final box = context.findRenderObject();
  Rect? origin;
  if (box is RenderBox && box.hasSize) {
    origin = box.localToGlobal(Offset.zero) & box.size;
  }
  final target = sheet ?? appShareSheet;
  final outcome = await target.share(content, origin: origin);
  if (outcome != ShareOutcome.fallback) return outcome;
  var message = ShareStrings.copied;
  try {
    await copy(content.text);
  } on Exception {
    message = ShareStrings.failed;
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
      tooltip: ShareStrings.shareLabel(content.ref),
      icon: const Icon(Icons.share_outlined),
      onPressed: () => unawaited(shareFrom(context, content, sheet: sheet)),
    );
  }
}
