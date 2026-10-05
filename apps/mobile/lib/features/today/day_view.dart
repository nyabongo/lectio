import 'package:flutter/material.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/l10n/in_language.dart';

/// The top of the Today screen: the Today eyebrow (or a way back to today),
/// the date, which opens the date picker, and, when the day is known, the
/// principal celebration with its rank and colour, the season and week, the
/// lectionary cycles and any other celebrations.
class DayHeader extends StatelessWidget {
  /// Creates the header for the ISO [date].
  const new({
    required this.date,
    required this.onPickDate,
    this.day,
    this.onToday,
    super.key,
  });

  /// The ISO date shown.
  final String date;

  /// Opens the date picker.
  final VoidCallback onPickDate;

  /// The day document, or `null` while it is missing.
  final ApiDay? day;

  /// Goes back to the device's date; `null` when [date] is today.
  final VoidCallback? onToday;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    final strings = TodayStrings.of(context);
    final language = strings.languageCode;
    final day = this.day;
    final onToday = this.onToday;
    final celebrations = day?.celebrations ?? const <Celebration>[];
    final principal = celebrations.firstOrNull?.nameIn(language);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (onToday == null)
          Text(
            strings.todayHeading.toUpperCase(),
            style: theme.textTheme.labelLarge?.copyWith(
              color: scheme.primary,
              letterSpacing: 1.2,
            ),
          )
        else
          TextButton.icon(
            onPressed: onToday,
            icon: const Icon(Icons.today_outlined),
            label: Text(strings.backToToday),
          ),
        Tooltip(
          message: strings.chooseDate,
          child: TextButton.icon(
            onPressed: onPickDate,
            icon: const Icon(Icons.calendar_month_outlined),
            label: Text(strings.formatDayDate(date)),
          ),
        ),
        if (principal != null)
          Semantics(
            header: true,
            child: InLanguage(
              language: principal.language,
              child: Text(
                principal.text,
                style: theme.textTheme.headlineMedium,
              ),
            ),
          ),
        if (day != null) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 16,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (celebrations.firstOrNull case final first?)
                _Rank(celebration: first),
              Text(
                strings.seasonLabel(day.season, day.seasonWeek),
                style: muted,
              ),
              Text(
                strings.cyclesLabel(day.sundayCycle, day.weekdayCycle),
                style: muted,
              ),
            ],
          ),
          for (final other in celebrations.skip(1))
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${other.nameIn(language).text} · '
                '${strings.rankAndColourLabel(other.rank, other.colour)}',
                style: muted,
              ),
            ),
        ],
      ],
    );
  }
}

/// The rank and colour name of the principal celebration, after a swatch of
/// the colour. The name is visible text, so the colour is never told by the
/// swatch alone; the swatch is hidden from screen readers.
class _Rank extends StatelessWidget {
  const new({required this.celebration});

  final Celebration celebration;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ExcludeSemantics(
          child: Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: scheme.primary,
              border: Border.all(color: scheme.outline),
            ),
          ),
        ),
        const SizedBox(width: 6),
        // Wraps instead of overflowing at 200% text on a narrow phone.
        Flexible(
          child: Text(
            TodayStrings.of(
              context,
            ).rankAndColourLabel(celebration.rank, celebration.colour),
            style: theme.textTheme.labelLarge?.copyWith(color: scheme.primary),
          ),
        ),
      ],
    );
  }
}

/// The body of a known day: an offline notice when the refresh failed, the
/// Listen button when any reading has notes, the missing-notes or
/// missing-readings message, and the readings of each Mass.
class DayDetails extends StatelessWidget {
  /// Creates the details of [snapshot]'s day.
  const new({
    required this.snapshot,
    required this.onListen,
    required this.onNotes,
    required this.onText,
    super.key,
  });

  /// The day as the repository last knew it.
  final DataSnapshot<ApiDay> snapshot;

