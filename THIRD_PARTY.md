# Third-party code

Each mod keeps its own licence files and a `NOTICE.md` that says where it comes from and what
was changed. Modified source files start with a one-line "Modified by …" comment.

| Mod | From | Licence | Changed |
|---|---|---|---|
| `beads` | original | MIT ([LICENSE](LICENSE)) | — |
| `fleet-board` | original | MIT ([LICENSE](LICENSE)) | — |
| `extras/` (`claude-statusline.py`, `claude-resume`) | original | MIT ([LICENSE](LICENSE)) | — |
| `file-browser` | `main.js` original; the viewer and renderers from [linziyanleo/herdr-mods](https://github.com/linziyanleo/herdr-mods) preview-plus @ a47550e | MIT for `main.js`; preview-plus: MIT (LICENSE-PREVIEW-PLUS); its bundled components: their own licences in `mods/file-browser/licenses/` and `THIRD_PARTY.md` | yes |
| `preview-plus` | [linziyanleo/herdr-mods](https://github.com/linziyanleo/herdr-mods) preview-plus @ a1f70b3 | MIT (linziyanleo); its bundled components (Herdr and Cria: Apache-2.0, elkjs: EPL-2.0, …): their own licences in `mods/preview-plus/licenses/` and `THIRD_PARTY.md` | yes |
| `git-graph` | [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) 0.3.1 | MIT (Rabeeh T A) | yes |
| `worktree-support` | [natelandau/herdr-worktree-support](https://github.com/natelandau/herdr-worktree-support) @ 711e079, from Herdr's `spaces` | MIT (Nate Landau), Apache-2.0 (Herdr) | yes |
| `worktree-actions` | [natelandau/herdr-worktree-support](https://github.com/natelandau/herdr-worktree-support) @ 711e079 | MIT (Nate Landau) | yes |
| `space-agents` | Herdr's built-in `agents` | Apache-2.0 (Herdr) | yes |
| `new-space` | Herdr's built-in `prompt` | Apache-2.0 (Herdr) | yes |
| `tabs-graph` | Herdr's built-in `tabs` 0.1.13 | Apache-2.0 (Herdr) | yes |
| `usage-status` | Herdr's built-in `workspace-status` 0.1.13 | Apache-2.0 (Herdr) | yes |
| `sidebar-footer` | the footer of Herdr's built-in `workspace-chrome` 0.1.16 | Apache-2.0 (Herdr) | yes |
| `layouts/workbench.json` | Herdr's `main` layout 0.1.13 | Apache-2.0 (Herdr, [LICENSE-HERDR](LICENSE-HERDR)); changes MIT | yes |

The layout also uses Herdr's own `workspace-chrome` (the top bar), `changes`, `pane`, `menu`,
`new-menu`, `confirm` and `worktree` mods and their icons. They ship with the Herdr app and are
not copied here.
