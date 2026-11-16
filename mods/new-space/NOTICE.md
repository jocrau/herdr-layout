# new-space: origin and changes

**From:** Herdr's built-in `prompt` mod (its dialog's look and input handling).

**Licence:** Apache-2.0, in LICENSE-HERDR in this folder.

**Changed by Jochen Rau, 2026-11:**

- Asks for a new space's name and opens the space with its first tab named the same and
  `claude --remote-control <name>` running in it, instead of renaming one thing.
- Props `value`, `folder` and `machine` prefill the name and say where the space opens.
- A second field picks the folder from the git repositories under the code folder, filtered as you
  type (fzf-like, as in `file-browser` and `git-graph`), with Home folder and Browse… rows.
