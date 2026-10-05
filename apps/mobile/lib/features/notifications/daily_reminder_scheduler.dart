import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lectio/data/dates.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/notifications/celebration_source.dart';
import 'package:lectio/features/notifications/local_notifications_platform.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// The id of the first reminder; the next ones follow it.
const int reminderIdBase = 1060;

/// How many days of reminders are scheduled ahead.
const int reminderDays = 7;

/// How far ahead a reminder must be to be scheduled, so a time that is about
/// to pass is not scheduled in the past.
const Duration reminderMinimumLead = Duration(minutes: 1);

/// How long scheduling waits for the celebration names. They are read all
/// at once, so this caps the whole wait; a day not read by then gets the
/// fallback title.
const Duration defaultCelebrationTimeout = Duration(seconds: 5);

/// The reminder's text in the reader's language (L-114). The scheduler runs
/// outside the widget tree, so it takes the language from the settings.
class ReminderStrings {
  /// The strings of [_l10n].
  const new(this._l10n);

  /// The strings of [language].
  factory forLanguage(AppLanguage language) {
    return ReminderStrings(LectioLocalizations.forLanguage(language.name));
  }

  /// The English strings.
  static final ReminderStrings en = ReminderStrings.forLanguage(AppLanguage.en);

  final LectioLocalizations _l10n;

  /// The title when the day's celebration is unknown.
  String get fallbackTitle => _l10n.text('common_site_name');

  /// The text under the title.
  String get body => _l10n.text('app_reminder_body');

  /// Why the reminder switched itself off.
  String get permissionRefused => _l10n.text('app_reminder_permissionRefused');
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
/// When permission is refused, [permissionRefusals] emits so the app can
/// say why the switch turned off. [followAppResume] reschedules each time
/// the app comes back to the foreground, which moves the 7-day window on;
/// when notifications were turned off in the system settings meanwhile, it
/// switches the reminder off the same way.
///
/// Work runs one task at a time, in order. A failure, even an unregistered
/// plugin, never stops the app: it is reported to [FlutterError.reportError],
/// kept in [lastError], and the next task runs as usual.
class DailyReminderScheduler {
  /// Creates a scheduler; `clock` gives the device time (default: now) and
  /// [celebrationTimeout] caps the wait for the celebration names.
  new({
    required this._settings,
    required this._platform,
    required this._celebrations,
    DateTime Function()? clock,
    this.celebrationTimeout = defaultCelebrationTimeout,
  }) : _clock = clock ?? DateTime.now;

  /// How long scheduling waits for the celebration names.
  final Duration celebrationTimeout;

  final SettingsController _settings;
  final ReminderPlatform _platform;
  final CelebrationSource _celebrations;
  final DateTime Function() _clock;

  late AppSettings _seen;
  Future<void> _queue = Future.value();
  bool _started = false;
  AppLifecycleListener? _lifecycle;
  final StreamController<void> _refusals = StreamController<void>.broadcast();

  /// Emits each time a refused permission switched the reminder off.
  Stream<void> get permissionRefusals => _refusals.stream;

  /// Completes when the work queued so far is done.
  Future<void> get idle => _queue;

  /// The last failure, or `null`.
  Object? get lastError => _lastError;
  Object? _lastError;

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

  /// Reschedules each time the app resumes, after checking that
  /// notifications are still allowed. Needs the widgets binding; calling it
  /// again does nothing.
  void followAppResume() {
    _lifecycle ??= AppLifecycleListener(onResume: () => unawaited(resumed()));
  }

  /// What a resume does: when the reminder is on but notifications are no
  /// longer allowed (turned off in the system settings), switches it off
  /// as a refusal does; otherwise reschedules.
  Future<void> resumed() {
    return _enqueue(() async {
      if (_settings.settings.dailyReminder &&
          !await _platform.permissionGranted()) {
        await _switchOff();
        return;
      }
      await _apply();
    });
  }

  /// Stops following the settings and the app's lifecycle. Scheduled
  /// reminders stay.
  void dispose() {
    _settings.removeListener(_onSettingsChanged);
    _lifecycle?.dispose();
    _lifecycle = null;
    unawaited(_refusals.close());
  }

  /// Replaces the pending reminders with the next [reminderDays] days',
  /// with the celebration names known now.
  Future<void> reschedule() => _enqueue(_apply);

  void _onSettingsChanged() {
    final previous = _seen;
    final current = _settings.settings;
    _seen = current;
    if (previous.dailyReminder == current.dailyReminder &&
        previous.reminderTime == current.reminderTime &&
        previous.language == current.language) {
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

  /// Turns the reminder back off when permission is refused, unless the
  /// reader already did; that change schedules (cancels) on its own.
  Future<void> _switchOff() async {
    final settings = _settings.settings;
    if (!settings.dailyReminder) return;
    if (!_refusals.isClosed) _refusals.add(null);
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
    final times = upcomingReminderTimes(_clock(), settings.reminderTime);
    final dates = [for (final at in times) isoDate(at)];
    final language = settings.language;
    final strings = ReminderStrings.forLanguage(language);
    final names = await Future.wait([
      for (final date in dates)
        _celebrations
            .celebrationOn(date, language: language.name)
            .timeout(celebrationTimeout, onTimeout: () => null),
    ]);
    for (final (index, at) in times.indexed) {
      await _platform.schedule(
        ReminderNotification(
          id: reminderIdBase + index,
          at: at,
          title: names[index] ?? strings.fallbackTitle,
          body: strings.body,
          date: dates[index],
        ),
      );
    }
  }

  Future<void> _enqueue(Future<void> Function() task) {
    return _queue = _queue.then((_) async {
      try {
        await task();
      } on Object catch (error, stack) {
        // Even a plugin that is not registered (an Error) must never stop
        // the app or the queue, but it is reported, never swallowed.
        _lastError = error;
        FlutterError.reportError(
          FlutterErrorDetails(
            exception: error,
            stack: stack,
            library: 'lectio notifications',
            context: ErrorDescription('while scheduling the daily reminder'),
          ),
        );
      }
    });
  }
}

/// Starts the daily reminder for [settings], titled from the days in
/// [repository], on the device's notifications (or [platform]).
///
/// Call it once at start-up, after the settings are loaded; it returns at
/// once and never throws. It also reschedules whenever the app resumes.
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
  return scheduler..followAppResume();
}

/// Makes a [DailyReminderScheduler] available below it, so screens that
/// refresh the days can call [DailyReminderScheduler.reschedule].
class DailyReminderScope extends InheritedWidget {
  /// Provides [scheduler] to [child].
  const new({required this.scheduler, required super.child, super.key});

  /// The app's scheduler.
  final DailyReminderScheduler scheduler;

  /// The scheduler of the nearest scope, or `null` when there is none (for
  /// example a screen tested on its own). Does not rebuild [context].
  static DailyReminderScheduler? maybeOf(BuildContext context) {
    return context
        .getInheritedWidgetOfExactType<DailyReminderScope>()
        ?.scheduler;
  }

  @override
  bool updateShouldNotify(DailyReminderScope oldWidget) {
    return scheduler != oldWidget.scheduler;
  }
}
