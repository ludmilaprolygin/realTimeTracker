const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const TRACKING_API_KEY = process.env.TRACKING_API_KEY || "";

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-tracking-key");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Route around Bahia Blanca (UNS area) to simulate a moving truck.
const route = [
  [-38.6893, -62.2698],
  [-38.6890, -62.2688],
  [-38.6886, -62.2679],
  [-38.6882, -62.2670],
  [-38.6878, -62.2661],
  [-38.6874, -62.2652],
  [-38.6871, -62.2643],
  [-38.6873, -62.2635],
  [-38.6878, -62.2629],
  [-38.6884, -62.2627],
  [-38.6890, -62.2629],
  [-38.6895, -62.2634],
  [-38.6899, -62.2641],
  [-38.6902, -62.2650],
  [-38.6904, -62.2659],
  [-38.6904, -62.2669],
  [-38.6902, -62.2678],
  [-38.6899, -62.2686],
  [-38.6896, -62.2693]
];

let routeIndex = 0;
const ROOM_PREFIX = "shipment:";
const trackedShipments = new Map();

function randomSpeedKmH() {
  return Math.round((28 + Math.random() * 22) * 10) / 10;
}

function simulatedTrackingPayload(shipmentId = "SHIP-001") {
  const [lat, lng] = route[routeIndex];
  return {
    shipmentId,
    lat,
    lng,
    speedKmh: randomSpeedKmH(),
    timestamp: new Date().toISOString()
  };
}

function publishTrackingUpdate(payload) {
  const shipmentId = String(payload.shipmentId || "SHIP-001");
  const room = `${ROOM_PREFIX}${shipmentId}`;

  trackedShipments.set(shipmentId, payload);
  io.to(room).emit("tracking:update", payload);
}

function canWriteTracking(req) {
  if (!TRACKING_API_KEY) {
    return true;
  }

  return req.header("x-tracking-key") === TRACKING_API_KEY;
}

app.post("/api/tracking/update", (req, res) => {
  if (!canWriteTracking(req)) {
    return res.status(401).json({ ok: false, error: "Invalid tracking key" });
  }

  const { shipmentId, lat, lng, accuracy, speedKmh, timestamp } = req.body || {};
  if (
    typeof shipmentId !== "string" ||
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    return res.status(400).json({
      ok: false,
      error: "shipmentId (string), lat (number), lng (number) are required"
    });
  }

  const payload = {
    shipmentId,
    lat,
    lng,
    accuracy: typeof accuracy === "number" ? accuracy : null,
    speedKmh: typeof speedKmh === "number" ? speedKmh : null,
    timestamp: typeof timestamp === "string" ? timestamp : new Date().toISOString()
  };

  publishTrackingUpdate(payload);
  return res.json({ ok: true });
});

app.get("/api/tracking/:shipmentId/latest", (req, res) => {
  const shipmentId = String(req.params.shipmentId || "");
  if (!shipmentId) {
    return res.status(400).json({ ok: false, error: "shipmentId is required" });
  }

  const latest = trackedShipments.get(shipmentId);
  if (!latest) {
    return res.status(404).json({ ok: false, error: "No tracking for shipment" });
  }

  return res.json({ ok: true, data: latest });
});

io.on("connection", (socket) => {
  const shipmentId = String(socket.handshake.query.shipmentId || "SHIP-001");
  const room = `${ROOM_PREFIX}${shipmentId}`;

  socket.join(room);

  const lastKnown = trackedShipments.get(shipmentId);
  socket.emit("tracking:update", lastKnown || simulatedTrackingPayload(shipmentId));

  socket.on("tracking:driver", ({ lat, lng, accuracy, speedKmh }) => {
    if (typeof lat !== "number" || typeof lng !== "number") {
      return;
    }

    const payload = {
      shipmentId,
      lat,
      lng,
      accuracy: typeof accuracy === "number" ? accuracy : null,
      speedKmh: typeof speedKmh === "number" ? speedKmh : null,
      timestamp: new Date().toISOString()
    };

    publishTrackingUpdate(payload);
  });
});

setInterval(() => {
  routeIndex = (routeIndex + 1) % route.length;

  // Demo fallback only for SHIP-001 when no driver GPS is being shared.
  if (!trackedShipments.has("SHIP-001")) {
    io.to(`${ROOM_PREFIX}SHIP-001`).emit("tracking:update", simulatedTrackingPayload("SHIP-001"));
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Realtime tracking server listening on http://localhost:${PORT}`);
});
