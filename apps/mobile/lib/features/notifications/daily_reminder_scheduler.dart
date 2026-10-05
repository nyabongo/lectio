import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lectio/data/dates.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/notifications/celebration_source.dart';
import 'package:lectio/features/notifications/local_notifications_platform.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/settings_controller.dart';

/// The id of the first reminder; the next ones follow it.
const int reminderIdBase = 1060;

/// How many days of reminders are scheduled ahead.
const int reminderDays = 7;

/// How far ahead a reminder must be to be scheduled, so a time that is about
/// to pass is not scheduled in the past.
const Duration reminderMinimumLead = Duration(minutes: 1);

/// The reminder's text (L-114 translates it).
abstract final class ReminderStrings {
  /// The title when the day's celebration is unknown.
  static const String fallbackTitle = 'Lectio';

  /// The text under the title.
  static const String body = "Today's readings and notes are ready.";
}

/// The next [count] local date-times at [time] that are more than
/// [reminderMinimumLead] after [now], one per day.
///
/// Each one is built from calendar fields in the device's time zone, so a
/// daylight-saving change keeps the reminder at the same wall-clock time.
List<DateTime> upcomingReminderTimes(
  DateTime now,
  TimeOfDay time, {
  int count = reminderDays,
}) {
  final earliest = now.add(reminderMinimumLead);
  final times = <DateTime>[];
  for (var offset = 0; times.length < count; offset++) {
    final at = DateTime(
      now.year,
      now.month,
      now.day + offset,
      time.hour,
      time.minute,
    );
    if (at.isAfter(earliest)) times.add(at);
  }
  return times;
}

/// Keeps the daily reminder scheduled for the next [reminderDays] days, as
/// the reader set it in Settings.
///
/// It follows [AppSettings.dailyReminder] and [AppSettings.reminderTime] on
/// the [SettingsController]. Turning the reminder on asks for notification
/// permission (never at start-up); when it is refused the reminder is
/// switched back off. Each reminder is titled with the day's celebration
/// from the [CelebrationSource]. Call [reschedule] after the days are
/// refreshed, so new celebration names are used.
///
/// Work runs one task at a time, in order. A platform failure never stops
/// the app: it is kept in [lastError] and the next task runs as usual.
class DailyReminderScheduler {
  /// Creates a scheduler; `clock` gives the device time (default: now).
  new({
    required this._settings,
    required this._platform,
    required this._celebrations,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final SettingsController _settings;
  final ReminderPlatform _platform;
  final CelebrationSource _celebrations;
  final DateTime Function() _clock;

  late AppSettings _seen;
  Future<void> _queue = Future.value();
  bool _started = false;

  /// Completes when the work queued so far is done.
  Future<void> get idle => _queue;

  /// The last platform failure, or `null`.
  Exception? get lastError => _lastError;
  Exception? _lastError;

  /// Prepares notifications, schedules the reminders for the current
  /// settings and starts following them. Calling it again does nothing.
  Future<void> start() {
    if (_started) return _queue;
    _started = true;
    _seen = _settings.settings;
    _settings.addListener(_onSettingsChanged);
    return _enqueue(() async {
      await _platform.initialize();
      await _apply();
    });
  }

  /// Stops following the settings. Scheduled reminders stay.
  void dispose() {
    _settings.removeListener(_onSettingsChanged);
  }

  /// Replaces the pending reminders with the next [reminderDays] days',
  /// with the celebration names known now.
  Future<void> reschedule() => _enqueue(_apply);

  void _onSettingsChanged() {
    final previous = _seen;
    final current = _settings.settings;
    _seen = current;
    if (previous.dailyReminder == current.dailyReminder &&
        previous.reminderTime == current.reminderTime) {
      return;
    }
    final turnedOn = current.dailyReminder && !previous.dailyReminder;
    unawaited(
      _enqueue(() async {
        if (turnedOn && !await _platform.requestPermission()) {
          await _switchOff();
          return;
        }
        await _apply();
      }),
    );
  }

  /// Turns the reminder back off after permission was refused, unless the
  /// reader already did; that change schedules (cancels) on its own.
  Future<void> _switchOff() async {
    final settings = _settings.settings;
    if (!settings.dailyReminder) return;
    await _settings.update(settings.copyWith(dailyReminder: false));
  }

  Future<void> _apply() async {
    final settings = _settings.settings;
    if (!settings.dailyReminder) {
      for (var index = 0; index < reminderDays; index++) {
        await _platform.cancel(reminderIdBase + index);
      }
      return;
    }
    // Every id is scheduled again, which replaces the pending reminders, so
    // there is no gap without one while the celebrations are read.
    final reminders = <ReminderNotification>[];
    final times = upcomingReminderTimes(_clock(), settings.reminderTime);
    for (final (index, at) in times.indexed) {
      final date = isoDate(at);
      final celebration = await _celebrations.celebrationOn(date);
      reminders.add(
        ReminderNotification(
          id: reminderIdBase + index,
          at: at,
          title: celebration ?? ReminderStrings.fallbackTitle,
          body: ReminderStrings.body,
          date: date,
        ),
      );
    }
    for (final reminder in reminders) {
      await _platform.schedule(reminder);
    }
  }

  Future<void> _enqueue(Future<void> Function() task) {
    return _queue = _queue.then((_) async {
      try {
        await task();
      } on Exception catch (error) {
        _lastError = error;
      }
    });
  }
}

/// Starts the daily reminder for [settings], titled from the days in
/// [repository], on the device's notifications (or [platform]).
///
/// Call it once at start-up, after the settings are loaded; it returns at
/// once and never throws.
DailyReminderScheduler startDailyReminders({
  required SettingsController settings,
  required LectioRepository repository,
  ReminderPlatform? platform,
}) {
  final scheduler = DailyReminderScheduler(
    settings: settings,
    platform: platform ?? LocalNotificationsPlatform(),
    celebrations: RepositoryCelebrations(repository),
  );
  unawaited(scheduler.start());
  return scheduler;
}
