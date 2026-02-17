"use strict";

/**
 * server.js - Railway + MySQL (Railway) + Optional static site
 * CommonJS (require)
 */

require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mysql = require("mysql2/promise");
const { z } = require("zod");

const app = express();

/** -----------------------------
 *  Config
 * ------------------------------*/
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

/** -----------------------------
 *  Security / Middleware
 * ------------------------------*/
app.use(helmet());
app.use(cors({ origin: true })); // adjust later if you want to lock it down
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/** -----------------------------
 *  Static files (optional)
 *  If you create /public/index.html later, / will work.
 *  If you don't have it, / will return a helpful message instead of crashing.
 * ------------------------------*/
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  // If you haven't added public/index.html yet, show a friendly message.
  const indexPath = path.join(publicDir, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      res
        .status(200)
        .send(
          "API is running. No index.html found yet. Try GET /health or POST /api/signins."
        );
    }
  });
});

/** -----------------------------
 *  MySQL (Railway-first config)
 * ------------------------------*/
function buildDbConfig() {
  const host = process.env.MYSQLHOST || process.env.DB_HOST;
  const user = process.env.MYSQLUSER || process.env.DB_USER;
  const password = process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "";
  const database =
    process.env.MYSQLDATABASE || process.env.DB_NAME || "railway";
  const port = Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306);

  // If not configured, return null (app still runs)
  if (!host || !user || !database) return null;

  return { host, user, password, database, port };
}

let pool = null;

function getPool() {
  if (pool) return pool;

  const dbConfig = buildDbConfig();
  if (!dbConfig) return null;

  pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return pool;
}

async function ensureTable() {
  const p = getPool();
  if (!p) return;

  // Create table if missing (safe on Railway)
  const sql = `
    CREATE TABLE IF NOT EXISTS signins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      email VARCHAR(190) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await p.query(sql);
  } catch (e) {
    // Do not crash app if DB is temporarily unavailable
    console.error("DB table ensure failed (continuing):", e.message);
  }
}

/** -----------------------------
 *  Health check
 * ------------------------------*/
app.get("/health", async (req, res) => {
  const p = getPool();
  if (!p) {
    return res.json({ ok: true, db: "not_configured" });
  }

  try {
    await p.query("SELECT 1");
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false, db: "down", error: e.message });
  }
});

/** -----------------------------
 *  API: Create a signin
 * ------------------------------*/
const SigninSchema = z.object({
  full_name: z.string().min(1).max(120),
  phone: z.string().min(1).max(30),
  email: z.string().email().max(190),
});

app.post("/api/signins", async (req, res) => {
  const p = getPool();
  if (!p) return res.status(503).json({ ok: false, error: "DB not configured" });

  const parsed = SigninSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid input",
      details: parsed.error.flatten(),
    });
  }

  const { full_name, phone, email } = parsed.data;

  try {
    const [result] = await p.execute(
      "INSERT INTO signins (full_name, phone, email) VALUES (?, ?, ?)",
      [full_name, phone, email]
    );

    return res.status(201).json({ ok: true, id: result.insertId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/** -----------------------------
 *  API: List recent signins
 * ------------------------------*/
app.get("/api/signins", async (req, res) => {
  const p = getPool();
  if (!p) return res.status(503).json({ ok: false, error: "DB not configured" });

  try {
    const [rows] = await p.query(
      "SELECT id, full_name, phone, email, created_at FROM signins ORDER BY created_at DESC LIMIT 50"
    );
    return res.json({ ok: true, rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/** -----------------------------
 *  Start server
 * ------------------------------*/
app.listen(PORT, HOST, async () => {
  console.log(`API running on http://${HOST}:${PORT}`);
  await ensureTable();
});
