import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/api_paths.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/reading/note_cards.dart';
import 'package:lectio/features/reading/reading_scope.dart';
import 'package:lectio/features/reading/reading_strings.dart';
import 'package:lectio/features/reading/reading_view.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/l10n/in_language.dart';
import 'package:lectio/l10n/lectio_localizations.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/theme/lectio_theme.dart';

final RegExp _isoDate = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// The tab panels of the Reading screen (Text is a link-out, not a panel).
enum ReadingTab {
  /// The historical-context note.
  context,

  /// The translation notes.
  original;

  /// The tab named [name] (as in `?tab=original`), else Context.
  static ReadingTab parse(String? name) {
    for (final tab in values) {
      if (tab.name == name) return tab;
    }
    return ReadingTab.context;
  }
}

/// The location of the Reading tab for the reading in [slot] of the Mass
/// [mass] (or the principal one when `null`) on the ISO [date], for example
/// `/reading?date=2026-04-04&mass=vigil&slot=gospel&tab=original`.
///
/// The same shape and parameter order as the Today screen's links (L-102).
String readingLocation(
  String date,
  String? mass,
  String slot, {
  ReadingTab tab = ReadingTab.context,
}) {
  return Uri(
    path: AppRoute.reading.path,
    queryParameters: {
      'date': date,
      'mass': ?mass,
      'slot': slot,
      if (tab != ReadingTab.context) 'tab': tab.name,
    },
  ).toString();
}

/// The Reading tab: the approved notes of one reading in Context and
/// Original tabs, with a Text link-out to the licensed reading text.
///
/// Without a [date] it shows today's readings; without a [slot], the Gospel
/// (else the first reading with notes). Data comes from the nearest
/// [ReadingScope], else [defaultReadingRepository], in the UI language's
/// API locale (the `sw/` mirror in Kiswahili, L-113).
class ReadingScreen extends StatefulWidget {
  /// Creates the Reading screen.
  const new({
    super.key,
    this.date,
    this.mass,
    this.slot,
    this.initialTab = ReadingTab.context,
  });

  /// The ISO date of the day, or `null` for today.
  final String? date;

  /// The id of the Mass whose reading to prefer, or `null` for the
  /// principal one.
  final String? mass;

  /// The reading slot, for example `gospel`, or `null` for the default.
  final String? slot;

  /// The tab shown first.
  final ReadingTab initialTab;

  @override
  State<ReadingScreen> createState() => _ReadingScreenState();
}

class _ReadingScreenState extends State<ReadingScreen> {
  LectioRepository? _repository;
  Stream<DataSnapshot<ApiDay>>? _day;
  String? _slot;

  @override
  void initState() {
    super.initState();
    _slot = widget.slot;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final language = LectioLocalizations.of(context).languageCode;
    final repository = ReadingScope.repositoryOf(context)
        .forLocale(apiLocaleFor(language));
    if (!identical(repository, _repository)) {
      _repository = repository;
      _day = _watch();
    }
  }

  @override
  void didUpdateWidget(ReadingScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.date != oldWidget.date ||
        widget.mass != oldWidget.mass ||
        widget.slot != oldWidget.slot) {
      _slot = widget.slot;
      _day = _watch();
    }
  }

  Stream<DataSnapshot<ApiDay>> _watch({bool refresh = false}) {
    final repository = _repository!;
    final date = widget.date;
    if (date == null) return repository.watchToday(refresh: refresh);
    // A deep link may carry anything: fail like a missing day.
    if (!_isoDate.hasMatch(date)) {
      return Stream.error(FormatException('Not an ISO date', date));
    }
    return repository.watchDay(date, refresh: refresh);
  }

  void _retry() => setState(() => _day = _watch(refresh: true));

  void _select(String slot) => setState(() => _slot = slot);

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DataSnapshot<ApiDay>>(
      stream: _day,
      builder: (context, snapshot) {
        final data = snapshot.data;
        if (data != null) {
          return ReadingDayView(
            day: data.value,
            mass: widget.mass,
            slot: _slot,
            initialTab: widget.initialTab,
            offline: data.refreshError != null,
            onSlotSelected: _select,
          );
        }
        if (snapshot.hasError ||
            snapshot.connectionState == ConnectionState.done) {
          return _LoadFailed(onRetry: _retry);
        }
        return Center(child: Text(ReadingStrings.of(context).loading));
      },
    );
  }
}

class _LoadFailed extends StatelessWidget {
  const new({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(strings.loadFailed, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: Text(strings.retry)),
          ],
        ),
      ),
    );
  }
}

/// One day on the Reading screen: the celebration, a chooser of the day's
/// readings and the notes of the chosen one, tinted by the day's colour.
class ReadingDayView extends StatelessWidget {
  /// Creates the view of the reading in [slot] (or the default one) of [day].
  const new({
    required this.day,
    required this.onSlotSelected,
    this.mass,
    this.slot,
    this.initialTab = ReadingTab.context,
    this.offline = false,
    super.key,
  });

  /// The day document.
  final ApiDay day;

  /// The id of the Mass whose readings are preferred, or `null`.
  ///
  /// Kept when the reader picks another slot: that Mass's reading in the slot
  /// wins when it has one.
  final String? mass;

