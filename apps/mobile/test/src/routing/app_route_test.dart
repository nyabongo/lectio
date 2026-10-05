import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/routing/router.dart';

void main() {
  test('Today, Reading and Listen are the tabs', () {
    expect(AppRoute.tabs, [AppRoute.today, AppRoute.reading, AppRoute.listen]);
    expect(AppRoute.calendar.isTab, isFalse);
    expect(AppRoute.settings.isTab, isFalse);
    expect(AppRoute.listen.isTab, isTrue);
  });

  test('every route has a distinct absolute path', () {
    final paths = {for (final route in AppRoute.values) route.path};
    expect(paths, hasLength(AppRoute.values.length));
    expect(paths.every((path) => path.startsWith('/')), isTrue);
  });

  test('tabForPath finds the tab or falls back to Today', () {
    expect(tabForPath('/reading'), AppRoute.reading);
    expect(tabForPath('/calendar'), AppRoute.today);
    expect(tabForPath('/nowhere'), AppRoute.today);
  });
}
