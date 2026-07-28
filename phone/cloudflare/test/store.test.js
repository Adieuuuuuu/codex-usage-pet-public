import assert from "node:assert/strict";
import test from "node:test";
import { publicationDecision } from "../src/store.js";

test("first publication claims an empty room", () => {
  assert.equal(publicationDecision(null, "hash-a", 1), "claim");
});

test("authentication is checked before sequence ordering", () => {
  const current = { authHash: "hash-a", sequence: 9 };
  assert.equal(
    publicationDecision(current, "wrong-hash", 10),
    "unauthorized",
  );
  assert.equal(publicationDecision(current, "hash-a", 9), "stale");
  assert.equal(publicationDecision(current, "hash-a", 8), "stale");
  assert.equal(publicationDecision(current, "hash-a", 10), "update");
});
