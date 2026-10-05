import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/reading/reading_scope.dart';
import 'package:lectio/features/reading/reading_strings.dart';
import 'package:lectio/features/reading/reading_view.dart';

/// U+200E LEFT-TO-RIGHT MARK.
const String leftToRightMark = '\u200E';

/// [time] as the review date readers see, for example `3 September 2026`.
String formatReviewDate(DateTime time, [String language = 'en']) {
  final locale = language == 'sw' ? 'sw' : 'en_US';
  return DateFormat('d MMMM y', locale).format(time.toUtc());
}

/// Words in an original language, laid out in their own direction: right to
/// left for Hebrew and Aramaic.
class OriginalWords extends StatelessWidget {
  /// Creates the words [text] in the language [lang].
  const new({required this.text, this.lang, this.style, super.key});

  /// The words in the original script.
  final String text;

  /// The language tag, for example `grc` or `hbo`, or `null` when unknown:
  /// the words then keep the surrounding direction and no locale.
  final String? lang;

  /// The text style.
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final lang = this.lang;
    if (lang == null) return Text(text, style: style);
    return Directionality(
      textDirection: textDirectionFor(lang),
      child: Text(text, locale: localeFor(lang), style: style),
    );
  }
}

/// Prose whose claim markers are shown as source numbers, `[1, 2]`.
class MarkedText extends StatelessWidget {
  /// Creates the prose made of [segments].
  const new({required this.segments, this.style, super.key});

  /// Text runs and citations, from `segments()`.
  final List<Segment> segments;

  /// The style of the prose.
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final citeStyle = TextStyle(
      color: theme.colorScheme.primary,
      fontWeight: FontWeight.w600,
      fontSize: (style?.fontSize ?? 14) * 0.75,
    );
    return Text.rich(
      TextSpan(
        style: style,
        children: [for (final segment in segments) _span(segment, citeStyle)],
      ),
    );
  }

  static InlineSpan _span(Segment segment, TextStyle citeStyle) {
    switch (segment) {
      case TextSegment(:final text):
        return TextSpan(text: text);
      case CiteSegment(:final sources):
        return TextSpan(text: _citeLabel(sources), style: citeStyle);
    }
  }

  /// The citation after a marker run. It starts with a left-to-right mark
  /// (U+200E), so a Hebrew word just before it cannot pull the brackets and
  /// numbers into its right-to-left run.
  static String _citeLabel(List<NumberedSource> sources) {
    if (sources.isEmpty) return '';
    return '$leftToRightMark [${sources.map((s) => s.number).join(', ')}]';
  }
}

/// The numbered sources behind a note, with their excerpts and links.
class SourceList extends StatelessWidget {
  /// Creates the list of [sources].
  const new({required this.sources, super.key});

  /// The sources, in number order.
  final List<NumberedSource> sources;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    return Semantics(
      label: strings.sources,
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [for (final item in sources) _SourceEntry(item: item)],
      ),
    );
  }
}

class _SourceEntry extends StatelessWidget {
  const new({required this.item});

