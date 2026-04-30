const path = require("path");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
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
const TRACKING_JWT_SECRET = process.env.TRACKING_JWT_SECRET || "";
const TRACKING_TOKEN_ISSUER_KEY = process.env.TRACKING_TOKEN_ISSUER_KEY || "";
const TRACKING_TOKEN_DEFAULT_TTL = process.env.TRACKING_TOKEN_DEFAULT_TTL || "15m";

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,x-tracking-key,x-issuer-key"
  );

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
    version: "1.2.0",
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
          },
          accessToken: {
            type: "string",
            required: false,
            description: "JWT required when TRACKING_JWT_SECRET is enabled"
          }
        },
        examples: [
          "http://localhost:3000/?shipmentId=SHIP-001&mode=viewer",
          "http://localhost:3000/?shipmentId=SHIP-001&mode=viewer&accessToken=<jwt>",
          "http://localhost:3000/?shipmentId=SHIP-001&mode=driver&accessToken=<jwt>"
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
        path: "/api/auth/tracking-token",
        method: "POST",
        description: "Issue short-lived JWT for shipment tracking",
        authentication:
          "Required header x-issuer-key must match TRACKING_TOKEN_ISSUER_KEY",
        headers: {
          "Content-Type": "application/json",
          "x-issuer-key": "Required issuer key"
        },
        body: {
          userId: {
            type: "string",
            required: true,
            example: "user-42"
          },
          shipmentId: {
            type: "string",
            required: false,
            example: "SHIP-001"
          },
          shipmentIds: {
            type: "string[]",
            required: false,
            example: ["SHIP-001", "SHIP-ABC"]
          },
          allShipments: {
            type: "boolean",
            required: false,
            example: false
          },
          role: {
            type: "string",
            required: false,
            values: ["viewer", "driver", "admin"],
            default: "viewer"
          },
          expiresIn: {
            type: "string",
            required: false,
            default: "15m",
            example: "10m"
          }
        },
        response: {
          ok: true,
          token: "<jwt>",
          expiresIn: "15m"
        }
      },
      {
        path: "/api/tracking/update",
        method: "POST",
        description: "Publish courier location update",
        authentication:
          "Optional API key via x-tracking-key header if TRACKING_API_KEY env var is set",
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
        authentication:
          "If TRACKING_JWT_SECRET is set, send JWT using Authorization: Bearer <token> or accessToken query",
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
        authentication:
          "If TRACKING_JWT_SECRET is set, send JWT using Authorization: Bearer <token> or accessToken query",
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
        mode: "string (default: viewer)",
        accessToken: "string (optional JWT)"
      },
      events: {
        connect: "Client connects to tracking channel for shipmentId",
        "tracking:update": "Broadcasted when new location is published",
        "tracking:driver": "(driver mode) Emit GPS coordinates from browser",
        "tracking:forbidden": "Emitted when shipment token is missing or invalid"
      }
    },
    environment: {
      PORT: "Server port (default: 3000)",
      TRACKING_API_KEY: "(optional) Require API key for /api/tracking/update POST",
      TRACKING_JWT_SECRET:
        "(optional) If set, read tracking access requires JWT with shipment permissions",
      TRACKING_TOKEN_ISSUER_KEY:
        "(optional, recommended) Secret key required to call /api/auth/tracking-token",
      TRACKING_TOKEN_DEFAULT_TTL:
        "(optional) Default token expiration used by /api/auth/tracking-token (default: 15m)"
    }
  });
});

const ROOM_PREFIX = "shipment:";
const trackedShipments = new Map();
const driverSocketsByShipment = new Map();

// Note: No default data. Shipments are created only via POST /api/tracking/update

