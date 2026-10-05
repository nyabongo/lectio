import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/bookmarks/bookmarks_screen.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/screens/standalone_scaffold.dart';

/// Asks the reader for a time of day, starting at the given one; `null` when
/// they cancel.
typedef TimePicker = Future<TimeOfDay?> Function(
  BuildContext context,
  TimeOfDay initial,
);

/// The Material time picker.
Future<TimeOfDay?> materialTimePicker(BuildContext context, TimeOfDay initial) {
  return showTimePicker(context: context, initialTime: initial);
}

/// Settings, opened full screen from the header: text size, theme, playback
/// speed, language and the daily reminder, plus a link to bookmarks and
/// notes. Every change applies at once and is saved on the device.
class SettingsScreen extends StatelessWidget {
  /// Creates the Settings screen; [pickTime] asks for the reminder time
  /// (default: [materialTimePicker]).
  const new({super.key, this.pickTime = materialTimePicker});

  /// Asks for the reminder time.
  final TimePicker pickTime;

  @override
  Widget build(BuildContext context) {
    final controller = SettingsScope.of(context);
    final settings = controller.settings;
    final theme = Theme.of(context);

    Future<void> update(AppSettings next) async {
      final saved = await controller.update(next);
      if (context.mounted) reportUnsaved(context, saved: saved);
    }

    Widget heading(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(text, style: theme.textTheme.titleMedium),
    );

    Widget hint(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Text(text, style: theme.textTheme.bodySmall),
    );

    Widget padded(Widget child) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: child,
    );

    return StandaloneScaffold(
      title: AppRoute.settings.title,
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Text(
              'There are no accounts. Your preferences are saved on this '
              'device and never leave it.',
            ),
          ),
          heading('Text size'),
          padded(
            SegmentedButton<TextSize>(
              showSelectedIcon: false,
              segments: [
                for (final size in TextSize.values)
                  ButtonSegment(value: size, label: Text(size.label)),
              ],
              selected: {settings.textSize},
              onSelectionChanged: (selection) => unawaited(
                update(settings.copyWith(textSize: selection.single)),
              ),
            ),
          ),
          hint(
            'Notes on history and the original languages will read at this '
            'size.',
          ),
          heading('Theme'),
          padded(
            SegmentedButton<ThemePreference>(
              showSelectedIcon: false,
              segments: [
                for (final preference in ThemePreference.values)
                  ButtonSegment(
                    value: preference,
                    label: Text(preference.label),
                  ),
              ],
              selected: {settings.theme},
              onSelectionChanged: (selection) =>
                  unawaited(update(settings.copyWith(theme: selection.single))),
            ),
          ),
          hint("System follows your device's light or dark setting."),
          heading('Default playback speed'),
          padded(
            Wrap(
              spacing: 8,
              children: [
                for (final speed in playbackSpeeds)
                  ChoiceChip(
                    label: Text(speedLabel(speed)),
                    selected: settings.playbackSpeed == speed,
                    onSelected: (_) => unawaited(
                      update(settings.copyWith(playbackSpeed: speed)),
                    ),
                  ),
              ],
            ),
          ),
          hint(
            'Where the Listen queue starts. You can still change it while '
            'listening.',
          ),
          heading('Language'),
          padded(
            SegmentedButton<AppLanguage>(
              showSelectedIcon: false,
              segments: [
                for (final language in AppLanguage.values)
                  ButtonSegment(
                    value: language,
                    enabled: language.available,
                    label: Text(
                      language.available
                          ? language.label
                          : '${language.label} (coming soon)',
                    ),
                  ),
              ],
              selected: {settings.language},
              onSelectionChanged: (selection) => unawaited(
                update(settings.copyWith(language: selection.single)),
              ),
            ),
          ),
          heading('Daily reminder'),
          SwitchListTile(
            title: const Text('Remind me each day'),
            subtitle: const Text(
              "A notification with the day's celebration. Nothing is sent to "
              'a server.',
            ),
            value: settings.dailyReminder,
            onChanged: (on) =>
                unawaited(update(settings.copyWith(dailyReminder: on))),
          ),
          ListTile(
            title: const Text('Reminder time'),
            trailing: Text(settings.reminderTime.format(context)),
            enabled: settings.dailyReminder,
            onTap: () async {
              final time = await pickTime(context, settings.reminderTime);
              if (time == null) return;
              await update(settings.copyWith(reminderTime: time));
            },
          ),
          heading('Saved on this device'),
          ListTile(
            leading: const Icon(Icons.bookmarks_outlined),
            title: const Text(bookmarksTitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                unawaited(context.push('${AppRoute.settings.path}/bookmarks')),
          ),
        ],
      ),
    );
  }
}

/// The Settings route, outside the tab shell, with Bookmarks below it
/// (`/settings/bookmarks`).
GoRoute settingsRoute() {
  return GoRoute(
    path: AppRoute.settings.path,
    name: AppRoute.settings.name,
    builder: (context, state) => const SettingsScreen(),
    routes: [bookmarksRoute()],
  );
}
