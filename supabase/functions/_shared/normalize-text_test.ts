import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normalizeText, matchKeyword } from "./normalize-text.ts";

Deno.test("normalizeText - removes accents", () => {
  assertEquals(normalizeText("anúncio"), "anuncio");
});

Deno.test("normalizeText - uppercase to lowercase", () => {
  assertEquals(normalizeText("ANÚNCIO"), "anuncio");
});

Deno.test("normalizeText - collapses spaces and trims", () => {
  assertEquals(normalizeText("  Olá   mundo "), "ola mundo");
});

Deno.test("normalizeText - preserves punctuation", () => {
  assertEquals(normalizeText("AnÚncio   !!!"), "anuncio !!!");
});

Deno.test("matchKeyword - contains with ignore ON", () => {
  const r = matchKeyword("Olá, vim pelo anÚncio do site", "anuncio", "contains", true);
  assertEquals(r.matched, true);
  assertEquals(r.normalizationApplied, true);
});

Deno.test("matchKeyword - contains with ignore OFF fails on accent diff", () => {
  const r = matchKeyword("anúncio", "anuncio", "contains", false);
  assertEquals(r.matched, false);
  assertEquals(r.normalizationApplied, false);
});

Deno.test("matchKeyword - equals with ignore ON", () => {
  const r = matchKeyword("ANÚNCIO", "anuncio", "equals", true);
  assertEquals(r.matched, true);
});

Deno.test("matchKeyword - starts_with with ignore ON", () => {
  const r = matchKeyword("Anúncio do Facebook", "anuncio", "starts_with", true);
  assertEquals(r.matched, true);
});

Deno.test("matchKeyword - regex uses raw text when ignore OFF", () => {
  const r = matchKeyword("anúncio", "anun[cç]io", "regex", false);
  assertEquals(r.matched, true); // regex handles it via character class
});

Deno.test("matchKeyword - regex with ignore ON normalizes first", () => {
  const r = matchKeyword("ANÚNCIO", "anuncio", "regex", true);
  assertEquals(r.matched, true);
  assertEquals(r.normalizationApplied, true);
});
