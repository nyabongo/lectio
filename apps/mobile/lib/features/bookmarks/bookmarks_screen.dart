import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/bookmarks/bookmark.dart';
import 'package:lectio/features/bookmarks/bookmark_export.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/src/screens/standalone_scaffold.dart';

/// The title of the Bookmarks screen.
const String bookmarksTitle = 'Bookmarks and notes';

/// Tells the reader when a change could not be saved on the device.
void reportUnsaved(BuildContext context, {required bool saved}) {
  if (saved || !context.mounted) return;
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
    const SnackBar(
      content: Text(
        'This device is not letting Lectio save, so the change will be lost '
        'when the app closes.',
      ),
    ),
  );
}

/// Deletes the note on [target] and offers to undo it, since the note is the
/// reader's own writing.
Future<void> deleteNoteWithUndo(
  BuildContext context,
  BookmarksController controller,
  BookmarkTarget target,
) async {
  final note = controller.noteFor(target);
  final saved = await controller.deleteNote(target);
  if (!context.mounted) return;
  if (!saved || note == null) {
    reportUnsaved(context, saved: saved);
    return;
  }
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
    SnackBar(
      content: const Text('Note deleted.'),
      action: SnackBarAction(
        label: 'Undo',
        onPressed: () => unawaited(controller.restoreNote(note)),
      ),
    ),
  );
}

/// Bookmarks and personal notes, with export as JSON through the share sheet.
class BookmarksScreen extends StatelessWidget {
  /// Creates the screen; [share] opens the share sheet (default:
  /// [defaultShareSheet]).
  const new({super.key, this.share});

  /// Opens the share sheet.
  final ShareSheet? share;

  Future<void> _export(
    BuildContext context,
    BookmarksController controller,
  ) async {
    final params = bookmarkExportParams(
      controller.exportJson(),
      origin: shareOrigin(context.findRenderObject()),
    );
    try {
      await (share ?? defaultShareSheet())(params);
    } on Exception {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('The share sheet could not be opened.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = BookmarksScope.of(context);
    final theme = Theme.of(context);
    final bookmarks = controller.bookmarks;
    final notes = controller.notes;
    return StandaloneScaffold(
      title: bookmarksTitle,
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text(
              'Saved on this device only. There are no accounts, so bookmarks '
              'and notes do not sync. Export them to keep a copy.',
            ),
          ),
          if (controller.hasUnreadableData)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                'Some bookmarks or notes saved earlier could not be read. A '
                'copy is kept on this device and included in the export.',
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          _Heading('Bookmarks', style: theme.textTheme.titleMedium),
          if (bookmarks.isEmpty)
            const ListTile(title: Text('No bookmarks yet.'))
          else
            for (final bookmark in bookmarks)
              ListTile(
                leading: Icon(_kindIcon(bookmark.target.kind)),
                title: Text(bookmark.title),
                subtitle: Text(_describe(bookmark.target)),
                trailing: IconButton(
                  icon: const Icon(Icons.bookmark_remove_outlined),
                  tooltip: 'Remove bookmark',
                  onPressed: () async {
                    final saved = await controller.removeBookmark(
                      bookmark.target,
                    );
                    if (context.mounted) reportUnsaved(context, saved: saved);
                  },
                ),
              ),
          _Heading('Notes', style: theme.textTheme.titleMedium),
          if (notes.isEmpty)
            const ListTile(title: Text('No notes yet.'))
          else
            for (final note in notes)
              ListTile(
                leading: Icon(_kindIcon(note.target.kind)),
                title: Text(note.title),
                subtitle: Text(
                  note.text,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () => unawaited(
                  showNoteEditor(context, note.target, title: note.title),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: 'Delete note',
                  onPressed: () => unawaited(
                    deleteNoteWithUndo(context, controller, note.target),
                  ),
                ),
              ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Builder(
              builder: (context) => FilledButton.tonalIcon(
                icon: const Icon(Icons.ios_share),
                label: const Text('Export as JSON'),
                onPressed: controller.isEmpty && !controller.hasUnreadableData
                    ? null
                    : () => unawaited(_export(context, controller)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const new(this.text, {required this.style});

  final String text;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(text, style: style),
    );
  }
}

IconData _kindIcon(BookmarkKind kind) => switch (kind) {
  BookmarkKind.day => Icons.today_outlined,
  BookmarkKind.reading => Icons.menu_book_outlined,
  BookmarkKind.insight => Icons.lightbulb_outline,
};

String _describe(BookmarkTarget target) =>
    '${target.kind.label} · ${target.date}';

/// Bookmarks [target] under [title], or removes its bookmark, from the
/// nearest [BookmarksScope].
class BookmarkButton extends StatelessWidget {
  /// Creates a toggle for [target], saved under [title].
  const new({required this.target, required this.title, super.key});

  /// The day, reading or insight to bookmark.
  final BookmarkTarget target;

  /// What the Bookmarks screen lists it as.
  final String title;

  @override
  Widget build(BuildContext context) {
    final controller = BookmarksScope.of(context);
    final saved = controller.isBookmarked(target);
    return IconButton(
      icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border),
      tooltip: saved ? 'Remove bookmark' : 'Bookmark',
      onPressed: () async {
        final stuck = await controller.toggleBookmark(target, title: title);
        if (context.mounted) reportUnsaved(context, saved: stuck);
      },
    );
  }
}

/// Opens an editor for the note on [target] (titled [title] in the
/// Bookmarks screen) and saves it in the nearest [BookmarksScope].
Future<void> showNoteEditor(
  BuildContext context,
  BookmarkTarget target, {
  required String title,
}) async {
  final controller = BookmarksScope.of(context);
  final text = await showDialog<String>(
    context: context,
    builder: (context) =>
        NoteEditorDialog(initialText: controller.noteFor(target)?.text ?? ''),
  );
  if (text == null || !context.mounted) return;
  if (text.trim().isEmpty && controller.noteFor(target) != null) {
    await deleteNoteWithUndo(context, controller, target);
    return;
  }
  final saved = await controller.saveNote(target, title: title, text: text);
  if (context.mounted) reportUnsaved(context, saved: saved);
}

/// A dialog to write a personal note; pops the text on Save (empty to delete)
/// and `null` on Cancel.
class NoteEditorDialog extends StatefulWidget {
  /// Creates the dialog starting with [initialText].
  const new({required this.initialText, super.key});

  /// The note so far, or empty for a new note.
  final String initialText;

  @override
  State<NoteEditorDialog> createState() => _NoteEditorDialogState();
}

class _NoteEditorDialogState extends State<NoteEditorDialog> {
  late final TextEditingController _text = TextEditingController(
    text: widget.initialText,
  );

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.initialText.isNotEmpty;
    return AlertDialog(
      title: Text(editing ? 'Edit note' : 'Add a note'),
      content: TextField(
        controller: _text,
        autofocus: true,
        maxLines: 6,
        minLines: 3,
        decoration: const InputDecoration(
          hintText: 'Your note stays on this device.',
        ),
      ),
      actions: [
        if (editing)
          TextButton(
            onPressed: () => Navigator.of(context).pop(''),
            child: const Text('Delete'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_text.text),
          child: const Text('Save'),
        ),
      ],
    );
  }
}

/// The Bookmarks route, a sub-route of Settings (`/settings/bookmarks`).
GoRoute bookmarksRoute() {
  return GoRoute(
    path: 'bookmarks',
    name: 'bookmarks',
    builder: (context, state) => const BookmarksScreen(),
  );
}
