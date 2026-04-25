# Realtime tracking demo (Node + Leaflet)

This project is a minimal test app to learn how to build real-time tracking with:

- Node.js (Express server)
- Socket.IO (live updates)
- Leaflet (map rendering)

## Run

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Open in browser:

```text
http://localhost:3000
```

## How it works

- `server.js` emits a `tracking:update` event every second.
- `public/app.js` listens to the event and updates marker + trail.
- `public/index.html` contains the map and status panel.

## Use browser GPS instead of simulated route

Now you can use two simple modes with URL params:

- `mode=driver`: shares browser GPS as courier location.
- `mode=viewer`: only watches courier tracking.
- `shipmentId=<ID>`: both screens must use the same shipment ID.

Examples:

- Driver (shares location):
	`http://localhost:3000/?shipmentId=SHIP-001&mode=driver`
- Viewer (your ShippingApp section):
	`http://localhost:3000/?shipmentId=SHIP-001&mode=viewer`

Behavior:

- The map always centers on the person who opened it (viewer geolocation).
- The tracked marker is the courier location (only sent from `mode=driver`).
- No route history is drawn, only the current courier marker.
- If there is no driver sharing for `SHIP-001`, the demo route is used as fallback around UNS (Bahia Blanca).

Requirements:

- Allow location permission in the browser.
- Geolocation works on `localhost` or HTTPS origins.
- For realistic movement tests, open from a mobile browser and move physically.

## Next experiments

- Replace simulated route with GPS data from API/devices.
- Track multiple shipments with different marker colors.
- Save history in DB and replay routes by date range.

## Consume from another app (simple integration)

You can run this project as a small tracking microservice and consume it from your ShippingApp.

### 1) Embed tracking map in your ShippingApp

Use an iframe (or webview) that points to viewer mode:

`http://localhost:3000/?shipmentId=SHIP-001&mode=viewer`

The map will center on the user who opens it and will display the courier marker for that shipment.

### 2) Send courier location from your other app via HTTP

Endpoint:

`POST /api/tracking/update`

Body example:

```json
{
	"shipmentId": "SHIP-001",
	"lat": -38.6893,
	"lng": -62.2698,
	"accuracy": 12,
	"speedKmh": 24.8,
	"timestamp": "2026-04-25T17:40:00.000Z"
}
```

As soon as this endpoint is called, connected viewers for that shipment receive `tracking:update` in real time.

### 3) Optional API key protection

Set env var before running:

```bash
TRACKING_API_KEY=my-secret-key npm start
```

Then send header in update calls:

`x-tracking-key: my-secret-key`

### 4) Read latest location (fallback query)

Endpoint:

`GET /api/tracking/SHIP-001/latest`
