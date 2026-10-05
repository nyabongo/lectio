import 'package:lectio/data/repository.dart';

/// Where the daily reminder finds the name of a day's celebration.
abstract interface class CelebrationSource {
  /// The name of the main celebration of the ISO [date] in the UI
  /// [language] (`en`, `sw`), or `null` when it is unknown.
  Future<String?> celebrationOn(String date, {String language = 'en'});
}

/// A [CelebrationSource] reading day documents through a [LectioRepository].
///
/// It takes the first document the repository has: the cached day (kept by
/// `prefetch` for the next 7 days) when there is one, otherwise a fetch. A
/// day that cannot be read is unknown, never an error. Every day document
/// carries the Kiswahili names too (`celebrations[].names`), so the English
/// documents serve both languages.
class RepositoryCelebrations implements CelebrationSource {
  /// Creates a source over [_repository].
  new(this._repository);

  final LectioRepository _repository;

  @override
  Future<String?> celebrationOn(String date, {String language = 'en'}) async {
    try {
      final snapshot = await _repository.watchDay(date).first;
      final celebrations = snapshot.value.celebrations;
      if (celebrations.isEmpty) return null;
      return celebrations.first.nameIn(language).text;
    } on Exception {
      return null;
    }
  }
}
