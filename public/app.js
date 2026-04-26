const DRIVER_UPDATE_INTERVAL_MS = 20000;

const DEFAULT_DESTINATION = {
  lat: -38.6893,
  lng: -62.2698
};

const params = new URLSearchParams(window.location.search);
const shipmentId = params.get("shipmentId");
const mode = params.get("mode") === "driver" ? "driver" : "viewer";

const destinationLatParam = Number(params.get("destinationLat"));
const destinationLngParam = Number(params.get("destinationLng"));
const destination = {
  lat: Number.isFinite(destinationLatParam) ? destinationLatParam : DEFAULT_DESTINATION.lat,
  lng: Number.isFinite(destinationLngParam) ? destinationLngParam : DEFAULT_DESTINATION.lng
};

const map = L.map("map", {
  zoomControl: true,
  minZoom: 5
}).setView([destination.lat, destination.lng], 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const destinationIcon = L.icon({
  iconUrl: "./assets/pin.png?v=1",
  iconSize: [24, 24],
  iconAnchor: [11, 11],
  popupAnchor: [0, -11]
});

const riderSelfIcon = L.icon({
  iconUrl: "./assets/tracking-icon.png",
  iconSize: [24, 24],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16]
});

const viewerSelfIcon = L.icon({
  iconUrl: "./assets/hombre.png",
  iconSize: [24, 24],
  iconAnchor: [12, 20],
  popupAnchor: [0, -18]
});

let destinationMarker = null;
let selfLocationMarker = null;
let riderTrackingMarker = null;
let socket = null;
let hasUserInteractedWithMap = false;
let lastDriverEmitAt = 0;
let latestDriverCoords = null;
let driverIntervalId = null;

const shipmentValue = document.getElementById("shipment-value");
const trackingStatus = document.getElementById("tracking-status");
const trackingTime = document.getElementById("tracking-time");

shipmentValue.textContent = shipmentId || "Sin shipmentId";

const mapContainer = map.getContainer();
mapContainer.addEventListener("pointerdown", () => {
  hasUserInteractedWithMap = true;
});
mapContainer.addEventListener(
  "wheel",
  () => {
    hasUserInteractedWithMap = true;
  },
  { passive: true }
);
mapContainer.addEventListener(
  "touchstart",
  () => {
    hasUserInteractedWithMap = true;
  },
  { passive: true }
);
map.on("dragstart zoomstart", () => {
  hasUserInteractedWithMap = true;
});

function centerMapIfAllowed(lat, lng, zoomLevel = 14) {
  if (hasUserInteractedWithMap) {
    return;
  }

  map.setView([lat, lng], Math.max(map.getZoom(), zoomLevel), {
    animate: true,
    duration: 0.6
  });
}

function clearAnyTrailLayer() {
  map.eachLayer((layer) => {
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      map.removeLayer(layer);
    }
  });
}

function initializeDestinationMarker() {
  destinationMarker = L.marker([destination.lat, destination.lng], { icon: destinationIcon }).addTo(map);
  destinationMarker.bindPopup(`Destino del paquete ${shipmentId || "SIN-ID"}`);
}

function upsertRiderTrackingMarker(lat, lng) {
  if (mode !== "viewer") {
    return;
  }

  if (!riderTrackingMarker) {
    riderTrackingMarker = L.marker([lat, lng], { icon: riderSelfIcon }).addTo(map);
    riderTrackingMarker.bindTooltip("Ubicacion del rider", { permanent: false });
    return;
  }

  riderTrackingMarker.setLatLng([lat, lng]);
}

function updateTrackingPanel(payload, customStatus) {
  if (!payload) {
    trackingStatus.textContent =
      customStatus ||
      (shipmentId
        ? "Esperando actualizaciones del paquete..."
        : "Agrega ?shipmentId=SHIP-001 para escuchar un paquete");
    trackingTime.textContent = "-";
    return;
  }

  trackingStatus.textContent = customStatus || "Recibiendo ubicacion en tiempo real";
  trackingTime.textContent = new Date(payload.timestamp).toLocaleString();
}

function emitDriverTracking() {
  if (mode !== "driver" || !socket || !socket.connected || !latestDriverCoords) {
    return;
  }

  const now = Date.now();
  if (lastDriverEmitAt && now - lastDriverEmitAt < DRIVER_UPDATE_INTERVAL_MS) {
    return;
  }

  socket.emit("tracking:driver", latestDriverCoords);
  lastDriverEmitAt = now;
}

function startDriverInterval() {
  if (mode !== "driver" || driverIntervalId) {
    return;
  }

  driverIntervalId = window.setInterval(() => {
    emitDriverTracking();
  }, DRIVER_UPDATE_INTERVAL_MS);
}