  /// Opens the Listen tab for the day.
  final VoidCallback onListen;

  /// Opens the notes of a reading of a Mass.
  final void Function(Mass<DayReading> mass, DayReading reading) onNotes;

  /// Opens the licensed text of a reading.
  final ValueChanged<DayReading> onText;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final strings = TodayStrings.of(context);
    final day = snapshot.value;
    final refreshError = snapshot.refreshError;
    final masses = day.masses;
    final hasNotes = day.readings.any((reading) => reading.passage != null);
    final showMassLabels = masses.length > 1;
    final String? message;
    if (day.lectionaryMissing || masses.isEmpty) {
      message = strings.lectionaryMissing;
    } else if (!hasNotes) {
      message = strings.notesMissing;
    } else {
      message = null;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (refreshError is ApiNetworkException)
          TodayNotice(icon: Icons.cloud_off_outlined, text: strings.offline)
        else if (refreshError != null)
          TodayNotice(
            icon: Icons.sync_problem_outlined,
            text: strings.refreshFailed,
          ),
        if (hasNotes)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton.icon(
                onPressed: onListen,
                icon: const Icon(Icons.play_arrow),
                label: Text(strings.listen),
              ),
            ),
          ),
        if (message != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(message, style: muted),
          ),
        if (showMassLabels)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(strings.massOptionsLabel(masses.length), style: muted),
          ),
        for (final mass in masses) ...[
          if (showMassLabels)
            Padding(
              padding: const EdgeInsets.only(top: 8, bottom: 8),
              child: Text(mass.label, style: theme.textTheme.titleLarge),
            ),
          for (final reading in mass.readings)
            ReadingCard(
              reading: reading,
              onNotes: () => onNotes(mass, reading),
              onText: () => onText(reading),
            ),
        ],
      ],
    );
  }
}

/// One reading: its slot, its reference, the notes' summary or "Notes in
/// preparation", a Notes button when there are notes, and the "Text ↗"
/// link-out to the licensed text, which Lectio never stores.
class ReadingCard extends StatelessWidget {
  /// Creates the card for [reading].
  const new({
    required this.reading,
    required this.onNotes,
    required this.onText,
    super.key,
  });

  /// The reading shown.
  final DayReading reading;

  /// Opens the reading's notes.
  final VoidCallback onNotes;

  /// Opens the reading's licensed text.
  final VoidCallback onText;

  @override
  Widget build(BuildContext context) {
    final strings = TodayStrings.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final passage = reading.passage;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: passage == null ? scheme.outlineVariant : scheme.primary,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              strings.slotLabel(reading.slot).toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(reading.ref, style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            if (passage == null)
              Text(
                strings.notesInPreparation,
                style: muted?.copyWith(fontStyle: FontStyle.italic),
              )
            else
              InLanguage(
                language: passage.locale,
                child: Text(passage.summary, style: theme.textTheme.bodyMedium),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (passage != null)
                  FilledButton.tonalIcon(
                    onPressed: onNotes,
                    icon: const Icon(Icons.menu_book_outlined),
                    label: Text(
                      strings.notes,
                      semanticsLabel: strings.notesSemantics(reading.ref),
                    ),
                  ),
                // The label replaces the button's text for screen readers;
                // the button keeps its tap action.
                TextButton(
                  onPressed: onText,
                  child: Text(
                    strings.text,
                    semanticsLabel: strings.linkoutSemantics(
                      reading.ref,
                      reading.linkout,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A short notice with an icon, for example that the day shown is a saved
/// copy.
class TodayNotice extends StatelessWidget {
  /// Creates a notice saying [text].
  const new({required this.icon, required this.text, super.key});

  /// The leading icon.
  final IconData icon;

  /// What the notice says.
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(icon, color: scheme.onSurfaceVariant),
            const SizedBox(width: 12),
            Expanded(child: Text(text)),
          ],
        ),
      ),
    );
  }
}
