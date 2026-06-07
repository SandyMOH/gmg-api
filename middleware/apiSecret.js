const crypto = require("crypto");

function requireApiSecret(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    console.error("API_SECRET is not set");
    return res.status(500).json({ error: "Server misconfiguration", ok: false });
  }

  const provided = req.headers["x-api-secret"];
  if (!provided) {
    return res.status(401).json({ error: "Unauthorized", ok: false });
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized", ok: false });
  }

  next();
}

module.exports = { requireApiSecret };
