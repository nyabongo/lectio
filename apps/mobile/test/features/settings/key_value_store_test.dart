import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('MemoryKeyValueStore', () {
    test('reads what was written', () async {
      final store = MemoryKeyValueStore({'a': '1'});
      expect(store.read('a'), '1');
      expect(store.read('b'), isNull);

      expect(await store.write('b', '2'), isTrue);
      expect(store.read('b'), '2');
      expect(store.values, {'a': '1', 'b': '2'});
    });

    test('copies its starting values', () async {
      final initial = {'a': '1'};
      final store = MemoryKeyValueStore(initial);
      await store.write('a', '2');
      expect(initial['a'], '1');
    });

    test('reports failed writes and keeps the old value', () async {
      final store = MemoryKeyValueStore({'a': '1'})..failWrites = true;
      expect(await store.write('a', '2'), isFalse);
      expect(store.read('a'), '1');
    });
  });

  group('SharedPreferencesStore', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('reads strings and ignores other types', () async {
      SharedPreferences.setMockInitialValues({'text': 'hello', 'number': 3});
      final store = await SharedPreferencesStore.open();
      expect(store.read('text'), 'hello');
      expect(store.read('number'), isNull);
      expect(store.read('missing'), isNull);
    });

    test('keeps writes across a restart of the app', () async {
      final store = await SharedPreferencesStore.open();
      expect(await store.write('lectio.test', '{"a":1}'), isTrue);
      expect(store.read('lectio.test'), '{"a":1}');

      // Drop the in-memory cache, as a new process would, and load again
      // from the platform store.
      SharedPreferences.resetStatic();
      final reopened = await SharedPreferencesStore.open();
      expect(reopened.read('lectio.test'), '{"a":1}');
    });
  });

  group('writeSafely', () {
    test('passes on the result of the write', () async {
      final store = MemoryKeyValueStore();
      expect(await writeSafely(store, 'a', '1'), isTrue);
      expect(store.read('a'), '1');
      store.failWrites = true;
      expect(await writeSafely(store, 'a', '2'), isFalse);
    });

    test('turns a throwing write into false', () async {
      expect(await writeSafely(ThrowingStore(), 'a', '1'), isFalse);
    });
  });

  group('openDeviceStore', () {
    test('opens the device preferences by default', () async {
      SharedPreferences.setMockInitialValues({'k': 'v'});
      final store = await openDeviceStore();
      expect(store, isA<SharedPreferencesStore>());
      expect(store.read('k'), 'v');
    });

    test('uses the store it is given', () async {
      final given = MemoryKeyValueStore();
      expect(await openDeviceStore(open: () async => given), same(given));
    });

    test('falls back to memory that reports unsaved writes', () async {
      final store = await openDeviceStore(
        open: () async => throw PlatformException(code: 'channel-error'),
      );
      expect(store, isA<MemoryKeyValueStore>());
      expect(store.read('k'), isNull);
      expect(await store.write('k', 'v'), isFalse);
    });
  });
}

/// A store whose writes throw, like a failing platform channel.
class ThrowingStore implements KeyValueStore {
  @override
  String? read(String key) => null;

  @override
  Future<bool> write(String key, String value) async {
    throw PlatformException(code: 'channel-error');
  }
}