  final NumberedSource item;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final theme = Theme.of(context);
    final source = item.source;
    final url = source.url;
    final archived = source.archivedUrl;
    final excerpt = source.excerpt;
    Widget citation = Text(source.citation);
    if (url != null) {
      citation = InkWell(
        onTap: () => unawaited(openLink(context, url)),
        child: Text(
          source.citation,
          style: TextStyle(
            color: theme.colorScheme.primary,
            decoration: TextDecoration.underline,
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 28,
            child: Text(
              '${item.number}.',
              style: TextStyle(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                citation,
                if (excerpt != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: OriginalWords(
                      text: excerpt,
                      lang: source.excerptLang,
                      style: theme.textTheme.bodyLarge,
                    ),
                  ),
                if (archived != null)
                  TextButton(
                    onPressed: () => unawaited(openLink(context, archived)),
                    child: Text(strings.archived),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The trust footer every note carries: the Verified badge (which opens the
/// sources), how and when the notes were reviewed, and a report link.
///
/// The badge shows only for approved notes with sources; otherwise the footer
/// says "Not yet verified".
class VerificationFooter extends StatelessWidget {
  /// Creates the footer of a note of [passage] citing [sources].
  const new({
    required this.passage,
    required this.sources,
    required this.reportUrl,
    super.key,
  });

  /// The passage the note belongs to (its review block).
  final PassageNotes passage;

  /// The sources the note cites.
  final List<NumberedSource> sources;

  /// The report-an-issue link.
  final Uri reportUrl;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final review = passage.review;
    final reviewedAt = review.lastReviewedAt;
    final verified = isApproved(passage) && sources.isNotEmpty;
    final Widget badge;
    if (verified) {
      badge = ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 8),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        leading: Icon(Icons.verified, color: theme.colorScheme.primary),
        title: Text(
          strings.verified(sources.length),
          style: TextStyle(
            color: theme.colorScheme.primary,
            fontWeight: FontWeight.w600,
          ),
        ),
        children: [
          SourceList(sources: sources),
          const SizedBox(height: 8),
          Text(
            [
              strings.method(review.method),
              if (reviewedAt != null)
                strings.lastReviewed(
                  formatReviewDate(reviewedAt, strings.languageCode),
                ),
            ].join(' '),
            style: muted,
          ),
        ],
      );
    } else {
      badge = Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(strings.unverified, style: muted),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Divider(height: 24),
        badge,
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            onPressed: () => unawaited(openLink(context, reportUrl)),
            icon: const Icon(Icons.flag_outlined),
            label: Text(strings.report),
          ),
        ),
      ],
    );
  }
}

/// One translation note: "VERSE 15 · “envious”", the original words,
/// transliteration and gloss, the summary, the body and the footer.
class NoteCard extends StatelessWidget {
  /// Creates the card of [note] in [passage], shown on [page].
  const new({
    required this.passage,
    required this.note,
    required this.page,
    super.key,
  });

  /// The passage the note belongs to.
  final PassageNotes passage;

  /// The note.
  final TranslationNote note;

  /// The site path of the reading, which reports carry.
  final String page;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final theme = Theme.of(context);
    final text = theme.textTheme;
    final muted = theme.colorScheme.onSurfaceVariant;
    final original = note.original;
    final verse = strings.verse(verseLabel(passage, note)).toUpperCase();
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: verse,
                    style: TextStyle(
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1,
                    ),
                  ),
                  const TextSpan(text: ' · '),
                  TextSpan(
                    text: '“${note.anchor}”',
                    style: const TextStyle(fontStyle: FontStyle.italic),
                  ),
                ],
              ),
              style: text.labelLarge,
            ),
            const SizedBox(height: 8),
            Semantics(
              label: strings.originalLabel,
              child: OriginalWords(
                text: original.text,
                lang: original.lang,
                style: text.headlineSmall,
              ),
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 12,
              children: [
                Text(
                  original.translit,
                  semanticsLabel:
                      '${strings.translitLabel}: ${original.translit}',
                  style: TextStyle(fontStyle: FontStyle.italic, color: muted),
                ),
                Text(
                  '“${original.gloss}”',
                  semanticsLabel: '${strings.glossLabel}: ${original.gloss}',
                  style: TextStyle(color: muted),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              note.summary,
              style: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            MarkedText(
              segments: segments(passage, note.body),
              style: text.bodyMedium,
            ),
            VerificationFooter(
              passage: passage,
              sources: noteSources(passage, note),
              reportUrl: reportIssueUrl(
                passage: passage.key,
                note: note.id,
                page: page,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The study-aid disclaimer under the notes.
class ReadingDisclaimer extends StatelessWidget {
  /// Creates the disclaimer.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Text(
        strings.disclaimer,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// The Context tab: the passage summary and its historical-context note.
class ContextPanel extends StatelessWidget {
  /// Creates the Context tab of [passage], shown on [page].
  const new({required this.passage, required this.page, super.key});

  /// The approved notes.
  final PassageNotes passage;

  /// The site path of the reading, which reports carry.
  final String page;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final note = passage.context;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          passage.summary,
          style: text.titleMedium?.copyWith(fontStyle: FontStyle.italic),
        ),
        const SizedBox(height: 16),
        Text(note.title, style: text.headlineSmall),
        for (final paragraph in note.paragraphs)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: MarkedText(
              segments: segments(passage, paragraph),
              style: text.bodyLarge,
            ),
          ),
        VerificationFooter(
          passage: passage,
          sources: contextSources(passage),
          reportUrl: reportIssueUrl(
            passage: passage.key,
            note: contextNoteId,
            page: page,
          ),
        ),
        const ReadingDisclaimer(),
      ],
    );
  }
}

/// The Original tab: one card per translation note.
class OriginalPanel extends StatelessWidget {
  /// Creates the Original tab of [passage], shown on [page].
  const new({required this.passage, required this.page, super.key});

  /// The approved notes.
  final PassageNotes passage;

  /// The site path of the reading, which reports carry.
  final String page;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final notes = passage.translationNotes;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (notes.isEmpty)
          Text(strings.noNotes)
        else
          for (final note in notes)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: NoteCard(passage: passage, note: note, page: page),
            ),
        const ReadingDisclaimer(),
      ],
    );
  }
}
