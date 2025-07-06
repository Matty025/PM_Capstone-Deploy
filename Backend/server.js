  require("dotenv").config();
  console.log("Loaded JWT_SECRET:", process.env.JWT_SECRET); // ← Add this line
  const express = require("express");
  const cors = require("cors");
  const { Pool } = require("pg");
  const jwt = require("jsonwebtoken");
  const mqtt = require("mqtt");
  const { InfluxDB, Point } = require("@influxdata/influxdb-client");

  const app = express();
  const port = process.env.PORT || 3001;

  // ─────────── InfluxDB Setup ───────────
  const influxUrl = process.env.INFLUX_URL || "https://us-east-1-1.aws.cloud2.influxdata.com";
  const influxToken = process.env.INFLUX_TOKEN;
  const influxOrg = process.env.INFLUX_ORG || "26f21ef7f4355d0d"; // ✅ Your actual org
  const influxBucket = process.env.INFLUX_BUCKET || "MotorcycleOBDData";

  if (!influxUrl || !influxToken || !influxOrg || !influxBucket) {
    console.error("❌ Missing one or more InfluxDB environment variables");
    process.exit(1);
  }


  const influxDB = new InfluxDB({ url: influxUrl, token: influxToken });
  const writeApi = influxDB.getWriteApi(influxOrg, influxBucket, "ms");
// ─────────── Middleware ───────────
const allowedOrigins = [
  "http://localhost:3000",
  "https://pm-machinelearning.onrender.com",
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
  app.use(express.json());

  // ─────────── PostgreSQL Setup ───────────
  // ─────────── PostgreSQL Setup ───────────
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10), // ✅ Ensure it's a number
    ssl: {
      rejectUnauthorized: false, // ✅ For Render-hosted PostgreSQL with SSL
    },
  });


  // Check DB connection
  pool.query("SELECT NOW()", (err) => {
    if (err) {
      console.error("❌ Database connection error:", err.stack);
    } else {
      console.log("✅ Connected to PostgreSQL database");
    }
  });

  // ─────────── JWT Middleware ───────────
  function authenticateToken(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: "Invalid token" });
      req.user = user;
      next();
    });
  }

  // ─────────── Auth Routes ───────────
  app.post("/signup-personal", async (req, res) => {
    try {
      const { fullName, email, phone, password } = req.body;

      if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ error: "All fields are required" });
      }

      // Split full name into first and last (optional but nice to have)
      const [firstName, ...rest] = fullName.trim().split(" ");
      const lastName = rest.join(" ");

      const result = await pool.query(
        "INSERT INTO users (first_name, last_name, email, phone, password) VALUES ($1, $2, $3, $4, $5) RETURNING id, email",
        [firstName, lastName, email, phone, password]
      );

      res.status(201).json({
        message: "✅ User registered successfully!",
        user: result.rows[0],
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(400).json({ error: "Email already exists." });
      }

      console.error("🔥 Signup-personal error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });



  app.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log("Client login request:", email, password);

      const result = await pool.query("SELECT id, email, password FROM users WHERE email = $1", [email]);

      if (result.rows.length === 0) {
        console.log("❌ Email not found in DB");
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const user = result.rows[0];
      console.log("DB password:", user.password);
      console.log("Entered password:", password);

      if (password.trim() !== user.password.trim()) {
        console.log("❌ Password does not match");
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
      res.json({ token, userId: user.id, email: user.email });
    } catch (error) {
      console.error("🔥 Login Error:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });


  app.get("/get-user", authenticateToken, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT first_name, last_name, email, phone FROM users WHERE id = $1",
        [req.user.userId]
      );
      if (rows.length === 0) return res.status(404).json({ error: "User not found" });
      res.json({ user: rows[0] });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ─────────── Motorcycle Routes ───────────
  app.post("/signup-motorcycle", async (req, res) => {
    try {
      const { user_id, brand, model, year, plateNumber, odometer_km, last_oil_change } = req.body;

      const result = await pool.query(
        `INSERT INTO motorcycles 
          (user_id, brand, model, year, plate_number, odometer_km, last_oil_change) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING *`,
        [user_id, brand, model, year, plateNumber, odometer_km || 0, last_oil_change || null]
      );

      res.status(201).json({
        message: "✅ Motorcycle registered successfully!",
        motorcycle: result.rows[0],
      });
    } catch (error) {
      console.error("🔥 Motorcycle Signup Error:", error);
      if (error.code === "23505") {
        return res.status(400).json({ error: "Plate number already exists!" });
      }
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.get("/get-motorcycles", authenticateToken, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM motorcycles WHERE user_id = $1", [req.user.userId]);
      res.json({ motorcycles: rows });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ─────────── Oil Change Routes ───────────
  app.get("/oil-history", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, odometer_at_change, date_of_oil_change, created_at
        FROM oil_change_history WHERE motorcycle_id = $1
        ORDER BY date_of_oil_change DESC`,
        [req.query.motorcycle_id]
      );
      res.json(rows);
    } catch (err) {
      console.error("Oil history error:", err);
      res.status(500).json({ error: "Failed to retrieve oil history" });
    }
  });

  app.post("/oil-change", async (req, res) => {
    const { motorcycle_id, odometer_km, date_of_oil_change } = req.body;
    if (!motorcycle_id || !odometer_km) {
      return res.status(400).json({ error: "motorcycle_id and odometer_km required" });
    }

    try {
      await pool.query(
        `INSERT INTO oil_change_history (motorcycle_id, odometer_at_change, date_of_oil_change, created_at)
        VALUES ($1, $2, $3, NOW())`,
        [motorcycle_id, odometer_km, date_of_oil_change]
      );
      res.status(201).json({ message: "Odometer logged successfully" });
    } catch (err) {
      console.error("Oil change save error:", err);
      res.status(500).json({ error: "Failed to log odometer" });
    }
  });

  // ─────────── MQTT Setup (via wss) ───────────
  const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "wss://test.mosquitto.org:8081";
  const mqttClient = mqtt.connect(MQTT_BROKER_URL);

  mqttClient.on("connect", () => {
    console.log("🔌 Connected to MQTT broker:", MQTT_BROKER_URL);
    mqttClient.subscribe("obd/data", (err) => {
      if (err) console.error("❌ MQTT subscription error:", err);
      else console.log("✅ Subscribed to topic: obd/data");
    });
  });

  mqttClient.on("error", (error) => {
    console.error("❌ MQTT Client Error:", error);
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log(`📩 MQTT message received on topic "${topic}":`, payload);

      const motorcycleId = payload.motorcycle_id || "unknown";
      const data = payload.data || {};

      const point = new Point("obd_data").tag("motorcycle_id", motorcycleId);
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "number") point.floatField(key.toLowerCase(), value);
      }

      writeApi.writePoint(point);
      writeApi.flush()
        .then(() => console.log("[InfluxDB] Data written"))
        .catch((err) => console.error("[InfluxDB] Write error:", err));
    } catch (e) {
      console.error("MQTT processing error:", e);
    }
  });

  // ─────────── Start Server ───────────
  app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
  });
