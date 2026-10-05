import 'dart:convert';
import 'dart:io';

/// The text of `test/fixtures/<name>.json`.
///
/// The fixtures are API v1 documents that `packages/schema` validates against
/// the API schemas (`src/api/mobile-fixtures.test.ts`), so the models are
/// tested against the same contract the site is.
String fixture(String name) {
  return File('test/fixtures/$name.json').readAsStringSync();
}

/// `test/fixtures/<name>.json`, decoded.
Object? fixtureJson(String name) => jsonDecode(fixture(name));

/// `test/fixtures/<name>.json`, decoded as an object, for tests that edit it.
Map<String, Object?> fixtureObject(String name) {
  return fixtureJson(name)! as Map<String, Object?>;
}
