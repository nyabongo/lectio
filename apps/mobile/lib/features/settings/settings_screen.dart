import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/bookmarks/bookmarks_screen.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/l10n/lectio_localizations.dart';
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
    final l10n = LectioLocalizations.of(context);
    String t(String key) => l10n.text(key);

    Future<void> update(AppSettings next) async {
      final saved = await controller.update(next);
      if (context.mounted) reportUnsaved(context, saved: saved);
    }

    Widget heading(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Semantics(
        header: true,
        child: Text(text, style: theme.textTheme.titleMedium),
      ),
    );

    Widget hint(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Text(text, style: theme.textTheme.bodySmall),
    );

    // One option of a choice, as a list tile: the text wraps instead of
    // overflowing at large text sizes on a narrow phone.
    Widget choice({
      required String label,
      required bool selected,
      required VoidCallback onTap,
    }) => ListTile(
      title: Text(label),
      selected: selected,
      trailing: selected ? const Icon(Icons.check) : null,
      onTap: onTap,
    );

    Widget padded(Widget child) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: child,
    );

    return StandaloneScaffold(
      title: AppRoute.settings.titleIn(l10n),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Text(t('app_settings_intro')),
          ),
          heading(t('settings_textSize_legend')),
          for (final size in TextSize.values)
            choice(
              label: t(size.labelKey),
              selected: settings.textSize == size,
              onTap: () => unawaited(update(settings.copyWith(textSize: size))),
            ),
          hint(t('settings_textSize_preview')),
          heading(t('settings_theme_legend')),
          for (final preference in ThemePreference.values)
            choice(
              label: t(preference.labelKey),
              selected: settings.theme == preference,
              onTap: () =>
                  unawaited(update(settings.copyWith(theme: preference))),
            ),
          hint(t('settings_theme_hint')),
          heading(t('settings_speed_legend')),
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
          hint(t('settings_speed_hint')),
          heading(t('settings_language_legend')),
          for (final language in AppLanguage.values)
            choice(
              label: t('settings_language_${language.name}'),
              selected: settings.language == language,
              onTap: () =>
                  unawaited(update(settings.copyWith(language: language))),
            ),
          heading(t('app_settings_reminderHeading')),
          SwitchListTile(
            title: Text(t('app_settings_reminderSwitch')),
            subtitle: Text(t('app_settings_reminderHint')),
            value: settings.dailyReminder,
            onChanged: (on) =>
                unawaited(update(settings.copyWith(dailyReminder: on))),
          ),
          ListTile(
            title: Text(t('app_settings_reminderTime')),
            trailing: Text(settings.reminderTime.format(context)),
            enabled: settings.dailyReminder,
            onTap: () async {
              final time = await pickTime(context, settings.reminderTime);
              if (time == null) return;
              await update(settings.copyWith(reminderTime: time));
            },
          ),
          heading(t('app_settings_savedHeading')),
          ListTile(
            leading: const Icon(Icons.bookmarks_outlined),
            title: Text(t('app_settings_bookmarks')),
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
