/// What the Reading screen derives from a day document: which reading a slot
/// shows, the citation segments of marked-up prose, text direction and the
/// report-an-issue link. Mirrors `apps/web/src/lib/reading.ts`.
library;

import 'package:flutter/widgets.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';

/// The id of the Mass during the Day, whose readings win a shared slot.
const String principalMassId = 'day';

/// The slot the Reading tab opens when none is named.
const String defaultSlot = 'gospel';

/// The repository that takes content reports.
final Uri contentIssueRepo = Uri.parse('https://github.com/nyabongo/lectio');

/// The issue form a report link opens.
const String contentIssueTemplate = 'content-issue.yml';

/// The note id a report about the Context panel carries (note ids are slugs,
/// which never start with `_`).
const String contextNoteId = '_context';

/// The readings of [day] by slot, in display order. When several Masses share
/// a slot (Easter, Christmas and other vigil solemnities), the Mass during the
/// Day wins, then the first Mass in calendar order that has the slot.
Map<String, DayReading> readingsBySlot(ApiDay day) {
  final masses = [
    ...day.masses.where((mass) => mass.id == principalMassId),
    ...day.masses.where((mass) => mass.id != principalMassId),
  ];
  final bySlot = <String, DayReading>{};
  for (final mass in masses) {
    for (final reading in mass.readings) {
      bySlot.putIfAbsent(reading.slot, () => reading);
    }
  }
  return bySlot;
}

/// The reading of [day] to show for [slot], or `null` when there is none.
///
/// Without a [slot], the Gospel, else the first reading with notes, else the
/// first reading.
DayReading? pickReading(ApiDay day, String? slot) {
  final bySlot = readingsBySlot(day);
  if (slot != null) return bySlot[slot];
  final readings = bySlot.values;
  return bySlot[defaultSlot] ??
      readings.where((reading) => reading.passage != null).firstOrNull ??
      readings.firstOrNull;
}

const Set<String> _rtlLanguages = {'hbo', 'he', 'arc', 'ar', 'syc'};

/// Right to left for Hebrew-script (and other right-to-left) language tags.
TextDirection textDirectionFor(String lang) {
  final base = lang.split('-').first;
  return _rtlLanguages.contains(base) ? TextDirection.rtl : TextDirection.ltr;
}

/// The locale of an original-language tag (the schema's `lat` is `la`).
Locale localeFor(String lang) => Locale(lang == 'lat' ? 'la' : lang);

/// A source and its 1-based position in the passage's sources: the same
/// number wherever the source is cited.
class NumberedSource {
  /// Creates a numbered source.
  const new({required this.number, required this.source});

  /// Position in `sources`, from 1.
  final int number;

  /// The source.
  final Source source;
}

/// A run of prose, or the citation that stands for adjacent claim markers.
sealed class Segment {
  /// Creates a segment.
  const new();
}

/// Prose without markers.
final class TextSegment extends Segment {
  /// Creates a text segment.
  const new(this.text);

  /// The prose.
  final String text;
}

/// The sources behind a run of `[c1][c2]` markers, each once, in number
/// order.
final class CiteSegment extends Segment {
  /// Creates a citation.
  const new(this.sources);

  /// The cited sources.
  final List<NumberedSource> sources;
}

final RegExp _markerRun = RegExp(r'\s*((?:\[c[1-9][0-9]*\])+)');
final RegExp _marker = RegExp(r'\[(c[1-9][0-9]*)\]');

/// The claim ids cited in [text], in order of first appearance.
List<String> citedClaims(String text) {
  final ids = <String>{};
  for (final match in _marker.allMatches(text)) {
    ids.add(match.group(1)!);
  }
  return ids.toList();
}

/// The sources behind [claimIds], each once, in number order.
List<NumberedSource> sourcesForClaims(
  PassageNotes passage,
  Iterable<String> claimIds,
) {
  final ids = {for (final id in claimIds) ...?passage.claim(id)?.sourceIds};
  return [
    for (final (index, source) in passage.sources.indexed)
      if (ids.contains(source.id))
        NumberedSource(number: index + 1, source: source),
  ];
}

/// Splits marked-up prose (`"… day. [c1] The … [c3][c4]"`) into text and
/// citations. The space before a run of markers is dropped, so the citation
/// sits against the word.
List<Segment> segments(PassageNotes passage, String text) {
  final out = <Segment>[];
  var last = 0;
  for (final match in _markerRun.allMatches(text)) {
    if (match.start > last) {
      out.add(TextSegment(text.substring(last, match.start)));
    }
    final claims = citedClaims(match.group(1)!);
    out.add(CiteSegment(sourcesForClaims(passage, claims)));
    last = match.end;
  }
  if (last < text.length) out.add(TextSegment(text.substring(last)));
  return out;
}

/// The sources the context paragraphs cite.
List<NumberedSource> contextSources(PassageNotes passage) {
  final claims = passage.context.paragraphs.expand(citedClaims);
  return sourcesForClaims(passage, claims);
}

/// The sources [note] cites.
List<NumberedSource> noteSources(PassageNotes passage, TranslationNote note) {
  return sourcesForClaims(passage, citedClaims(note.body));
}

/// What follows "Verse" on a note card: `15` when the note is in the
/// passage's first chapter, else the full `21:3`.
String verseLabel(PassageNotes passage, TranslationNote note) {
  final keyParts = passage.key.split('.');
  final chapter = keyParts.length > 1 ? keyParts[1] : '';
  final verse = note.verse.split(':');
  if (verse.length == 2 && verse.first == chapter) return verse.last;
  return note.verse;
}

/// Whether the notes may carry the Verified badge: only approved notes.
bool isApproved(PassageNotes passage) => passage.review.status == 'approved';

/// The site path of a reading, relative to its base: `2026-09-20/gospel/`.
String readingPagePath(String date, String slot) => '$date/$slot/';

/// The issue-form link for a note: the passage key, the note id and the page,
/// nothing personal.
Uri reportIssueUrl({
  required String passage,
  required String note,
  required String page,
}) {
  return contentIssueRepo.replace(
    path: '${contentIssueRepo.path}/issues/new',
    queryParameters: {
      'template': contentIssueTemplate,
      'title': 'Content issue: $passage ($note)',
      'passage': passage,
      'note': note,
      'page': page,
    },
  );
}

/// The host a link-out opens, without `www.`, for its label.
String linkoutSource(Uri linkout) {
  final host = linkout.host;
  if (host.startsWith('www.')) return host.substring(4);
  return host.isEmpty ? linkout.toString() : host;
}
