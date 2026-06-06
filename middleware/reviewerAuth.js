const { SESSION_COOKIE, verifySession } = require("../lib/auth");

// Protect routes that require reviewer login
function requireReviewer(req, res, next) {
  const sessionCookie = req.cookies?.[SESSION_COOKIE];
  const session = verifySession(sessionCookie);

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.reviewer = session;
  next();
}

module.exports = { requireReviewer };
