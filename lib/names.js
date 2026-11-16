// A branch as a space or tab name: no prefix, words capitalized ("feat/csv-export" → "Csv Export").
// Spaces read as words; branches and worktree folders keep their git names. A branch with no words
// in its last part ("feat/--") keeps its name; no branch gives "".
export function branchTitle(branch) {
  const name = branch ?? "";
  return name.split("/").pop().split(/[-_.\s]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || name;
}
