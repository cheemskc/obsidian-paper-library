# Elton Reader annotation attribution

The selection-rectangle helper and serialized-edit queue in
`vendor/elton-annotation-core.cjs` are adapted from Elton Reader, Copyright (c)
2026 Elton Labs, MIT License. The complete license is retained in that file.

Source: https://github.com/swayinfo/elton-reader

Pinned revision: `2753740304096b661e5f6bd8fc66795054847a32` (`src/main.js`,
`erSelectionRect` and `_persistHighlights`).

Paper Library adapts the immediate-paint / separately persisted annotation flow
to Obsidian's native PDF reader. The SVG PDF-coordinate overlay and PDF export
adapter are Paper Library implementations. Elton's EPUB/HTML DOM wrappers,
custom reader, bundled PDF.js engine, and full-book JSON storage are not copied.

New marks live in the existing paper annotation records in plugin `data.json`
(not a disposable parser cache), and are mirrored into the paper's Markdown note.
They are embedded into the PDF only through the explicit **写入 PDF** action.
Existing PDF-embedded marks continue to use the original native annotation path.
