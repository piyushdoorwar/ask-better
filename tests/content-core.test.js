"use strict";
// Unit tests for the pure helpers in content/core.js (the shared injection
// engine). The DOM-bound parts (button, preview card, writing into ProseMirror
// / Quill editors) need a real browser and are not covered here.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load");

// Just enough of `document` for buildDiffFragment: it only creates spans and a
// fragment and sets className / textContent on them.
function fakeDocument() {
  const node = (tag) => ({
    tag,
    className: "",
    textContent: "",
    children: [],
    appendChild(child) { this.children.push(child); return child; }
  });
  return {
    createElement: (tag) => node(tag),
    createDocumentFragment: () => node("#fragment"),
    createTextNode: (text) => ({ tag: "#text", className: "", textContent: text, children: [] })
  };
}

const { exports: core } = loadScripts(["content/core.js"], {
  expose: ["tokenizeForDiff", "buildDiffFragment", "formatUsage", "clamp", "normalizeOffset", "normalizeEditorText", "isImeEvent", "DIFF_MAX_CELLS"],
  globals: { document: fakeDocument(), window: {} }
});

// Flattens a fragment into [{kind, text}] where kind is add / del / same.
function runs(fragment) {
  return fragment.children.map((child) => ({
    kind: /pf-diff-add/.test(child.className) ? "add" : /pf-diff-del/.test(child.className) ? "del" : "same",
    text: child.textContent
  }));
}

// Whitespace is deliberately never marked add/del (it renders as shared text),
// so each side is compared with whitespace collapsed.
function joined(fragment, keep) {
  return runs(fragment).filter((r) => keep.includes(r.kind)).map((r) => r.text).join("").replace(/\s+/g, " ").trim();
}

test("tokenizeForDiff keeps whitespace as its own tokens and round-trips", () => {
  const text = "Hello  world,\nnew line";
  const tokens = core.tokenizeForDiff(text);
  assert.equal(tokens.join(""), text);
  assert.ok(tokens.some((t) => /^\s+$/.test(t)), "whitespace tokens are kept");
});

test("buildDiffFragment: identical text has no additions or deletions", () => {
  const frag = core.buildDiffFragment("same words here", "same words here");
  assert.ok(runs(frag).every((r) => r.kind === "same"));
  assert.equal(joined(frag, ["same"]), "same words here");
  assert.equal(runs(frag).map((r) => r.text).join(""), "same words here", "identical text is reproduced exactly");
});

test("buildDiffFragment: old text = same+del, new text = same+add", () => {
  const original = "Please write a short email to the team";
  const revised = "Please draft a concise email to the whole team";
  const frag = core.buildDiffFragment(original, revised);
  assert.equal(joined(frag, ["same", "del"]), original);
  assert.equal(joined(frag, ["same", "add"]), revised);
  assert.ok(runs(frag).some((r) => r.kind === "add" && /draft/.test(r.text)));
  assert.ok(runs(frag).some((r) => r.kind === "del" && /write/.test(r.text)));
});

test("buildDiffFragment: whitespace-only runs are never flagged", () => {
  const frag = core.buildDiffFragment("a b c", "a  b\nc");
  for (const r of runs(frag)) {
    if (r.kind !== "same") assert.ok(/\S/.test(r.text), `whitespace flagged as ${r.kind}: ${JSON.stringify(r.text)}`);
  }
});

test("buildDiffFragment: empty sides", () => {
  assert.equal(joined(core.buildDiffFragment("", "brand new"), ["same", "add"]), "brand new");
  assert.equal(joined(core.buildDiffFragment("all gone", ""), ["same", "del"]), "all gone");
});

test("buildDiffFragment: huge inputs take the cheap whole-block path quickly", () => {
  const words = (prefix, n) => Array.from({ length: n }, (_v, i) => `${prefix}${i}`).join(" ");
  const original = `start ${words("a", 3000)} end`;
  const revised = `start ${words("b", 3000)} end`;
  const t0 = Date.now();
  const frag = core.buildDiffFragment(original, revised);
  assert.ok(Date.now() - t0 < 1000, "should not run a 6k x 6k LCS");
  assert.equal(joined(frag, ["same", "del"]), original);
  assert.equal(joined(frag, ["same", "add"]), revised);
});

test("formatUsage", () => {
  assert.equal(core.formatUsage(null), "");
  assert.equal(core.formatUsage({}), "");
  assert.equal(core.formatUsage({ totalTokens: 1500, costUsd: 0.0421 }), "This request: ≈ 1,500 tokens · ≈ $0.0421");
  assert.equal(core.formatUsage({ totalTokens: 15, costUsd: 0.000001 }), "This request: ≈ 15 tokens · ≈ <$0.01");
  assert.equal(core.formatUsage({ totalTokens: 900000, costUsd: 3.5 }), "This request: ≈ 900,000 tokens · ≈ $3.50");
  assert.equal(core.formatUsage({ totalTokens: 0, costUsd: null }), "", "nothing known → no footer");
});

test("clamp and normalizeOffset survive garbage", () => {
  assert.equal(core.clamp(5, 0, 10), 5);
  assert.equal(core.clamp(-5, 0, 10), 0);
  assert.equal(core.clamp(50, 0, 10), 10);
  const offset = core.normalizeOffset({ x: "nope", y: NaN });
  assert.ok(Number.isFinite(offset.x) && Number.isFinite(offset.y));
  assert.deepEqual(core.normalizeOffset(undefined), core.normalizeOffset({}));
});

test("normalizeEditorText collapses whitespace and nbsp", () => {
  assert.equal(core.normalizeEditorText("  a  b\n\nc  "), "a b c");
});

test("isImeEvent", () => {
  assert.equal(core.isImeEvent({ isComposing: true }), true);
  assert.equal(core.isImeEvent({ keyCode: 229 }), true);
  assert.equal(core.isImeEvent({ key: "Enter", keyCode: 13, isComposing: false }), false);
});
