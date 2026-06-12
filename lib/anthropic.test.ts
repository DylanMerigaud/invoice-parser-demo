import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "./anthropic";

/**
 * Tests for the defensive JSON extraction. Structured outputs should return
 * clean JSON, but this is the safety net for a model that wraps it in prose or
 * code fences — so a stray ``` never crashes the parse.
 */

test("parses clean JSON directly", () => {
  assert.deepEqual(extractJsonObject('{"a":1,"b":"x"}'), { a: 1, b: "x" });
});

test("parses JSON with surrounding whitespace", () => {
  assert.deepEqual(extractJsonObject('  \n {"a":1}\n '), { a: 1 });
});

test("unwraps a ```json fenced block", () => {
  const text = 'Here you go:\n```json\n{"a":1}\n```\nthanks';
  assert.deepEqual(extractJsonObject(text), { a: 1 });
});

test("unwraps a bare ``` fenced block (no language)", () => {
  assert.deepEqual(extractJsonObject("```\n{\"a\":1}\n```"), { a: 1 });
});

test("slices a JSON object out of surrounding prose", () => {
  const text = 'The invoice data is {"vendor":"Acme","total":10} — done.';
  assert.deepEqual(extractJsonObject(text), { vendor: "Acme", total: 10 });
});

test("handles nested objects when slicing", () => {
  const text = 'result: {"a":{"b":2},"c":[1,2]} end';
  assert.deepEqual(extractJsonObject(text), { a: { b: 2 }, c: [1, 2] });
});

test("returns undefined when there's no JSON at all", () => {
  assert.equal(extractJsonObject("no json here"), undefined);
  assert.equal(extractJsonObject(""), undefined);
});

test("returns undefined for malformed JSON-ish text", () => {
  assert.equal(extractJsonObject("{ this is not valid }"), undefined);
});
