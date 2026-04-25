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

const params = new URLSearchParams(window.location.search);
const shipmentId = params.get("shipmentId");
const mode = params.get("mode") === "driver" ? "driver" : "viewer";

let socket = null;

function initializeTracking() {
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
      map.setView([latitude, longitude], Math.max(map.getZoom(), 14), {
        animate: true,
        duration: 0.6
      });

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

  // Validate shipmentId exists before rendering
  validateAndInitializeTracking(shipmentId);
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
        map.setView([latitude, longitude], Math.max(map.getZoom(), 14), {
          animate: true,
          duration: 0.6
        });

        if (mode === "driver") {
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
  });

  socket.on("tracking:update", (payload) => {
    const { shipmentId: currentShipmentId, lat, lng, speedKmh, accuracy, timestamp } = payload;

    clearAnyTrailLayer();

    if (marker) {
      marker.setLatLng([lat, lng]);
      marker.bindPopup(`Shipment ${shipmentId}`).openPopup();
    }

    if (typeof speedKmh === "number") {
      console.log(`Tracking ${currentShipmentId}: ${speedKmh} km/h at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else if (typeof accuracy === "number") {
      console.log(`Tracking ${currentShipmentId}: GPS ±${Math.round(accuracy)} m`);
    }
  });
}

async function validateAndInitializeTracking(shipmentId) {
  try {
    const response = await fetch(`/api/tracking/${shipmentId}/latest`);
    
    if (!response.ok) {
      console.log(`Shipment ID "${shipmentId}" does not exist. Showing only your location.`);
      return;
    }

    // Shipment exists, initialize tracking
    marker = L.marker([-38.6893, -62.2698], { icon: trackingIcon }).addTo(map);

    socket = io({
      query: {
        shipmentId,
        mode
      }
    });

    setupSocketListeners();
  } catch (error) {
    console.error("Error validating shipment:", error);
  }
}

initializeTracking();
