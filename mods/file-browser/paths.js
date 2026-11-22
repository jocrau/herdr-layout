// Modified by Jochen Rau, 2026-11, from linziyanleo/herdr-mods preview-plus: see NOTICE.md in this folder.
const IMAGES = new Set(["png", "jpg", "jpeg", "webp", "svg"]);

export function normalize(path) {
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(path);
  const source = windows ? path.replaceAll("\\", "/") : path;
  const prefix = source.startsWith("//") ? "//" : source.startsWith("/") ? "/" : /^[a-z]:\//i.test(source) ? source.slice(0, 3) : "";
  const parts = [];
  for (const part of source.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part !== ".." || !prefix) parts.push(part);
  }
  return prefix + parts.join("/") || ".";
}

export const absolute = path => /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path);
export const basename = path => normalize(path).split("/").pop() || path;
export function dirname(path) {
  const value = normalize(path), index = value.lastIndexOf("/");
  return index === 0 ? "/" : index === 2 && value[1] === ":" ? value.slice(0, 3) : index < 0 ? "." : value.slice(0, index);
}
export const join = (base, path) => normalize(absolute(path) ? path : `${base}/${path}`);
export const extension = path => basename(path).split(".").pop().toLowerCase();
export const kind = path => IMAGES.has(extension(path)) ? "image" : ["pdf", "json", "csv", "tsv"].includes(extension(path)) ? extension(path) : ["md", "markdown"].includes(extension(path)) ? "markdown" : ["yaml", "yml"].includes(extension(path)) ? "yaml" : "text";
export const richText = type => ["markdown", "json", "yaml", "csv", "tsv"].includes(type);
// Local change: JSON and YAML have a tree (s), their code shown first.
export const treeKind = type => type === "json" || type === "yaml";
// Local change: shown as code (vim's normal mode, i to edit): text, and JSON or YAML unless the tree is asked for (s).
export const codeKind = (type, source) => type === "text" || (treeKind(type) && source);

export function target(value) {
  if (!value || typeof value.file !== "string" || !absolute(value.file)) return null;
  if (value.on != null && typeof value.on !== "string") return null;
  const file = normalize(value.file);
  // Local change: `rev`, a commit to read the file at (from git, read-only) instead of the disk.
  const rev = typeof value.rev === "string" && /^[0-9a-f]{7,64}$/.test(value.rev) ? value.rev : null;
  return { file, root: typeof value.root === "string" && absolute(value.root) ? normalize(value.root) : dirname(file), on: value.on || null, rev };
}

export function resolveLink(file, href) {
  const link = href.trim().replace(/\\([\\`*{}\[\]()#+.!_> -])/g, "$1");
  if (/^https?:\/\//i.test(link)) return { url: link };
  if (link.startsWith("//")) return { url: `https:${link}` };
  let anchor;
  if (link.includes("#")) {
    try { anchor = decodeURIComponent(link.slice(link.indexOf("#") + 1)); }
    catch { throw new Error("This link contains an invalid heading anchor."); }
  }
  if (!link || link.startsWith("#")) return { anchor: anchor || "" };
  if (/^[a-z][a-z\d+.-]*:/i.test(link) && !/^[a-z]:[\\/]/i.test(link) && !link.startsWith("file:///")) throw new Error("This link type cannot be opened here.");
  let path = link.replace(/[?#].*$/, "").replace(/^file:\/\//, "");
  try { path = decodeURIComponent(path); } catch { throw new Error("This link contains an invalid file path."); }
  return { file: join(dirname(file), path), ...(anchor !== undefined ? { anchor } : {}) };
}

export function imageSize(width, height, viewport, zoom) {
  const scale = zoom === null ? Math.min(Math.max(1, viewport.width - 32) / width, Math.max(1, viewport.height - 32) / height) : zoom;
  return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
}

// Local change: a path typed into the tree's filter (`~/…`, `/…`, `./…`, `../…`) instead of a name. Its folder (`~`
// is `homeDir`, `.` the tree's root) and the name begun in it, or null for a name filter. `.` and `..` at the end
// are folders. Without a known home (a remote machine not asked yet) `~` is a name.
export function typedPath(text, homeDir, root) {
  const t = text.trim();
  if (!/^(~(\/|$)|\/|\.\.?(\/|$))/.test(t) || (t.startsWith("~") && !homeDir)) return null;
  let abs = t.startsWith("~") ? homeDir + t.slice(1) : t.startsWith("/") ? t : `${root}/${t}`;
  if (t === "~" || /(^|\/)\.\.?$/.test(t)) abs += "/";
  const cut = abs.lastIndexOf("/");
  return { dir: normalize(abs.slice(0, cut + 1) || "/"), partial: abs.slice(cut + 1) };
}

// The folder's entries a typed name begins (any case), as a shell completes: hidden ones once it starts with a dot;
// the exact name first, then folders, then by name.
export function pathMatches(entries, partial) {
  const low = partial.toLowerCase(), dots = partial.startsWith(".");
  return entries.filter((e) => (dots || !e.name.startsWith(".")) && e.name.toLowerCase().startsWith(low))
    .sort((a, b) => Number(b.name.toLowerCase() === low) - Number(a.name.toLowerCase() === low) || Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

// What ⇥ puts in place of the typed name: the one match whole (a folder with its `/`), else the longest beginning
// they share; null when that adds nothing.
export function completion(matches, partial) {
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0].name + (matches[0].dir ? "/" : "");
  let common = matches[0].name;
  for (const m of matches) {
    let i = 0;
    while (i < common.length && i < m.name.length && common[i].toLowerCase() === m.name[i].toLowerCase()) i++;
    common = common.slice(0, i);
  }
  return common.length > partial.length ? common : null;
}
