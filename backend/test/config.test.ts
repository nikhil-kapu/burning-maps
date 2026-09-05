import assert from "node:assert/strict";
import test from "node:test";
import { getConfig, resetConfigForTests } from "../src/config.js";

test("production refuses to boot with development secrets or simulated providers", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  resetConfigForTests();
  try {
    assert.throws(
      () => getConfig(),
      (error: unknown) => error instanceof Error
        && /Production configuration is incomplete/.test(error.message)
        && /AI route-brief interpreter/.test(error.message)
        && /Vapi voice/.test(error.message)
        && /Twilio SMS/.test(error.message),
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    resetConfigForTests();
  }
});
