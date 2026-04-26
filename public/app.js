const map = L.map("map", {
  zoomControl: true,
  minZoom: 5
}).setView([-38.6893, -62.2698], 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const trackingIcon = L.icon({  iconUrl: "./assets/tracking-icon.png",
  iconSize: [24, 24],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16]
});

const viewerIcon = L.icon({
  iconUrl: "./assets/pin.png?v=1",
  iconSize: [24, 24],
  iconAnchor: [11, 11],
  popupAnchor: [0, -11]
});

let marker = null;
let viewerMarker = null;
let hasCenteredOnTracking = false;
let hasUserInteractedWithMap = false;

const params = new URLSearchParams(window.location.search);
const shipmentId = params.get("shipmentId");
const mode = params.get("mode") === "driver" ? "driver" : "viewer";

let socket = null;

const shipmentValue = document.getElementById("shipment-value");
const trackingStatus = document.getElementById("tracking-status");
const trackingLat = document.getElementById("tracking-lat");
const trackingLng = document.getElementById("tracking-lng");
const trackingTime = document.getElementById("tracking-time");

shipmentValue.textContent = shipmentId || "Sin shipmentId";

const mapContainer = map.getContainer();
mapContainer.addEventListener("pointerdown", () => {
  hasUserInteractedWithMap = true;
});
mapContainer.addEventListener("wheel", () => {
  hasUserInteractedWithMap = true;
}, { passive: true });
mapContainer.addEventListener("touchstart", () => {
  hasUserInteractedWithMap = true;
}, { passive: true });

function updateTrackingPanel(payload) {
  if (!payload) {
    trackingStatus.textContent = shipmentId
      ? "Esperando actualizaciones del paquete..."
      : "Agrega ?shipmentId=SHIP-001 para escuchar un paquete";
    trackingLat.textContent = "-";
    trackingLng.textContent = "-";
    trackingTime.textContent = "-";
    return;
  }

  trackingStatus.textContent = "Recibiendo ubicacion en tiempo real";
function centerMapIfAllowed(lat, lng, zoomLevel = 14) {
  if (hasUserInteractedWithMap) {
    return;
  }

  map.setView([lat, lng], Math.max(map.getZoom(), zoomLevel), {
    animate: true,
    duration: 0.6
  });
}

  trackingLat.textContent = payload.lat.toFixed(6);
  trackingLng.textContent = payload.lng.toFixed(6);
  trackingTime.textContent = new Date(payload.timestamp).toLocaleString();
}

function initializeTracking() {
  updateTrackingPanel(null);

  // Always show viewer location
  viewerMarker = L.marker([-38.6893, -62.2698], { icon: viewerIcon }).addTo(map);

  if (!navigator.geolocation) {
    console.warn("Geolocation API is not available in this browser");
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy, speed } = position.coords;

      if (viewerMarker) {
        viewerMarker.setLatLng([latitude, longitude]);
        viewerMarker.bindTooltip("Tu ubicacion", { permanent: false });
      }
      centerMapIfAllowed(latitude, longitude);

      if (mode === "driver" && socket) {
        socket.emit("tracking:driver", {
          lat: latitude,
          lng: longitude,
          accuracy,
          speedKmh: typeof speed === "number" ? Math.round(speed * 3.6 * 10) / 10 : null
        });
      }
    },
    (error) => {
      console.warn("Geolocation error", error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000
    }
  );

  // Only initialize tracking if shipmentId is provided
  if (!shipmentId) {
    console.log("No shipmentId specified. Showing only your location.");
    return;
  }

  initializeSocketTracking(shipmentId);
  fetchLatestTracking(shipmentId);
}

function clearAnyTrailLayer() {
  map.eachLayer((layer) => {
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      map.removeLayer(layer);
    }
  });
}

// Defensive cleanup in case an old cached script created a trail polyline.
clearAnyTrailLayer();

function setupSocketListeners() {
  socket.on("connect", () => {
    console.log("Connected to realtime server", socket.id);
  });

  socket.on("tracking:update", (payload) => {
    const { shipmentId: currentShipmentId, lat, lng, speedKmh, accuracy, timestamp } = payload;

    clearAnyTrailLayer();

    if (!marker) {
      marker = L.marker([lat, lng], { icon: trackingIcon }).addTo(map);
    }

    marker.setLatLng([lat, lng]);
    marker.bindPopup(`Shipment ${currentShipmentId}`).openPopup();

    if (!hasCenteredOnTracking) {
      centerMapIfAllowed(lat, lng);
      hasCenteredOnTracking = true;
    }

    updateTrackingPanel({ lat, lng, timestamp });

    if (typeof speedKmh === "number") {
      console.log(`Tracking ${currentShipmentId}: ${speedKmh} km/h at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else if (typeof accuracy === "number") {
      console.log(`Tracking ${currentShipmentId}: GPS ±${Math.round(accuracy)} m`);
    }
  });

  socket.on("disconnect", () => {
    trackingStatus.textContent = "Conexion cerrada. Reintentando...";
  });
}

function initializeSocketTracking(shipmentId) {
  socket = io({
    query: {
      shipmentId,
      mode
    }
  });

  setupSocketListeners();
}

async function fetchLatestTracking(shipmentId) {
  try {
    const response = await fetch(`/api/tracking/${shipmentId}/latest`);

    if (!response.ok) {
      trackingStatus.textContent = "Paquete sin ubicaciones todavia. Esperando primer dato...";
      return;
    }

    const result = await response.json();
    const latest = result?.data;
    if (!latest || typeof latest.lat !== "number" || typeof latest.lng !== "number") {
      return;
    }

    marker = L.marker([latest.lat, latest.lng], { icon: trackingIcon }).addTo(map);
    marker.bindPopup(`Shipment ${shipmentId}`).openPopup();
    updateTrackingPanel(latest);
  } catch (error) {
    console.error("Error validating shipment:", error);
    trackingStatus.textContent = "No se pudo consultar la ultima ubicacion";
  }
}

initializeTracking();
