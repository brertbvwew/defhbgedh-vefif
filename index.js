// index.js (CommonJS)
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();

// Configuration / secret values (keep SECRET_TEXT private)
const SECRET_TEXT = "ONLY_JAMES_KNOWS_THIS_PART";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SALT = "XyZ123!@#";

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Utility: md5
function md5(text) {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

// Convert an integer (0 .. 26^5 - 1) to a 5-letter string from ALPHABET
function idxToSuffix(idx) {
  const base = ALPHABET.length;
  let n = idx;
  let chars = [];
  for (let i = 0; i < 5; i++) {
    chars.push(ALPHABET[n % base]);
    n = Math.floor(n / base);
  }
  return chars.reverse().join("");
}

// Core verification function
function verifyAndroidStyleBase64(encodedMessage, targetAmount) {
  const result = {
    ok: false,
    reason: null,
    amount: targetAmount,
    foundSuffix: null,
    timeSeconds: null,
  };

  // 1) decode base64
  let decoded;
  try {
    decoded = Buffer.from(encodedMessage, "base64").toString("utf8");
  } catch (err) {
    result.reason = "Invalid Base64 encoding";
    return result;
  }

  // 2) split into parts
  const parts = decoded.split(":");
  if (parts.length !== 5) {
    result.reason = `Decoded message must have 5 parts separated by ':' (got ${parts.length})`;
    return result;
  }

  // parts: [something, coins_hash, timestamp, randomString1, full_hash]
  const [, coinsHash, timestamp, randomString1, fullHash] = parts;

  // 3) recompute full hash: md5(timestamp + coins_hash + randomString1 + SALT)
  const mixed = `${timestamp}${coinsHash}${randomString1}${SALT}`;
  const recomputedFullHash = md5(mixed);
  if (recomputedFullHash !== fullHash) {
    result.reason = "Full-hash mismatch — message integrity check failed";
    return result;
  }

  // 4) brute force 5-letter suffix to check coinsHash corresponds to the given amount
  const max = Math.pow(ALPHABET.length, 5);
  const start = Date.now();

  for (let i = 0; i < max; i++) {
    const suffix = idxToSuffix(i);
    const toHash = `The_coin_user:${targetAmount}:${SECRET_TEXT}${suffix}`;
    const recomputedCoinsHash = md5(toHash);
    if (recomputedCoinsHash === coinsHash) {
      const end = Date.now();
      result.ok = true;
      result.foundSuffix = suffix;
      result.timeSeconds = (end - start) / 1000;
      return result;
    }
  }

  // not found
  result.reason = `No coins hash match for amount ${targetAmount}`;
  result.timeSeconds = (Date.now() - start) / 1000;
  return result;
}

// Endpoint: GET /verify?value=<amount>&hash=<base64>
app.get("/verify", (req, res) => {
  const valueParam = req.query.value;
  const hashParam = req.query.hash;

  if (!valueParam || !hashParam) {
    return res.status(400).json({
      ok: false,
      error: "Missing query parameters. Use ?value=<amount>&hash=<base64_string>",
    });
  }

  const amount = parseInt(valueParam, 10);
  if (Number.isNaN(amount)) {
    return res.status(400).json({ ok: false, error: "Invalid numeric value for 'value'." });
  }

  try {
    const verification = verifyAndroidStyleBase64(hashParam, amount);
    if (verification.ok) {
      return res.json({
        ok: true,
        message: "Verification succeeded",
        amount: verification.amount,
        suffix: verification.foundSuffix,
        timeSeconds: verification.timeSeconds,
      });
    } else {
      return res.status(400).json({
        ok: false,
        message: "Verification failed",
        reason: verification.reason,
        timeSeconds: verification.timeSeconds,
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Internal error", details: err.message });
  }
});


// Start server (Render sets PORT automatically)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
