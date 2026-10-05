import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_paths.dart';

void main() {
  test('fixed documents', () {
    expect(indexPath, 'index.json');
    expect(passageIndexPath, 'passages/index.json');
    expect(upcomingPath, 'upcoming.json');
  });

  test('dayPath takes an ISO date', () {
    expect(dayPath('2026-09-20'), 'days/2026-09-20.json');
    expect(() => dayPath('../index'), throwsArgumentError);
    expect(() => dayPath('2026-9-20'), throwsArgumentError);
  });

  test('passagePath keeps canonical keys and escapes anything else', () {
    expect(passagePath('MT.20.1-16'), 'passages/MT.20.1-16.json');
    expect(
      passagePath('PS.145.2-3_145.8-9'),
      'passages/PS.145.2-3_145.8-9.json',
    );
    expect(passagePath('a/b'), 'passages/a%2Fb.json');
  });

  test('calendarPath', () {
    expect(calendarPath(2026), 'calendar/2026.json');
  });
}
