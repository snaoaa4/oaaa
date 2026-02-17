require("dotenv").config();

/**
 * server.js — Public Sign-In App (Name, Phone, Email) + MySQL
 * Works locally + Railway
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
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

// Railway-provided MySQL vars OR local .env vars
const dbConfig = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
  user: process.env.MYSQLUSER || process.env.DB_USER || "root",
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || "signin_db",
  waitForConnections: true,
  connectionLimit: 10,
};

// Helpful log (does NOT print password)
console.log("DB:", {
  host: dbConfig.host,
  port: String(dbConfig.port),
  user: dbConfig.user,
  name: dbConfig.database,
});

/** -----------------------------
 *  MySQL pool
 * ------------------------------*/
const pool = mysql.createPool(dbConfig);

/** -----------------------------
 *  Security + middleware
 * ------------------------------*/
app.use(
  helmet({
    // allow your simple inline assets if needed; keep default otherwise
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/** -----------------------------
 *  Public routes
 * ------------------------------*/
app.get("/health", async (req, res) => {
  // Optional: also test DB connectivity quickly
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, db: "down", error: e.message });
  }
});

// Serve your static site from /public
app.use(express.static(path.join(__dirname, "public")));

// Home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/** -----------------------------
 *  API
 * ------------------------------*/
const SigninSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(190),
});

app.post("/api/signins", async (req, res) => {
  const parsed = SigninSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid input",
      details: parsed.error.flatten(),
    });
  }

  const { full_name, phone, email } = parsed.data;

  try {
    const sql =
      "INSERT INTO signins (full_name, phone, email) VALUES (?, ?, ?)";
    const [result] = await pool.execute(sql, [full_name, phone, email]);

    return res.status(201).json({
      ok: true,
      id: result.insertId,
    });
  } catch (e) {
    console.error("INSERT ERROR:", e);
    return res.status(500).json({ ok: false, error: "DB insert failed" });
  }
});

// Optional: view recent signins (handy for testing)
app.get("/api/signins", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, phone, email, created_at FROM signins ORDER BY created_at DESC LIMIT 50"
    );
    return res.json({ ok: true, rows });
  } catch (e) {
    console.error("SELECT ERROR:", e);
    return res.status(500).json({ ok: false, error: "DB read failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on http://0.0.0.0:${PORT}`);
});

