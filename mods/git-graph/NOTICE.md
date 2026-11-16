# git-graph: origin and changes

**From:** rabeeh-ta/herdr-git-graph, release 0.3.1 (https://github.com/rabeeh-ta/herdr-git-graph).

**Licence:** MIT (Rabeeh T A), in LICENSE in this folder.

**Changed by Jochen Rau, 2026-11:**

- mod.json: opens as a dialog (`mod.open:git-graph`).
- git.js: upstream tracking per branch; fast-forward of every branch only behind its upstream; push of the current branch (asks first); branch-menu fast-forward and push.
- graph.js: header Fast-forward / Push buttons; keyboard navigation (j/k, labels, branches, local/upstream, HEAD, main, parent); `/` search; `b` branch picker; commit review as a resizable files/diff split; `o` opens a file at a commit in $EDITOR; `?` help.
- graph.js split by topic: its helpers into common.js, reads.js and tools.js, and the Graph's methods into
  table.js, review.js, pickers.js and manygit.js (mixed into the class); each starts with a "Modified by" line.
- The update check is removed (update.js and its "Update Graph" button): an update from upstream would
  overwrite these changes. Its version comparison (`newer`) is in common.js.
