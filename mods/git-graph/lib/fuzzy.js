// Copied from lib/fuzzy.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// fzf-like matching, for every filter in the layout (file-browser's files, git-graph's branches and
// repositories, new-space's repositories): the term's letters in order; runs, segment starts and the
// last segment score higher. null: no match.
export function fuzzy(term, text) {
  return fuzzyLower(term.toLowerCase(), text.toLowerCase());
}

// The same, for a term and text already lower-case (a long list lowers its paths once, not per keystroke).
export function fuzzyLower(q, p) {
  const name = p.lastIndexOf("/") + 1;
  let score = 0, j = 0, run = 0, last = -2;
  for (let i = 0; i < p.length && j < q.length; i++) {
    if (p[i] !== q[j]) continue;
    run = i === last + 1 ? run + 1 : 0;
    score += 1 + run * 3 + (i >= name ? 2 : 0) + (i === 0 || "/_-. ".includes(p[i - 1]) ? 4 : 0);
    last = i; j++;
  }
  return j === q.length ? score - p.length * 0.01 : null;
}
