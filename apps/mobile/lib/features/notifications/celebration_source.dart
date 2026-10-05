import 'package:lectio/data/repository.dart';

/// Where the daily reminder finds the name of a day's celebration.
abstract interface class CelebrationSource {
  /// The main celebration of the ISO [date], or `null` when it is unknown.
  Future<String?> celebrationOn(String date);
}

/// A [CelebrationSource] reading day documents through a [LectioRepository].
///
/// It takes the first document the repository has: the cached day (kept by
/// `prefetch` for the next 7 days) when there is one, otherwise a fetch. A
/// day that cannot be read is unknown, never an error.
class RepositoryCelebrations implements CelebrationSource {
  /// Creates a source over [_repository].
  new(this._repository);

  final LectioRepository _repository;

  @override
  Future<String?> celebrationOn(String date) async {
    try {
      final snapshot = await _repository.watchDay(date).first;
      final celebrations = snapshot.value.celebrations;
      return celebrations.isEmpty ? null : celebrations.first.name;
    } on Exception {
      return null;
    }
  }
}
