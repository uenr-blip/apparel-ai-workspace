import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCompiledStyles } from "./check-build-styles.mjs";

const complete = ":root{--paper:#fff}.app-frame{color:inherit}.flex{display:flex}.grid{display:grid}.hidden{display:none}.min-h-screen{min-height:100vh}.w-full{width:100%}@media(min-width:48rem){.md\\:flex{display:flex}.md\\:hidden{display:none}}";
test("rejects successful CSS responses containing uncompiled Tailwind", () => {
  assert.throws(() => assertCompiledStyles(["@theme default{--color:red}@tailwind utilities;", ".app-frame{color:red}"]), /Uncompiled/);
});
test("rejects a stylesheet that lost responsive layout utilities", () => {
  assert.throws(() => assertCompiledStyles([complete.replace(".md\\:flex{display:flex}", "")]), /Required layout utility/);
});
test("accepts compiled split stylesheets without counting comments as directives", () => {
  const result = assertCompiledStyles(["/* @theme in a comment */", complete]);
  assert.equal(result.requiredLayoutUtilities, 7);
});
