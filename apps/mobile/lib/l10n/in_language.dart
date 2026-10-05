import 'package:flutter/widgets.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// Marks [child] as written in [language] when that is not the UI language,
/// so screen readers read it with the right voice (WCAG 3.1.2), as the site
/// marks English notes `lang="en"` on Kiswahili pages.
class InLanguage extends StatelessWidget {
  /// Marks [child] as [language] (`en`, `sw`).
  const new({required this.language, required this.child, super.key});

  /// The language [child] is written in.
  final String language;

  /// The content.
  final Widget child;

  /// Whether [language] differs from the UI language of [context].
  bool isForeign(BuildContext context) {
    return language != LectioLocalizations.of(context).languageCode;
  }

  @override
  Widget build(BuildContext context) {
    if (!isForeign(context)) return child;
    return Semantics(localeForSubtree: Locale(language), child: child);
  }
}
