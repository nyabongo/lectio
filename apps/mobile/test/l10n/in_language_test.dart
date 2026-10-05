import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/l10n/in_language.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// [child] in an app whose UI language is [language].
Widget inApp(String language, Widget child) {
  return MaterialApp(
    locale: Locale(language),
    supportedLocales: supportedLocales,
    localizationsDelegates: lectioLocalizationsDelegates,
    home: Scaffold(body: child),
  );
}

/// Semantics widgets that set a locale for their subtree.
Finder localeMarks(Locale locale) => find.byWidgetPredicate(
  (widget) => widget is Semantics && widget.localeForSubtree == locale,
);

void main() {
  testWidgets('marks English text on a Kiswahili screen', (tester) async {
    await tester.pumpWidget(
      inApp('sw', const InLanguage(language: 'en', child: Text('Notes'))),
    );
    await tester.pumpAndSettle();

    expect(find.text('Notes'), findsOneWidget);
    expect(localeMarks(const Locale('en')), findsOneWidget);
  });

  testWidgets('leaves text in the UI language unmarked', (tester) async {
    await tester.pumpWidget(
      inApp('sw', const InLanguage(language: 'sw', child: Text('Madokezo'))),
    );
    await tester.pumpAndSettle();

    expect(find.text('Madokezo'), findsOneWidget);
    expect(localeMarks(const Locale('sw')), findsNothing);
    expect(localeMarks(const Locale('en')), findsNothing);
  });
}
