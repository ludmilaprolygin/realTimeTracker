const DRIVER_UPDATE_INTERVAL_MS = 20000;

const DEFAULT_DESTINATION = {
  lat: -38.6893,
  lng: -62.2698
};

const params = new URLSearchParams(window.location.search);
const shipmentId = params.get("shipmentId");
const mode = params.get("mode") === "driver" ? "driver" : "viewer";
const shipmentIds = mode === "driver"
  ? String(params.get("shipmentIds") || shipmentId || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  : shipmentId
    ? [shipmentId]
    : [];

function parseOptionalNumber(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return NaN;
  }

  const normalized = String(rawValue).trim();
  if (!normalized) {
    return NaN;
  }

  return Number(normalized);
}

function parseNumberList(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((value) => {
      const normalized = value.trim();
      return normalized ? Number(normalized) : NaN;
    })
    .filter((value) => Number.isFinite(value));
}

function sanitizeCoordinates(lat, lng, fallback) {
  const safeLat = Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : fallback.lat;
  const safeLng = Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : fallback.lng;
  return { lat: safeLat, lng: safeLng };
}

const destinationLatsParam = parseNumberList(params.get("destinationLats"));
const destinationLngsParam = parseNumberList(params.get("destinationLngs"));
const destinationLatParam = parseOptionalNumber(params.get("destinationLat"));
const destinationLngParam = parseOptionalNumber(params.get("destinationLng"));

const fallbackLat = Number.isFinite(destinationLatParam)
  ? destinationLatParam
  : destinationLatsParam[0];
const fallbackLng = Number.isFinite(destinationLngParam)
  ? destinationLngParam
  : destinationLngsParam[0];

const fallbackDestination = sanitizeCoordinates(
  Number.isFinite(fallbackLat) ? fallbackLat : DEFAULT_DESTINATION.lat,
  Number.isFinite(fallbackLng) ? fallbackLng : DEFAULT_DESTINATION.lng,
  DEFAULT_DESTINATION
);

const hasExplicitDestinationCoordinates =
  (Number.isFinite(destinationLatParam) && Number.isFinite(destinationLngParam)) ||
  (destinationLatsParam.length > 0 && destinationLatsParam.length === destinationLngsParam.length);

function buildDestinationByShipment(ids) {
  const destinationMap = new Map();
  const latList = destinationLatsParam;
  const lngList = destinationLngsParam;

  if (latList.length > 0 && latList.length === lngList.length && ids.length > 0) {
    ids.forEach((id, index) => {
      const lat = Number.isFinite(latList[index]) ? latList[index] : fallbackDestination.lat;
      const lng = Number.isFinite(lngList[index]) ? lngList[index] : fallbackDestination.lng;
      destinationMap.set(id, sanitizeCoordinates(lat, lng, fallbackDestination));
    });
  }

  ids.forEach((id) => {
    if (!destinationMap.has(id)) {
      destinationMap.set(id, fallbackDestination);
    }
  });

  if (ids.length === 0) {
    destinationMap.set("DEFAULT", fallbackDestination);
  }

  return destinationMap;
}

const destinationByShipment = buildDestinationByShipment(shipmentIds);
const primaryShipmentId = shipmentIds[0] || shipmentId || "DEFAULT";
const primaryDestination = destinationByShipment.get(primaryShipmentId) || fallbackDestination;

function getDestinationForShipment(currentShipmentId) {
  return destinationByShipment.get(currentShipmentId) || primaryDestination;
}

