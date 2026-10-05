/// Why a request to the API failed.
///
/// A document that arrives but cannot be read throws a [FormatException]
/// instead.
sealed class ApiException implements Exception {
  /// Creates an exception for the request to [uri].
  const new(this.uri);

  /// The URL that was requested.
  final Uri uri;

  /// A short description of the failure.
  String get reason;

  @override
  String toString() => 'ApiException: $reason ($uri)';
}

/// The document does not exist (HTTP 404), for example a day with no file.
final class ApiNotFoundException extends ApiException {
  /// Creates a not-found exception.
  const new(super.uri);

  @override
  String get reason => 'not found';
}

/// The server answered with an unexpected HTTP status.
final class ApiStatusException extends ApiException {
  /// Creates an exception for [statusCode].
  const new(super.uri, this.statusCode);

  /// The HTTP status code.
  final int statusCode;

  @override
  String get reason => 'HTTP $statusCode';
}

/// The request did not complete: offline, DNS, TLS or a timeout.
final class ApiNetworkException extends ApiException {
  /// Creates an exception wrapping [cause].
  const new(super.uri, this.cause);

  /// What the HTTP client threw.
  final Exception cause;

  @override
  String get reason => 'network error: $cause';
}
