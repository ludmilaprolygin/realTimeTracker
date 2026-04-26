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

app.get("/api/docs", (_req, res) => {
  res.json({
    name: "Real-time Tracking API",
    version: "1.0.0",
    baseUrl: "http://localhost:3000",
    description: "Microservice for real-time package tracking with WebSocket support",
    endpoints: [
      {
        path: "/",
        method: "GET",
        description: "Web UI for tracking visualization",
        params: {
          shipmentId: {
            type: "string",
            required: false,
            default: "SHIP-001",
            example: "SHIP-001"
          },
          mode: {
            type: "string",
            required: false,
            default: "viewer",
            values: ["viewer", "driver"],
            description: "viewer = read-only tracking, driver = share GPS location"
          }
        },
        examples: [
          "http://localhost:3000/?shipmentId=SHIP-001&mode=viewer",
          "http://localhost:3000/?shipmentId=SHIP-001&mode=driver"
        ]
      },
      {
        path: "/health",
        method: "GET",
        description: "Check service status",
        response: { ok: true, ts: "2026-04-25T17:40:00.000Z" }
      },
      {
        path: "/api/docs",
        method: "GET",
        description: "Get API specification (this endpoint)"
      },
      {
        path: "/api/tracking/update",
        method: "POST",
        description: "Publish courier location update",
        authentication: "Optional API key via x-tracking-key header if TRACKING_API_KEY env var is set",
        headers: {
          "Content-Type": "application/json",
          "x-tracking-key": "(optional) Your API key if required"
        },
        body: {
          shipmentId: {
            type: "string",
            required: true,
            example: "SHIP-001"
          },
          lat: {
            type: "number",
            required: true,
            example: -38.6893
          },
          lng: {
            type: "number",
            required: true,
            example: -62.2698
          },
          accuracy: {
            type: "number",
            required: false,
            example: 12,
            description: "GPS accuracy in meters"
          },
          speedKmh: {
            type: "number",
            required: false,
            example: 24.5
          },
          timestamp: {
            type: "string",
            required: false,
            format: "ISO 8601",
            example: "2026-04-25T17:40:00.000Z"
          }
        },
        response: { ok: true }
      },
      {
        path: "/api/tracking/:shipmentId/latest",
        method: "GET",
        description: "Get last known position for a shipment",
        params: {
          shipmentId: {
            type: "string",
            required: true,
            example: "SHIP-001"
          }
        },
        response: {
          ok: true,
          data: {
            shipmentId: "SHIP-001",
            lat: -38.6893,
            lng: -62.2698,
            accuracy: 12,
            speedKmh: 24.5,
            timestamp: "2026-04-25T17:40:00.000Z"
          }
        }
      },
      {
        path: "/api/tracking/:shipmentId",
        method: "DELETE",
        description: "Remove shipment tracking data (cleanup after delivery)",
        params: {
          shipmentId: {
            type: "string",
            required: true,
            example: "SHIP-001"
          }
        },
        response: { ok: true, deleted: true }
      }
    ],
    websocket: {
      description: "Real-time tracking via Socket.IO",
      url: "ws://localhost:3000",
      query: {
        shipmentId: "string (default: SHIP-001)",
        mode: "string (default: viewer)"
      },
      events: {
        connect: "Client connects to tracking channel for shipmentId",
        "tracking:update": "Broadcasted when new location is published",
        "tracking:driver": "(driver mode) Emit GPS coordinates from browser"
      }
    },
    environment: {
      PORT: "Server port (default: 3000)",
      TRACKING_API_KEY: "(optional) Require API key for /api/tracking/update POST"
    }
  });
});

const ROOM_PREFIX = "shipment:";
const trackedShipments = new Map();
const driverSocketsByShipment = new Map();

// Note: No default data. Shipments are created only via POST /api/tracking/update

function publishTrackingUpdate(payload) {
  const shipmentId = String(payload.shipmentId || "");
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

function addDriverSocket(shipmentId, socketId) {
  if (!driverSocketsByShipment.has(shipmentId)) {
    driverSocketsByShipment.set(shipmentId, new Set());
  }

  driverSocketsByShipment.get(shipmentId).add(socketId);
}

function removeDriverSocket(shipmentId, socketId) {
  const socketSet = driverSocketsByShipment.get(shipmentId);
  if (!socketSet) {
    return false;
  }

  socketSet.delete(socketId);

  if (socketSet.size === 0) {
    driverSocketsByShipment.delete(shipmentId);
    return true;
  }

  return false;
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

app.delete("/api/tracking/:shipmentId", (req, res) => {
  const shipmentId = String(req.params.shipmentId || "");
  if (!shipmentId) {
    return res.status(400).json({ ok: false, error: "shipmentId is required" });
  }

  const existed = trackedShipments.has(shipmentId);
  trackedShipments.delete(shipmentId);

  return res.json({ ok: true, deleted: existed });
});

io.on("connection", (socket) => {
  const shipmentId = String(socket.handshake.query.shipmentId || "");
  const socketMode = socket.handshake.query.mode === "driver" ? "driver" : "viewer";
  const room = `${ROOM_PREFIX}${shipmentId}`;

  if (!shipmentId) {
    socket.emit("error", { message: "shipmentId query parameter is required" });
    socket.disconnect();
    return;
  }

  socket.join(room);

  if (socketMode === "driver") {
    addDriverSocket(shipmentId, socket.id);
  }

  const lastKnown = trackedShipments.get(shipmentId);
  if (lastKnown) {
    socket.emit("tracking:update", lastKnown);
  }

  socket.on("tracking:driver", ({ lat, lng, accuracy, speedKmh }) => {
    if (socketMode !== "driver") {
      return;
    }

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

  socket.on("disconnect", () => {
    if (socketMode !== "driver") {
      return;
    }

    const hasNoDrivers = removeDriverSocket(shipmentId, socket.id);
    if (!hasNoDrivers) {
      return;
    }

    trackedShipments.delete(shipmentId);
    io.to(room).emit("tracking:stopped", {
      shipmentId,
      reason: "driver_offline",
      timestamp: new Date().toISOString()
    });
  });
});

// Stateless: no automatic simulation. Updates only via external POST /api/tracking/update

server.listen(PORT, () => {
  console.log(`Realtime tracking server listening on http://localhost:${PORT}`);
});