const map = L.map("map", {
  zoomControl: true,
  minZoom: 5
}).setView([primaryDestination.lat, primaryDestination.lng], 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const destinationIcon = L.icon({
  iconUrl: "./assets/Google_pin.png?v=1",
  iconSize: [17, 24],
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
  iconUrl: "./assets/current.png",
  iconSize: [24, 24],
  iconAnchor: [12, 20],
  popupAnchor: [0, -18]
});

const destinationMarkersByShipment = new Map();
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

function setTrackingStatus(text) {
  if (trackingStatus) {
    trackingStatus.textContent = text;
  }
}

shipmentValue.textContent = shipmentIds.length > 0 ? shipmentIds.join(", ") : "Sin shipmentId";

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

function initializeDestinationMarkers() {
  if (!hasExplicitDestinationCoordinates) {
    return;
  }

  const idsToRender = shipmentIds.length > 0 ? shipmentIds : ["DEFAULT"];

  idsToRender.forEach((id) => {
    const destination = getDestinationForShipment(id);
    const marker = L.marker([destination.lat, destination.lng], { icon: destinationIcon }).addTo(map);
    const popupLabel = id === "DEFAULT" ? "Destino del paquete" : `Destino del paquete ${id}`;
    marker.bindPopup(popupLabel);
    destinationMarkersByShipment.set(id, marker);
  });

  if (mode === "driver" && idsToRender.length > 1 && !hasUserInteractedWithMap) {
    const bounds = L.latLngBounds(
      idsToRender.map((id) => {
        const destination = getDestinationForShipment(id);
        return [destination.lat, destination.lng];
      })
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 14
      });
    }
  }
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
    setTrackingStatus(
      customStatus ||
      (shipmentId
        ? "Esperando actualizaciones del paquete..."
        : "Agrega ?shipmentId=SHIP-001 para escuchar un paquete")
    );
    trackingTime.textContent = "-";
    return;
  }

  setTrackingStatus(customStatus || "Recibiendo ubicacion en tiempo real");
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

  shipmentIds.forEach((id) => {
    socket.emit("tracking:driver", {
      shipmentId: id,
      ...latestDriverCoords
    });
  });
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
  const initialStatus = hasExplicitDestinationCoordinates
    ? shipmentIds.length > 1
      ? "Mostrando destinos fijos de los pedidos"
      : "Mostrando destino del paquete"
    : mode === "driver"
      ? "Mostrando tu ubicacion del driver"
      : "Mostrando tu ubicacion del viewer";

  updateTrackingPanel(
    {
      lat: primaryDestination.lat,
      lng: primaryDestination.lng,
      timestamp: new Date().toISOString()
    },
    initialStatus
  );

  initializeDestinationMarkers();

  const selfIcon = mode === "viewer" ? viewerSelfIcon : riderSelfIcon;
  selfLocationMarker = L.marker([primaryDestination.lat, primaryDestination.lng], { icon: selfIcon }).addTo(map);
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

  if (shipmentIds.length === 0) {
    console.log("No shipmentId specified. Showing only your location.");
    return;
  }

  initializeSocketTracking(shipmentIds);
  shipmentIds.forEach((id) => {
    fetchLatestTracking(id);
  });
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
      { lat: primaryDestination.lat, lng: primaryDestination.lng, timestamp },
      `Destino fijo (${currentShipmentId}). Ultima senal del rider: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    );

    if (typeof speedKmh === "number") {
      console.log(`Tracking ${currentShipmentId}: ${speedKmh} km/h at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else if (typeof accuracy === "number") {
      console.log(`Tracking ${currentShipmentId}: GPS ±${Math.round(accuracy)} m`);
    }
  });

  socket.on("tracking:stopped", (payload) => {
    const stoppedShipmentId = String(payload?.shipmentId || "");
    if (stoppedShipmentId && !shipmentIds.includes(stoppedShipmentId)) {
      return;
    }

    if (riderTrackingMarker) {
      map.removeLayer(riderTrackingMarker);
      riderTrackingMarker = null;
    }

    updateTrackingPanel(
      {
        lat: primaryDestination.lat,
        lng: primaryDestination.lng,
        timestamp: new Date().toISOString()
      },
      `Seguimiento detenido: driver desconectado${stoppedShipmentId ? ` (${stoppedShipmentId})` : ""}`
    );
  });

  socket.on("disconnect", () => {
    stopDriverInterval();
    setTrackingStatus("Conexion cerrada. Reintentando...");
  });
}

function initializeSocketTracking(currentShipmentIds) {
  socket = io({
    query: {
      shipmentId: currentShipmentIds[0],
      shipmentIds: currentShipmentIds.join(","),
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
        lat: primaryDestination.lat,
        lng: primaryDestination.lng,
        timestamp: latest.timestamp || new Date().toISOString()
      },
      hasExplicitDestinationCoordinates
        ? `Destino fijo (${currentShipmentId}). Ultima senal del rider: ${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}`
        : `Ubicacion en tiempo real (${currentShipmentId}). Ultima senal del rider: ${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}`
    );
  } catch (error) {
    console.error("Error validating shipment:", error);
    updateTrackingPanel(null, "No se pudo consultar la ultima ubicacion");
  }
}

clearAnyTrailLayer();
initializeTracking();
