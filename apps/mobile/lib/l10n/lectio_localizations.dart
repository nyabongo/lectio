import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lectio/l10n/catalog.g.dart';

/// The UI languages, the first being the fallback for untranslated keys.
const List<String> supportedLanguages = ['en', 'sw'];

/// [supportedLanguages] as locales, for `MaterialApp.supportedLocales`.
const List<Locale> supportedLocales = [Locale('en'), Locale('sw')];

/// The delegates `MaterialApp.localizationsDelegates` needs: the app's
/// strings and Flutter's own (Material, Cupertino, widgets).
const List<LocalizationsDelegate<Object>> lectioLocalizationsDelegates = [
  LectioLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
];

final RegExp _placeholder = RegExp(r'\{(\w+)\}');

Map<String, Map<String, Object?>>? _catalogs;

/// Every locale's messages, parsed from `catalog.g.dart` on first use.
Map<String, Map<String, Object?>> get _parsedCatalogs {
  return _catalogs ??= {
    for (final MapEntry(:key, :value)
        in (jsonDecode(catalogJson) as Map<String, Object?>).entries)
      key: value! as Map<String, Object?>,
  };
}

/// [language] when the app has it, else English.
String supportedLanguage(String? language) {
  return supportedLanguages.contains(language)
      ? language!
      : supportedLanguages.first;
}

/// The plural category of [count] in [language]: English and Kiswahili both
/// use `one` for 1 and `other` for everything else.
String pluralCategory(String language, num count) {
  return count == 1 ? 'one' : 'other';
}

/// The UI strings of one language (L-114), generated from the site's
/// catalogs and the app's own by `tool/sync_l10n.dart`.
///
/// Keys are the site's dotted keys with `_` (`day.slot.psalm` →
/// `day_slot_psalm`); the app's own start with `app_`. A key the language
/// lacks falls back to English, as on the site. Kiswahili is provisional
/// until a native speaker reviews it (#221).
class LectioLocalizations {
  /// The strings of [language] (English when the app does not have it).
  factory forLanguage(String language) {
    final code = supportedLanguage(language);
    return _cache[code] ??= LectioLocalizations._(code);
  }

  new _(this.languageCode);

  static final Map<String, LectioLocalizations> _cache = {};

  /// The English strings.
  static final LectioLocalizations en = LectioLocalizations.forLanguage('en');

  /// Loads the strings for `MaterialApp.locale`.
  static const LocalizationsDelegate<LectioLocalizations> delegate =
      _LectioLocalizationsDelegate();

  /// The strings of the nearest [Localizations], or English when there are
  /// none (for example a widget tested without the app's delegates).
  static LectioLocalizations of(BuildContext context) {
    return Localizations.of<LectioLocalizations>(
          context,
          LectioLocalizations,
        ) ??
        en;
  }

  /// The language, for example `sw`.
  final String languageCode;

  /// [languageCode] as a [Locale].
  Locale get locale => Locale(languageCode);

  Object? _message(String key) {
    final catalogs = _parsedCatalogs;
    return catalogs[languageCode]![key] ??
        catalogs[supportedLanguages.first]![key];
  }

  /// The message [key] with its `{name}` placeholders filled from [params].
  ///
  /// A plural message picks its form for `params['count']`. Throws an
  /// [ArgumentError] for an unknown key, a missing parameter or a plural
  /// message without a numeric `count`, so a broken string fails its test.
  String text(String key, [Map<String, Object> params = const {}]) {
    final message = _message(key);
    if (message == null) {
      throw ArgumentError.value(key, 'key', 'Unknown message');
    }
    final String template;
    if (message is String) {
      template = message;
    } else {
      final count = params['count'];
      if (count is! num) {
        throw ArgumentError.value(key, 'key', 'Needs a numeric "count"');
      }
      final forms = message as Map<String, Object?>;
      template =
          (forms[pluralCategory(languageCode, count)] ?? forms['other'])!
              as String;
    }
    return template.replaceAllMapped(_placeholder, (match) {
      final name = match.group(1)!;
      final value = params[name];
      if (value == null) {
        throw ArgumentError.value(key, 'key', 'Needs the parameter "$name"');
      }
      return '$value';
    });
  }
}

class _LectioLocalizationsDelegate
    extends LocalizationsDelegate<LectioLocalizations> {
  const new();

  @override
  bool isSupported(Locale locale) {
    return supportedLanguages.contains(locale.languageCode);
  }

  @override
  Future<LectioLocalizations> load(Locale locale) async {
    // Dates are written with intl in the UI language (`sw`: Jumapili …).
    await initializeDateFormatting(locale.languageCode);
    return LectioLocalizations.forLanguage(locale.languageCode);
  }

  @override
  bool shouldReload(_LectioLocalizationsDelegate old) => false;
}
