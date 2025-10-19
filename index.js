const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;
const rateLimit = require("express-rate-limit");
const validator = require("validator");

const app = express();

// ---------------- CONFIG ----------------
const SECRET_TEXT = "ONLY_JAMES_KNOWS_THIS_PART";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SALT = "XyZ123!@#";
const DB_PATH = path.join(__dirname, "number.json"); // JSON database

// ---------------- MIDDLEWARE ----------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json()); // Parse JSON bodies

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    ok: false,
    error: "Too many requests please wait a minute before trying again.",
  },
});
app.use(limiter);

// ---------------- UTILITY ----------------
function md5(text) {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

// Convert index to 5-letter suffix
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

// Verify Android-style base64 hash
function verifyAndroidStyleBase64(encodedMessage, targetAmount) {
  const result = {
    ok: false,
    reason: null,
    amount: targetAmount,
    timeSeconds: null,
  };

  // 1) Decode base64
  let decoded;
  try {
    decoded = Buffer.from(encodedMessage, "base64").toString("utf8");
  } catch (err) {
    result.reason = "Invalid Base64 encoding";
    return result;
  }

  // 2) Split into 5 parts
  const parts = decoded.split(":");
  if (parts.length !== 5) {
    result.reason = `Decoded message must have 5 parts separated by ':' (got ${parts.length})`;
    return result;
  }

  const [, coinsHash, timestamp, randomString1, fullHash] = parts;

  // 3) Recompute full hash
  const mixed = `${timestamp}${coinsHash}${randomString1}${SALT}`;
  const recomputedFullHash = md5(mixed);
  if (recomputedFullHash !== fullHash) {
    result.reason = "Full-hash mismatch message integrity check failed";
    return result;
  }

  // 4) Brute-force 5-letter suffix
  const max = Math.pow(ALPHABET.length, 5);
  const start = Date.now();
  for (let i = 0; i < max; i++) {
    const suffix = idxToSuffix(i);
    const toHash = `The_coin_user:${targetAmount}:${SECRET_TEXT}${suffix}`;
    const recomputedCoinsHash = md5(toHash);
    if (recomputedCoinsHash === coinsHash) {
      const end = Date.now();
      result.ok = true;
      result.timeSeconds = (end - start) / 1000;
      return result;
    }
  }

  result.reason = `No coins hash match for amount ${targetAmount}`;
  result.timeSeconds = (Date.now() - start) / 1000;
  return result;
}

// Save submission to number.json
async function saveSubmission(data) {
  let submissions = [];
  try {
    const fileContent = await fs.readFile(DB_PATH, "utf8");
    submissions = JSON.parse(fileContent);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Error reading or parsing number.json:", error);
    }
  }
  submissions.push(data);
  await fs.writeFile(DB_PATH, JSON.stringify(submissions, null, 2), "utf8");
}

// ---------------- ENDPOINTS ----------------
app.post("/verify", async (req, res) => {
  const { free, value: valueParam, hash: hashParam, phoneNumber } = req.body;

  // === Validate phone number ===
  if (!phoneNumber || !validator.isMobilePhone(phoneNumber + "", "any")) {
    return res.status(400).json({
      ok: false,
      error: "Invalid or missing phone number.",
    });
  }

  try {
    let submissions = [];
    try {
      const fileContent = await fs.readFile(DB_PATH, "utf8");
      submissions = JSON.parse(fileContent);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const alreadyUsed = submissions.some(
      (entry) => entry.phoneNumber && entry.phoneNumber === phoneNumber
    );

    if (alreadyUsed) {
      return res.status(403).json({
        ok: false,
        error: "This phone number has already submitted once. Only one request allowed.",
      });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Could not check for duplicate submissions.",
      details: err.message,
    });
  }

  // === FREE MODE ===
  if (free === true) {
    try {
      await saveSubmission({
        phoneNumber,
        mode: "free",
        verified: true,
        timestamp: new Date().toISOString(),
      });

      return res.json({
        ok: true,
        message: "✅ Free Mode:\nPair Code: CODERXSA.",
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "Failed to save free submission.",
        details: err.message,
      });
    }
  }

  // === PAID MODE ===
  if (!valueParam || !hashParam) {
    return res.status(400).json({
      ok: false,
      error: "Missing value or hash in the request body (required in Paid Mode).",
    });
  }

  const amount = parseInt(valueParam, 10);
  if (Number.isNaN(amount)) {
    return res.status(400).json({ ok: false, error: "Invalid numeric value for 'value'." });
  }

  try {
    const verification = verifyAndroidStyleBase64(hashParam, amount);

    await saveSubmission({
      phoneNumber,
      mode: "paid",
      amount: verification.amount,
      hash: hashParam,
      md5: md5(hashParam),
      verified: verification.ok,
      reason: verification.reason,
      timestamp: new Date().toISOString(),
    });

    if (verification.ok) {
      return res.json({
        ok: true,
        message: "💰Paid Mode:\nPair Code: CODERXSA.",
        amount: verification.amount,
        timeSeconds: verification.timeSeconds,
      });
    } else {
      return res.status(400).json({
        ok: false,
        message: "Verification failed but attempt saved.",
        reason: verification.reason,
        timeSeconds: verification.timeSeconds,
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Internal error", details: err.message });
  }
});

// GET /submissions
app.get("/submissions", async (req, res) => {
  try {
    const fileContent = await fs.readFile(DB_PATH, "utf8");
    const submissions = JSON.parse(fileContent);
    return res.json({
      ok: true,
      count: submissions.length,
      data: submissions,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.json({
        ok: true,
        count: 0,
        data: [],
        message: "The submission database file does not exist yet.",
      });
    }
    console.error("Error reading submissions:", error);
    return res.status(500).json({
      ok: false,
      error: "Could not read submissions database.",
      details: error.message,
    });
  }
});

// Add this near your other endpoints (requires express.json() already enabled)
app.post("/admin/remove", async (req, res) => {
  const adminPass = req.header("x-admin-pass");
  const expected = process.env.ADMIN_PASSWORD || "$*R@#Fg@YGvbSA"; // set ADMIN_PASSWORD in env

  if (!adminPass || adminPass !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { phoneNumber } = req.body;
  if (!phoneNumber)
    return res.status(400).json({ ok: false, error: "phoneNumber required" });

  try {
    let submissions = [];
    try {
      const fileContent = await fs.readFile(DB_PATH, "utf8");
      submissions = JSON.parse(fileContent);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const filtered = submissions.filter(
      (entry) => entry.phoneNumber !== phoneNumber
    );
    await fs.writeFile(DB_PATH, JSON.stringify(filtered, null, 2), "utf8");

    return res.json({
      ok: true,
      message: "Removed successfully.",
      removedCount: submissions.length - filtered.length,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
