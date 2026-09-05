import assert from "node:assert/strict";
import test from "node:test";
import { decryptPrivateText, encryptPrivateText, hashPassword, verifyPassword } from "../src/security.js";

test("password hashes are salted and verify without retaining plaintext", async () => {
  const first = await hashPassword("StrongPassword2026");
  const second = await hashPassword("StrongPassword2026");
  assert.notEqual(first, second);
  assert.equal(first.includes("StrongPassword2026"), false);
  assert.equal(await verifyPassword("StrongPassword2026", first), true);
  assert.equal(await verifyPassword("WrongPassword2026", first), false);
});

test("private text encryption round trips and uses randomized ciphertext", () => {
  const first = encryptPrivateText("Gate code is 4729");
  const second = encryptPrivateText("Gate code is 4729");
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.equal(decryptPrivateText(first), "Gate code is 4729");
  assert.equal(decryptPrivateText(null), null);
});

