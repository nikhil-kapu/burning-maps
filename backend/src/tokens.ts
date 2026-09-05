import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "./config.js";

const issuer = "turtle-buddy-api";
const audience = "turtle-buddy-mobile";

function key(): Uint8Array {
  return new TextEncoder().encode(getConfig().ACCESS_TOKEN_SECRET);
}

export type AccessClaims = {
  userId: string;
  sessionId: string;
};

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(), { issuer, audience, algorithms: ["HS256"] });
  if (!payload.sub || typeof payload.sid !== "string") throw new Error("Access token is missing required claims.");
  return { userId: payload.sub, sessionId: payload.sid };
}