function stopDriverInterval() {
  if (!driverIntervalId) {
    return;
  }

  window.clearInterval(driverIntervalId);
  driverIntervalId = null;
}

function initializeTracking() {
  updateTrackingPanel(
    {
      lat: destination.lat,
      lng: destination.lng,
      timestamp: new Date().toISOString()
    },
    "Mostrando destino del paquete"
  );

  initializeDestinationMarker();

  const selfIcon = mode === "viewer" ? viewerSelfIcon : riderSelfIcon;
  selfLocationMarker = L.marker([destination.lat, destination.lng], { icon: selfIcon }).addTo(map);
  const selfLabel = mode === "driver" ? "Tu ubicacion actual (rider)" : "Tu ubicacion actual (viewer)";
  selfLocationMarker.bindTooltip(selfLabel, { permanent: false });

  if (!navigator.geolocation) {
    console.warn("Geolocation API is not available in this browser");
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy, speed } = position.coords;

      if (selfLocationMarker) {
        selfLocationMarker.setLatLng([latitude, longitude]);
      }

      if (mode === "driver") {
        centerMapIfAllowed(latitude, longitude);
      }

      latestDriverCoords = {
        lat: latitude,
        lng: longitude,
        accuracy,
        speedKmh: typeof speed === "number" ? Math.round(speed * 3.6 * 10) / 10 : null
      };

      emitDriverTracking();
    },
    (error) => {
      console.warn("Geolocation error", error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: DRIVER_UPDATE_INTERVAL_MS,
      timeout: 10000
    }
  );

  if (!shipmentId) {
    console.log("No shipmentId specified. Showing only your location.");
    return;
  }

  initializeSocketTracking(shipmentId);
  fetchLatestTracking(shipmentId);
}

function setupSocketListeners() {
  socket.on("connect", () => {
    console.log("Connected to realtime server", socket.id);
    startDriverInterval();
    emitDriverTracking();
  });

  socket.on("tracking:update", (payload) => {
    const { shipmentId: currentShipmentId, lat, lng, speedKmh, accuracy, timestamp } = payload;

    clearAnyTrailLayer();
    upsertRiderTrackingMarker(lat, lng);

    // Keep map pin fixed at destination; realtime updates are reflected in status only.
    updateTrackingPanel(
      { lat: destination.lat, lng: destination.lng, timestamp },
      `Destino fijo. Ultima senal del rider: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    );

    if (typeof speedKmh === "number") {
      console.log(`Tracking ${currentShipmentId}: ${speedKmh} km/h at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else if (typeof accuracy === "number") {
      console.log(`Tracking ${currentShipmentId}: GPS ±${Math.round(accuracy)} m`);
    }
  });

  socket.on("tracking:stopped", (payload) => {
    const stoppedShipmentId = payload?.shipmentId;
    if (stoppedShipmentId && stoppedShipmentId !== shipmentId) {
      return;
    }

    if (riderTrackingMarker) {
      map.removeLayer(riderTrackingMarker);
      riderTrackingMarker = null;
    }

    updateTrackingPanel(
      {
        lat: destination.lat,
        lng: destination.lng,
        timestamp: new Date().toISOString()
      },
      "Seguimiento detenido: driver desconectado"
    );
  });

  socket.on("disconnect", () => {
    stopDriverInterval();
    trackingStatus.textContent = "Conexion cerrada. Reintentando...";
  });
}

function initializeSocketTracking(currentShipmentId) {
  socket = io({
    query: {
      shipmentId: currentShipmentId,
      mode
    }
  });

  setupSocketListeners();
}

async function fetchLatestTracking(currentShipmentId) {
  try {
    const response = await fetch(`/api/tracking/${currentShipmentId}/latest`);

    if (!response.ok) {
      updateTrackingPanel(null, "Paquete sin ubicaciones todavia. Esperando primer dato...");
      return;
    }

    const result = await response.json();
    const latest = result?.data;
    if (!latest || typeof latest.lat !== "number" || typeof latest.lng !== "number") {
      return;
    }

    upsertRiderTrackingMarker(latest.lat, latest.lng);

    updateTrackingPanel(
      {
        lat: destination.lat,
        lng: destination.lng,
        timestamp: latest.timestamp || new Date().toISOString()
      },
      `Destino fijo. Ultima senal del rider: ${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}`
    );
  } catch (error) {
    console.error("Error validating shipment:", error);
    updateTrackingPanel(null, "No se pudo consultar la ultima ubicacion");
  }
}

clearAnyTrailLayer();
initializeTracking();
