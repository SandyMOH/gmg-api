const express = require("express");
const router = express.Router();
const { validatePassword, createSession, setSessionCookie, clearSessionCookie } = require("../lib/auth");
const { validateReviewerToken } = require("../lib/db");

// POST /api/auth/login — Password-based login
router.post("/login", (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password is required", ok: false });

    if (!validatePassword(password)) {
      return res.status(401).json({ error: "Invalid password", ok: false });
    }

    const sessionValue = createSession();
    setSessionCookie(res, sessionValue);

    return res.json({ message: "Login successful", ok: true });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Authentication failed", ok: false });
  }
});

// POST /api/auth/token — Token-based auto-login
router.post("/token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required", ok: false });

    const result = await validateReviewerToken(token);
    if (!result.valid) {
      return res.status(401).json({
        error: result.reason === "expired"
          ? "expired"
          : "invalid",
        reason: result.reason,
        submissionId: result.submissionId || null,
        ok: false
      });
    }

    const sessionValue = createSession();
    setSessionCookie(res, sessionValue);
    return res.json({ message: "Authenticated via token", submissionId: result.submissionId, ok: true });
  } catch (error) {
    console.error("Token auth error:", error);
    return res.status(500).json({ error: "Authentication failed", ok: false });
  }
});

// POST /api/auth/logout — Clear session
router.post("/logout", (req, res) => {
  try {
    clearSessionCookie(res);
    return res.json({ message: "Logged out", ok: true });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ error: "Logout failed", ok: false });
  }
});

module.exports = router;