// Module hooks for tests: "herdr", "gpui-kit" and "gpui-base" exist only inside Herdr. Each import of them gets
// a stub module exporting exactly the names that file imports (functions doing nothing), so any mod module can
// be loaded and linked in Node. Registered by mods-load.test.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLATFORM = new Set(["herdr", "gpui-kit", "gpui-base"]);

export async function resolve(specifier, context, next) {
  if (!PLATFORM.has(specifier)) return next(specifier, context);
  const parent = context.parentURL ? readFileSync(fileURLToPath(context.parentURL), "utf8") : "";
  const names = new Set();
  const re = new RegExp(`import \\{([^}]*)\\} from "${specifier}"`, "gs");
  for (const m of parent.matchAll(re)) for (const spec of m[1].split(",")) {
    const name = spec.trim().split(/\s+as\s+/)[0].trim();
    if (name) names.add(name);
  }
  return { url: `stub:${specifier}?${[...names].join(",")}`, shortCircuit: true };
}

export async function load(url, context, next) {
  if (!url.startsWith("stub:")) return next(url, context);
  const names = url.split("?")[1].split(",").filter(Boolean);
  const source = names.map((n) => `export const ${n} = function ${n}() {};`).join("\n");
  return { format: "module", source, shortCircuit: true };
}