  /// The chosen slot, or `null` for the default reading.
  final String? slot;

  /// The tab shown first.
  final ReadingTab initialTab;

  /// Whether the notes are saved ones that could not be refreshed.
  final bool offline;

  /// Called with the slot the reader picks.
  final ValueChanged<String> onSlotSelected;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final base = Theme.of(context);
    final theme = buildLectioTheme(day.liturgicalColour, base.brightness);
    final bySlot = readingsBySlot(day);
    final reading = pickReading(day, slot, mass: mass);
    final celebration = day.celebrations.firstOrNull?.nameIn(
      strings.languageCode,
    );
    final date = formatLongDate(day.date, strings.languageCode);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final Widget body;
    if (bySlot.isEmpty) {
      body = _Message(strings.noReadings);
    } else if (reading == null) {
      body = _Message(strings.noSuchReading(slot!));
    } else {
      body = ReadingNotesView(
        key: ValueKey('${day.date}/$mass/${reading.slot}'),
        date: day.date,
        reading: reading,
        initialTab: initialTab,
      );
    }
    return Theme(
      data: theme,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (offline) Text(strings.offline, style: muted),
                InLanguage(
                  language: celebration?.language ?? strings.languageCode,
                  child: Text(
                    [?celebration?.text, date].join(' · '),
                    style: theme.textTheme.labelLarge,
                  ),
                ),
                if (bySlot.length > 1)
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      children: [
                        for (final item in bySlot.keys)
                          Padding(
                            padding: const EdgeInsetsDirectional.only(end: 8),
                            child: ChoiceChip(
                              label: Text(strings.slotLabel(item)),
                              selected: item == reading?.slot,
                              onSelected: (_) => onSlotSelected(item),
                            ),
                          ),
                      ],
                    ),
                  ),
                if (reading != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Semantics(
                      header: true,
                      child: Text(
                        reading.ref,
                        style: theme.textTheme.headlineSmall,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const new(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}

/// The Text link-out: opens the licensed reading text, which Lectio never
/// stores.
class TextLinkButton extends StatelessWidget {
  /// Creates the link-out of [reading].
  const new({required this.reading, super.key});

  /// The reading whose text it opens.
  final DayReading reading;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final label = strings.textLabel(
      reading.ref,
      linkoutSource(reading.linkout),
    );
    return Tooltip(
      message: label,
      child: TextButton.icon(
        onPressed: () => unawaited(openLink(context, reading.linkout)),
        icon: const Icon(Icons.open_in_new, size: 18),
        label: Text(strings.textTab),
      ),
    );
  }
}

/// The notes of one reading: Context and Original tabs and the Text
/// link-out, or the in-preparation message when no approved notes exist.
class ReadingNotesView extends StatelessWidget {
  /// Creates the notes of [reading] on the ISO [date].
  const new({
    required this.date,
    required this.reading,
    this.initialTab = ReadingTab.context,
    super.key,
  });

  /// The ISO date of the day.
  final String date;

  /// The reading.
  final DayReading reading;

  /// The tab shown first.
  final ReadingTab initialTab;

  @override
  Widget build(BuildContext context) {
    final strings = ReadingStrings.of(context);
    final passage = reading.passage;
    final page = readingPagePath(date, reading.slot);
    if (passage == null || !isApproved(passage)) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextLinkButton(reading: reading),
          ),
          Text(strings.pending),
        ],
      );
    }
    return DefaultTabController(
      length: ReadingTab.values.length,
      initialIndex: initialTab.index,
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TabBar(
                  tabs: [
                    Tab(text: strings.contextTab),
                    Tab(text: strings.originalTab),
                  ],
                ),
              ),
              TextLinkButton(reading: reading),
            ],
          ),
          if (passage.locale != strings.languageCode)
            EnglishOnlyNotice(strings: strings),
          Expanded(
            child: InLanguage(
              language: passage.locale,
              child: TabBarView(
                children: [
                  ContextPanel(passage: passage, page: page),
                  OriginalPanel(passage: passage, page: page),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Says that the notes below are in English because they have no reviewed
/// translation into the UI language yet, as the site's "English only"
/// badge does.
class EnglishOnlyNotice extends StatelessWidget {
  /// Creates the notice in the language of [strings].
  const new({required this.strings, super.key});

  /// The UI strings.
  final ReadingStrings strings;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Chip(label: Text(strings.englishOnly)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              strings.englishOnlyText,
              style: theme.textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

/// The Reading route inside the tab shell: `/reading` shows today's Gospel;
/// `?date=2026-09-20&mass=day&slot=gospel` picks the day and reading, and
/// `&tab=original` opens the Original tab (see [readingLocation]).
GoRoute readingRoute() {
  return GoRoute(
    path: AppRoute.reading.path,
    name: AppRoute.reading.name,
    builder: (context, state) {
      final query = state.uri.queryParameters;
      return ReadingScreen(
        date: query['date'],
        mass: query['mass'],
        slot: query['slot'],
        initialTab: ReadingTab.parse(query['tab']),
      );
    },
  );
}