function getBearerTokenFromHeader(authorizationHeader) {
  const rawHeader = String(authorizationHeader || "").trim();
  if (!rawHeader) {
    return "";
  }

  const [scheme, token] = rawHeader.split(" ");
  if (String(scheme || "").toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
}

function getHttpAccessToken(req) {
  return String(
    getBearerTokenFromHeader(req.header("authorization")) || req.query.accessToken || ""
  ).trim();
}

function getSocketAccessToken(socket) {
  return String(
    socket.handshake.auth?.token || socket.handshake.query.accessToken || ""
  ).trim();
}

function verifyAccessToken(rawToken) {
  if (!TRACKING_JWT_SECRET) {
    return { ok: true, claims: null };
  }

  if (!rawToken) {
    return { ok: false, error: "Missing JWT access token" };
  }

  try {
    const claims = jwt.verify(rawToken, TRACKING_JWT_SECRET, {
      algorithms: ["HS256"]
    });

    return { ok: true, claims };
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return { ok: false, error: "JWT expired" };
    }

    return { ok: false, error: "Invalid JWT token" };
  }
}

function getAllowedShipmentIds(claims) {
  const allowed = new Set();
  if (!claims || typeof claims !== "object") {
    return allowed;
  }

  if (claims.allShipments === true) {
    allowed.add("*");
  }

  if (typeof claims.shipmentId === "string" && claims.shipmentId.trim()) {
    allowed.add(claims.shipmentId.trim());
  }

  const shipmentIdLists = [claims.shipments, claims.shipmentIds];
  shipmentIdLists.forEach((candidate) => {
    if (!Array.isArray(candidate)) {
      return;
    }

    candidate.forEach((id) => {
      const normalized = String(id || "").trim();
      if (normalized) {
        allowed.add(normalized);
      }
    });
  });

  return allowed;
}

function authorizeShipmentAccess(shipmentIds, rawToken) {
  const verification = verifyAccessToken(rawToken);
  if (!verification.ok) {
    return { ok: false, error: verification.error, deniedShipmentIds: shipmentIds };
  }

  if (!TRACKING_JWT_SECRET) {
    return { ok: true, claims: null, deniedShipmentIds: [] };
  }

  const allowedIds = getAllowedShipmentIds(verification.claims);
  const deniedShipmentIds = shipmentIds.filter(
    (id) => !allowedIds.has("*") && !allowedIds.has(id)
  );

  if (deniedShipmentIds.length > 0) {
    return {
      ok: false,
      error: "Forbidden: JWT does not include permission for requested shipment",
      deniedShipmentIds
    };
  }

  return { ok: true, claims: verification.claims, deniedShipmentIds: [] };
}

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

function parseShipmentIds(rawShipmentIds, fallbackShipmentId = "") {
  const ids = String(rawShipmentIds || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length > 0) {
    return [...new Set(ids)];
  }

  return fallbackShipmentId ? [fallbackShipmentId] : [];
}

function normalizeRequestedShipments(shipmentId, shipmentIds) {
  const normalizedIds = [];

  if (typeof shipmentId === "string" && shipmentId.trim()) {
    normalizedIds.push(shipmentId.trim());
  }

  if (Array.isArray(shipmentIds)) {
    shipmentIds.forEach((id) => {
      const normalized = String(id || "").trim();
      if (normalized) {
        normalizedIds.push(normalized);
      }
    });
  }

  return [...new Set(normalizedIds)];
}

function canIssueTrackingToken(req) {
  if (!TRACKING_TOKEN_ISSUER_KEY) {
    return false;
  }

  return String(req.header("x-issuer-key") || "").trim() === TRACKING_TOKEN_ISSUER_KEY;
}

function buildTrackingTokenPayload(body) {
  const userId = String(body?.userId || body?.sub || "").trim();
  const role = String(body?.role || "viewer").trim() || "viewer";
  const allowedShipments = normalizeRequestedShipments(body?.shipmentId, body?.shipmentIds);
  const allShipments = body?.allShipments === true;

  return {
    userId,
    role,
    allowedShipments,
    allShipments
  };
}

