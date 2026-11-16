# file-browser: origin, changes and licences

**main.js** is original work by Jochen Rau (MIT, see the repository's LICENSE): the
keyboard-driven tree, the fuzzy filter and the dialog around the viewer.

**Everything else in this folder** (viewer.js, tree.js, paths.js, appearance.js,
media.js, markdown*.js, structured*.js, mermaid.js, mermaid.bundle.js, icons/) is
copied from **preview-plus** by linziyanleo, https://github.com/linziyanleo/herdr-mods
at commit a47550e, with these changes by Jochen Rau, 2026-11:

- main.js became viewer.js; a subclass sets the location (`context()`), commands it
  doesn't know are passed on, the panel frame is dropped in a dialog.
- Escape works like the back button.
- The preview cache moved from the mod folder to `data/file-browser/cache`
  (media.js, mermaid.js).
- viewer.js: a file as it was at a commit (`rev`, read with `git show`, read-only) with
  a badge saying so; keys scroll the rendered view (`scrollView`, a scroll handle).
- paths.js: the target takes that `rev` (a commit id, checked).
- markdown-view.js: the view can start at a later block (`markdownStart()`), so keys
  scroll Markdown by block; "↑ Whole document" goes back to the top.
- structured-view.js: JSON and CSV rows in a virtual list the keys can scroll
  (`v_virtual_list` instead of `uniform_list`).
- appearance.js: code in Atom One Dark's syntax colours instead of the theme's
  terminal colours.

Each changed file starts with a "Modified by" line.

preview-plus's THIRD_PARTY.md and licenses/ are kept unchanged: they cover the code
preview-plus took from others (Herdr, Apache-2.0; Herdr Files Plus, MIT; Cria File
Preview, Apache-2.0; beautiful-mermaid, MIT; elkjs, EPL-2.0; entities, BSD-2-Clause;
Radix, MIT). The elkjs source and its build patches are in the preview-plus
distribution linked above.

## Licence

preview-plus's author put its original code under MIT in
[e5f6558](https://github.com/linziyanleo/herdr-mods/commit/e5f655800daa6bec93c1224955c3d329dc9926b2)
(2026-11-12), in answer to
[issue #5](https://github.com/linziyanleo/herdr-mods/issues/5). That licence is in
LICENSE-PREVIEW-PLUS in this folder; the third-party parts keep the licences above
(elkjs's notice is in licenses/elkjs-NOTICE.txt).
