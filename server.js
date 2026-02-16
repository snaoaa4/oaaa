const express = require("express");
const path = require("path");

const app = express();   // ✅ app must be created BEFORE app.get/app.use

// ✅ Health route AFTER app is defined
app.get("/health", (req, res) => res.json({ ok: true }));

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve your form page (adjust folder if yours is "views" instead of "public")
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ... your /api/signins route etc ...

// ✅ listen on Railway port
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => console.log("Listening on", PORT));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const pool = require("./db");

const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  return res.redirect("/login");
});

app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, password, full_name, invite_code } = req.body;

    if (!invite_code || !email || !password) {
      return res.render("register", { error: "Invite code, email, and password are required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const code = invite_code.trim();

    await conn.beginTransaction();

    const [codes] = await conn.execute(
      `SELECT code, is_active, max_uses, uses, expires_at
       FROM invite_codes
       WHERE code = ?
       FOR UPDATE`,
      [code]
    );

    if (!codes.length) {
      await conn.rollback();
      return res.render("register", { error: "Invalid invite code." });
    }

    const c = codes[0];

    if (!c.is_active) {
      await conn.rollback();
      return res.render("register", { error: "This invite code is inactive." });
    }

    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      await conn.rollback();
      return res.render("register", { error: "This invite code has expired." });
    }

    if (c.uses >= c.max_uses) {
      await conn.rollback();
      return res.render("register", { error: "This invite code has already been used." });
    }

    const [existing] = await conn.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );

    if (existing.length) {
      await conn.rollback();
      return res.render("register", { error: "That email is already registered." });
    }

    const hash = await bcrypt.hash(password, 12);

    const [result] = await conn.execute(
      "INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)",
      [normalizedEmail, hash, full_name || null]
    );

    await conn.execute("UPDATE invite_codes SET uses = uses + 1 WHERE code = ?", [code]);

    await conn.commit();

    req.session.userId = result.insertId;
    return res.redirect("/dashboard");
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error(err);
    return res.render("register", { error: "Registration failed. Try again." });
  } finally {
    conn.release();
  }
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render("login", { error: "Email and password are required." });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [rows] = await pool.execute(
      "SELECT id, password_hash FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );

    if (!rows.length) return res.render("login", { error: "Invalid email or password." });

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.render("login", { error: "Invalid email or password." });

    req.session.userId = rows[0].id;
    return res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    return res.render("login", { error: "Login failed. Try again." });
  }
});

app.get("/dashboard", requireLogin, (req, res) => {
  res.render("dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`);
});
