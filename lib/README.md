# lib: code several mods share

Herdr loads each mod from its own folder, and a mod can't import from another mod's folder. Code that
several mods need lives here, and `lib/sync.mjs` copies each file into the mods that use it, as
`mods/<mod>/lib/<file>`. Each copy's first line says where it came from.

- Edit the file here, then run `node lib/sync.mjs`. Never edit a copy.
- To give a mod a file, add the mod to `USES` in `lib/sync.mjs` and run it. Copies a mod no longer uses
  are removed.
- `node lib/sync.mjs --check` changes nothing and fails when a copy is missing, differs, or isn't listed.
  The unit tests run it (`tests/unit/lib.test.mjs`).

| File | What | Used by |
|---|---|---|
| `fuzzy.js` | fzf-like matching for every filter | file-browser, git-graph, new-space |
| `names.js` | a branch as a space or tab name (`feat/csv-export` → "Csv Export") | git-graph, worktree-actions, worktree-support |
| `settings.js` | `<appHome>/data/workbench.json`: `code_dir`, `fleet` | fleet-board, git-graph, new-space |
| `repos.js` | finding repositories with one `find` (a code folder of `~` only two levels down) | git-graph, new-space |
| `bars.js` | one height for every header row (`HEADER_H`, 42 px) and footer row (`FOOTER_H`, 28 px, `FOOTER_TEXT` 12), `footerBar` for a footer; the layout's own rows use the same numbers | file-browser, fleet-board, pr-board, side-header, sidebar-footer, usage-status |
| `boardheader.js` | the header of every board in a side column: one `HEADER_H` row (title, facts, buttons, ×), the board's own rows below | fleet-board, pr-board, side-header |
| `sidecolumn.js` | closing a side column the same way everywhere: the header's ×, Esc, its keys.json toggle; `focusFrame`, the pane focus line around a board while it has the keyboard | file-browser, fleet-board, pr-board, side-header, tabs-graph |
| `splitter.js` | every resize handle in the boards: one look (6 px band, 1 px line, accent while dragging, tinted on hover), double-click back to the default, and the drag's arithmetic | fleet-board, git-graph, pr-board |
| `tailpanel.js` | the tail panel at the bottom of a board: the splitter on its top edge, TAIL · title · following/ended · wrap · terminal · ✕, the newest lines (a dim label, text / command / error / mark), a click wraps one; `TailSize` keeps its height under the board's own shared key | fleet-board, pr-board |
| `worktree.js` | removing a worktree and its branch; `herdr.worktreeRemove` | git-graph, worktree-actions, worktree-support |

## Rules the shared code keeps

- **Removing a worktree's branch:** `git branch -d`, which keeps a branch with unmerged commits, unless the
  dialog that asked said those commits are lost. git-graph's dialog has a box for that ("Delete it even if it
  isn't merged"); the spaces list's clean-up dialog counts the commits on no remote before asking.
- **A branch with no words** (`feat/--`) keeps its own name as a space or tab name.
- **The code folder** (`code_dir`, else `~/Code`) is searched four levels down. A home folder, or a folder
  above one, is searched two levels down, skipping Desktop, Documents, Downloads and the like (macOS asks for
  permission before anything reads them).

## Shared state between mods

Mods also talk through Herdr's shared state (`shared(key)` / `setShared(key, value)`). The keys more than
one mod uses:

| Key | Written by | Read by | Value |
|---|---|---|---|
| `new-space.repos` | new-space | git-graph (`R`) | the code folder's repositories from the last scan, shown until a new scan ends |
| `worktree-support.request` | worktree-actions | worktree-support | a queue of requests (`askCleanup`, `cleanup`, …), each `{ id, at, action, … }`; worktree-support handles each id once, and requests older than 5 s are dropped when a new one is queued |
| `space.colors` | Herdr's own `picker` mod; worktree-support drops closed spaces' entries | space-agents, worktree-support | space id → color (`ansiN` or `#rrggbb`) |
| `preview-plus.target` | none of these mods (set outside them) | file-browser | space id → where a paired preview opens |
