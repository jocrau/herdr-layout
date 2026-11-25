// The status bar's offer to resume Claude sessions a restart lost (mods/usage-status/resume.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { resumeOffer } = await import("../../mods/usage-status/resume.js");

const rows = [{ session: "b2", title: "Fix the login form", where: "Web / 1" }, { session: "a1", title: "", where: "API / 2" }];

test("nothing lost: no offer", () => {
  assert.equal(resumeOffer([], null), null);
  assert.equal(resumeOffer(null, null), null);
});

test("lost sessions: one offer naming them", () => {
  const o = resumeOffer(rows, null);
  assert.equal(o.title, "2 Claude sessions lost in a restart");
  assert.match(o.body, /Fix the login form\nAPI \/ 2/);
  assert.equal(o.sig, "a1 b2");
});

test("the same set again (a layout reload): no second offer; a new set: offered", () => {
  assert.equal(resumeOffer(rows, "a1 b2"), null);
  assert.notEqual(resumeOffer([rows[0]], "a1 b2"), null);
});
