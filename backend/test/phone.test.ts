import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsPhone, usPhoneE164Schema } from "../src/phone.js";

test("US phone input is normalized to E.164 without requiring +1", () => {
  assert.equal(normalizeUsPhone("4155551234"), "+14155551234");
  assert.equal(normalizeUsPhone("(415) 555-1234"), "+14155551234");
  assert.equal(normalizeUsPhone("+1 415 555 1234"), "+14155551234");
});

test("phone validation accepts US numbers and rejects international numbers", () => {
  assert.equal(usPhoneE164Schema.parse("4155551234"), "+14155551234");
  assert.throws(() => usPhoneE164Schema.parse("+442079460958"));
  assert.throws(() => usPhoneE164Schema.parse("415555123"));
});
