// index.js (CommonJS)
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;

const app = express();

// ---------------- CONFIG ----------------
const SECRET_TEXT = "ONLY_JAMES_KNOWS_THIS_PART";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SALT = "XyZ123!@#";
const DB_PATH = path.join(__dirname, "number.json"); // JSON database

// ---------------- MIDDLEWARE ----------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json()); // Parse JSON bodies

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
    //foundSuffix: null,
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

  // parts: [something, coins_hash, timestamp, randomString1, full_hash]
  const [, coinsHash, timestamp, randomString1, fullHash] = parts;

  // 3) Recompute full hash
  const mixed = `${timestamp}${coinsHash}${randomString1}${SALT}`;
  const recomputedFullHash = md5(mixed);
  if (recomputedFullHash !== fullHash) {
    result.reason = "Full-hash mismatch — message integrity check failed";
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
      //result.foundSuffix = suffix;
      result.timeSeconds = (end - start) / 1000;
      return result;
    }
  }

  // Not found
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

// POST /verify
app.post("/verify", async (req, res) => {
  const { value: valueParam, hash: hashParam, phoneNumber } = req.body;

  if (!valueParam || !hashParam || !phoneNumber) {
    return res.status(400).json({
      ok: false,
      error: "Missing value, hash, or phoneNumber in the request body.",
    });
  }

  const amount = parseInt(valueParam, 10);
  if (Number.isNaN(amount)) {
    return res.status(400).json({ ok: false, error: "Invalid numeric value for 'value'." });
  }

  try {
    const verification = verifyAndroidStyleBase64(hashParam, amount);

    // Save attempt
    await saveSubmission({
      phoneNumber,
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
        message: "Wait 1min Enter Pair CODE: CODERXSA ",
        amount: verification.amount,
        //suffix: verification.foundSuffix,
        timeSeconds: verification.timeSeconds,
      });
    } else {
      return res.status(400).json({
        ok: false,
        message: "Verification failed but the attempt was saved.",
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

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
