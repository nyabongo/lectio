import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:lectio/data/api_cache.dart';
import 'package:path_provider/path_provider.dart';

/// An [ApiCache] on disk: one JSON file per API path in [directory].
///
/// Writes go to a temporary file that is then renamed, so a crash never
/// leaves half a document behind. Unreadable entries read as missing.
class FileApiCache implements ApiCache {
  /// Creates a cache in [directory], which is created on first write.
  new(this.directory);

  /// The cache in the app's support directory (`<support>/api-v1`), which the
  /// operating system does not clear the way it clears cache directories.
  static Future<FileApiCache> inSupportDirectory() async {
    final support = await getApplicationSupportDirectory();
    return FileApiCache(Directory('${support.path}/api-v1'));
  }

  /// Where the entries are.
  final Directory directory;

  static final Random _random = Random();

  File _file(String path) {
    return File('${directory.path}/${Uri.encodeComponent(path)}');
  }

  @override
  Future<CachedResponse?> read(String path) async {
    try {
      final text = await _file(path).readAsString();
      return CachedResponse.fromJson(jsonDecode(text));
    } on FileSystemException {
      return null;
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> write(String path, CachedResponse entry) async {
    await directory.create(recursive: true);
    final file = _file(path);
    // Unique across instances and isolates sharing the directory.
    final suffix = '$pid-${_random.nextInt(1 << 32)}';
    final temporary = File('${file.path}.$suffix.tmp');
    await temporary.writeAsString(jsonEncode(entry.toJson()), flush: true);
    await temporary.rename(file.path);
  }
}
