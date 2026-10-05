import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/features/share/site_links.dart';

final Uri _site = Uri.parse('https://nyabongo.github.io/lectio/');

const String _note =
    '/reading?date=2026-09-20&slot=gospel&tab=original&note=v15-evil-eye';

void main() {
  group('site URLs', () {
    test('the site root is two levels above the API root', () {
      expect(siteBaseFor('https://nyabongo.github.io/lectio/api/v1/'), _site);
      expect(
        siteBaseFor('https://lectio.example/api/v1/'),
        Uri.parse('https://lectio.example/'),
      );
      expect(siteBaseUrl, siteBaseFor(defaultApiBaseUrl));
    });

    test('page paths and absolute URLs', () {
      expect(dayPagePath('2026-09-20'), '2026-09-20/');
      expect(
        insightPagePath('2026-09-20', 'gospel', 'v15-evil-eye'),
        '2026-09-20/gospel/notes/v15-evil-eye/',
      );
      expect(
        siteUrl('2026-09-20/', site: _site).toString(),
        'https://nyabongo.github.io/lectio/2026-09-20/',
      );
      expect(siteUrl('2026-09-20/'), siteBaseUrl.resolve('2026-09-20/'));
    });
  });

  group('locationForSitePath', () {
    String? at(String path) => locationForSitePath(path.split('/'));

    test('maps the site pages to the app', () {
      expect(at(''), '/today');
      expect(at('2026-09-20/'), '/today?date=2026-09-20');
      expect(at('2026-09-20/listen/'), '/listen?date=2026-09-20');
      expect(at('2026-09-20/gospel/'), '/reading?date=2026-09-20&slot=gospel');
      expect(at('2026-09-20/psalm'), '/reading?date=2026-09-20&slot=psalm');
      expect(at('2026-09-20/gospel/notes/v15-evil-eye/'), _note);
      expect(at('calendar/2026/'), '/calendar');
      expect(at('settings/'), '/settings');
    });

    test('ignores the locale prefix', () {
      expect(at('sw'), '/today');
      expect(at('sw/2026-09-20/gospel/notes/v15-evil-eye'), _note);
    });

    test('is null for pages the app does not have', () {
      for (final path in [
        'about/',
        'search',
        '2026-9-20/',
        '2026-09-20/Gospel/',
        '2026-09-20/gospel/notes/',
        '2026-09-20/gospel/notes/a b/',
        '2026-09-20/gospel/other/v15/',
        '2026-09-20/gospel/notes/v15/more',
        'sw/sw/2026-09-20/',
      ]) {
        expect(at(path), isNull, reason: path);
      }
    });
  });

  group('locationForLink', () {
    String? open(String link) => locationForLink(Uri.parse(link), site: _site);

    test('opens site links under the base path, http or https', () {
      expect(open('https://nyabongo.github.io/lectio/'), '/today');
      expect(open('https://nyabongo.github.io/lectio'), '/today');
      expect(
        open('https://nyabongo.github.io/lectio/2026-09-20/gospel/?utm=x#v15'),
        '/reading?date=2026-09-20&slot=gospel',
      );
      expect(
        open('http://NYABONGO.github.io/lectio/sw/2026-09-20/'),
        '/today?date=2026-09-20',
      );
    });

    test('opens lectio:// links', () {
      expect(open('lectio://2026-09-20/gospel/notes/v15-evil-eye'), _note);
      expect(open('lectio:///2026-09-20/'), '/today?date=2026-09-20');
      expect(open('lectio://'), '/today');
    });

    test('ignores other links', () {
      for (final link in [
        'https://example.org/lectio/2026-09-20/',
        'https://nyabongo.github.io/2026-09-20/',
        'https://nyabongo.github.io/other/2026-09-20/',
        'https://nyabongo.github.io:8443/lectio/2026-09-20/',
        'ftp://nyabongo.github.io/lectio/2026-09-20/',
        'https://nyabongo.github.io/lectio/about/',
      ]) {
        expect(open(link), isNull, reason: link);
      }
    });

    test('a site at a domain root takes every path', () {
      final root = Uri.parse('https://lectio.example/');
      final link = root.resolve('2026-09-20/');
      expect(locationForLink(link, site: root), '/today?date=2026-09-20');
    });

    test('defaults to the site of this build', () {
      expect(locationForLink(siteBaseUrl.resolve('2026-09-20/')), isNotNull);
    });
  });

  test('a reminder opens its day', () {
    expect(reminderLocation('2026-09-20'), '/today?date=2026-09-20');
    expect(reminderLocation('tomorrow'), isNull);
    expect(reminderLocation(null), isNull);
  });

  test('noteLocation keeps the reading location and adds the note', () {
    expect(noteLocation('2026-09-20', 'gospel', 'v15-evil-eye'), _note);
  });
}
