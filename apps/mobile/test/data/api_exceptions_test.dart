import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_exceptions.dart';

void main() {
  final uri = Uri.parse('https://api.test/days/2026-09-20.json');

  test('not found', () {
    final error = ApiNotFoundException(uri);
    expect(error.uri, uri);
    expect(error.reason, 'not found');
    expect('$error', 'ApiException: not found ($uri)');
  });

  test('unexpected status', () {
    final error = ApiStatusException(uri, 503);
    expect(error.statusCode, 503);
    expect(error.reason, 'HTTP 503');
  });

  test('network failure keeps its cause', () {
    final cause = TimeoutException('slow');
    final error = ApiNetworkException(uri, cause);
    expect(error.cause, same(cause));
    expect(error.reason, startsWith('network error: TimeoutException'));
  });
}
