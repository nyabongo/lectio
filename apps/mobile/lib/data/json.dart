/// Typed reads from decoded JSON, for the hand-written API v1 models.
///
/// Every read checks the runtime type and throws a [FormatException] naming
/// the field, so a malformed document fails loudly at the edge instead of
/// deep inside a widget. Fields a model does not read are ignored: API v1 is
/// additive only, and clients must accept fields they do not know.
library;

/// A decoded JSON object.
typedef JsonObject = Map<String, Object?>;

/// The API version this app reads (`apiVersion` in every document).
const int supportedApiVersion = 1;

/// [value] as a JSON object, or a [FormatException] naming [field].
JsonObject asJsonObject(Object? value, [String field = 'document']) {
  if (value is JsonObject) return value;
  throw FormatException('Expected an object for "$field"');
}

/// [value] as a top-level API document whose `apiVersion` this app reads.
JsonObject asApiDocument(Object? value) {
  final document = asJsonObject(value);
  if (document['apiVersion'] != supportedApiVersion) {
    throw const FormatException('Unsupported apiVersion');
  }
  return document;
}

/// Typed field reads on a [JsonObject].
extension JsonRead on JsonObject {
  T _read<T>(String field) {
    final value = this[field];
    if (value is T) return value;
    throw FormatException('Expected $T for "$field"');
  }

  /// The string at [field].
  String string(String field) => _read<String>(field);

  /// The string at [field], or `null` when it is null or absent.
  String? optionalString(String field) => _read<String?>(field);

  /// The integer at [field].
  int integer(String field) => _read<int>(field);

  /// The boolean at [field].
  bool boolean(String field) => _read<bool>(field);

  /// The number at [field] as a double, or `null` when null or absent.
  double? optionalNumber(String field) => _read<num?>(field)?.toDouble();

  /// The URL at [field].
  Uri uri(String field) => Uri.parse(string(field));

  /// The URL at [field], or `null` when it is null or absent.
  Uri? optionalUri(String field) {
    final value = optionalString(field);
    return value == null ? null : Uri.parse(value);
  }

  /// The date-time at [field], or `null` when it is null or absent.
  DateTime? optionalDateTime(String field) {
    final value = optionalString(field);
    return value == null ? null : DateTime.parse(value);
  }

  /// The object at [field].
  JsonObject object(String field) => asJsonObject(this[field], field);

  /// The object at [field], or `null` when it is null or absent.
  JsonObject? optionalObject(String field) {
    final value = this[field];
    return value == null ? null : asJsonObject(value, field);
  }

  /// The list at [field], each item read by [parse].
  List<T> list<T>(String field, T Function(Object? item) parse) {
    return List.unmodifiable(_read<List<Object?>>(field).map(parse));
  }

  /// The list of strings at [field].
  List<String> strings(String field) {
    return list(field, (item) => _item<String>(item, field));
  }

  /// The list of integers at [field].
  List<int> integers(String field) {
    return list(field, (item) => _item<int>(item, field));
  }
}

T _item<T>(Object? item, String field) {
  if (item is T) return item;
  throw FormatException('Expected a list of $T for "$field"');
}