app.post("/api/auth/tracking-token", (req, res) => {
  if (!TRACKING_JWT_SECRET) {
    return res.status(503).json({
      ok: false,
      error: "TRACKING_JWT_SECRET is not configured"
    });
  }

  if (!TRACKING_TOKEN_ISSUER_KEY) {
    return res.status(503).json({
      ok: false,
      error: "TRACKING_TOKEN_ISSUER_KEY is not configured"
    });
  }

  if (!canIssueTrackingToken(req)) {
    return res.status(401).json({ ok: false, error: "Invalid issuer key" });
  }

  const payload = buildTrackingTokenPayload(req.body || {});
  if (!payload.userId) {
    return res.status(400).json({ ok: false, error: "userId is required" });
  }

  if (!payload.allShipments && payload.allowedShipments.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "shipmentId or shipmentIds is required when allShipments is false"
    });
  }

  const expiresIn = String(req.body?.expiresIn || TRACKING_TOKEN_DEFAULT_TTL).trim();
  const jwtPayload = {
    sub: payload.userId,
    role: payload.role,
    shipmentIds: payload.allowedShipments,
    allShipments: payload.allShipments
  };

  const token = jwt.sign(jwtPayload, TRACKING_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn
  });

  return res.json({
    ok: true,
    token,
    expiresIn,
    claims: jwtPayload
  });
});

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

  const authorization = authorizeShipmentAccess([shipmentId], getHttpAccessToken(req));
  if (!authorization.ok) {
    return res
      .status(403)
      .json({ ok: false, error: authorization.error, shipmentIds: authorization.deniedShipmentIds });
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

  const authorization = authorizeShipmentAccess([shipmentId], getHttpAccessToken(req));
  if (!authorization.ok) {
    return res
      .status(403)
      .json({ ok: false, error: authorization.error, shipmentIds: authorization.deniedShipmentIds });
  }

  const existed = trackedShipments.has(shipmentId);
  trackedShipments.delete(shipmentId);

  return res.json({ ok: true, deleted: existed });
});

io.on("connection", (socket) => {
  const shipmentId = String(socket.handshake.query.shipmentId || "");
  const socketMode = socket.handshake.query.mode === "driver" ? "driver" : "viewer";
  const shipmentIds = socketMode === "driver"
    ? parseShipmentIds(socket.handshake.query.shipmentIds, shipmentId)
    : parseShipmentIds(shipmentId);

  if (shipmentIds.length === 0) {
    socket.emit("error", { message: "shipmentId (or shipmentIds for driver mode) is required" });
    socket.disconnect();
    return;
  }

  const authorization = authorizeShipmentAccess(shipmentIds, getSocketAccessToken(socket));
  if (!authorization.ok) {
    socket.emit("tracking:forbidden", {
      message: authorization.error,
      shipmentIds: authorization.deniedShipmentIds
    });
    socket.disconnect(true);
    return;
  }

  shipmentIds.forEach((id) => {
    socket.join(`${ROOM_PREFIX}${id}`);
  });

  if (socketMode === "driver") {
    shipmentIds.forEach((id) => {
      addDriverSocket(id, socket.id);
    });
  }

  shipmentIds.forEach((id) => {
    const lastKnown = trackedShipments.get(id);
    if (lastKnown) {
      socket.emit("tracking:update", lastKnown);
    }
  });

  socket.on("tracking:driver", ({ shipmentId: targetShipmentId, lat, lng, accuracy, speedKmh }) => {
    if (socketMode !== "driver") {
      return;
    }

    if (typeof lat !== "number" || typeof lng !== "number") {
      return;
    }

    const shipmentToUpdate = String(targetShipmentId || shipmentIds[0] || "");
    if (!shipmentToUpdate || !shipmentIds.includes(shipmentToUpdate)) {
      return;
    }

    const payload = {
      shipmentId: shipmentToUpdate,
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

    shipmentIds.forEach((id) => {
      const hasNoDrivers = removeDriverSocket(id, socket.id);
      if (!hasNoDrivers) {
        return;
      }

      trackedShipments.delete(id);
      io.to(`${ROOM_PREFIX}${id}`).emit("tracking:stopped", {
        shipmentId: id,
        reason: "driver_offline",
        timestamp: new Date().toISOString()
      });
    });
  });
});

// Stateless: no automatic simulation. Updates only via external POST /api/tracking/update

server.listen(PORT, () => {
  console.log(`Realtime tracking server listening on http://localhost:${PORT}`);
});