// Copied from lib/tiptext.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// Text for a tooltip: wrapped at about `width` characters on word boundaries (a tooltip is one line per line, so an
// agent's long reason ran off the window), at most `lines` lines, the rest as "…". Existing line breaks stay.
export function tipText(text, width = 90, lines = 6) {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      for (let w = word; w.length; ) { // a word longer than a line is cut
        const piece = w.slice(0, width); w = w.slice(width);
        if (line && line.length + 1 + piece.length > width) { out.push(line); line = piece; }
        else line = line ? `${line} ${piece}` : piece;
      }
    }
    out.push(line);
  }
  return out.length > lines ? [...out.slice(0, lines - 1), `${out[lines - 1]} …`].join("\n") : out.join("\n");
}
