const crypto = require("crypto");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set and at least 32 chars");
}
if (!process.env.REVIEWER_PASSWORD) {
  throw new Error("REVIEWER_PASSWORD must be set");
}

const SESSION_COOKIE = "reviewer_session";

function signToken(data) {
  const secret = process.env.SESSION_SECRET;
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  try {
    const secret = process.env.SESSION_SECRET;
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payload, sig] = parts;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString());

    // Session expiry — tokens don't live forever
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    if (!data.loginAt || Date.now() - data.loginAt > MAX_AGE_MS) return null;

    return data;
  } catch {
    return null;
  }
}

function createSession() {
  return signToken({ role: "reviewer", loginAt: Date.now() });
}

function verifySession(cookieValue) {
  if (!cookieValue) return null;
  const data = verifyToken(cookieValue);
  if (!data || data.role !== "reviewer") return null;
  return data;
}

function validatePassword(password) {
  const input = Buffer.from(String(password));
  const expected = Buffer.from(process.env.REVIEWER_PASSWORD);
  if (input.length !== expected.length) return false;
  return crypto.timingSafeEqual(input, expected);
}

function setSessionCookie(res, sessionValue) {
  res.cookie(SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

module.exports = {
  SESSION_COOKIE,
  createSession,
  verifySession,
  validatePassword,
  setSessionCookie,
  clearSessionCookie,
};
