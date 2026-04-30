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
- Viewer with JWT:
	`http://localhost:3000/?shipmentId=SHIP-001&mode=viewer&accessToken=<jwt>`

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

### 4) Restrict read access per shipment with JWT (viewer/driver/latest)

Enable JWT validation in the tracking service:

```bash
TRACKING_JWT_SECRET=my-super-secret npm start
```

When `TRACKING_JWT_SECRET` is set:

- `GET /api/tracking/:shipmentId/latest` requires a valid JWT.
- Socket.IO real-time tracking also requires a valid JWT.
- JWT must include permissions for the requested shipment IDs.

Accepted token locations:

- Header: `Authorization: Bearer <jwt>`
- Query param (useful for iframe/web links): `?accessToken=<jwt>`

Supported shipment claims in JWT payload:

- `shipmentId: "SHIP-001"`
- `shipmentIds: ["SHIP-001", "SHIP-ABC"]`
- `shipments: ["SHIP-001", "SHIP-ABC"]`
- `allShipments: true` (wildcard access)

Example payload for one shipment:

```json
{
	"sub": "user-42",
	"shipmentId": "SHIP-001",
	"exp": 1924992000
}
```

Generate a token quickly (PowerShell):

```powershell
node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({sub:'user-42', shipmentIds:['SHIP-001']}, 'my-super-secret', {expiresIn:'1h'}));"
```

Viewer URL example with JWT:

`http://localhost:3000/?shipmentId=SHIP-001&mode=viewer&accessToken=<jwt>`

Driver URL example with JWT for multiple shipments:

`http://localhost:3000/?shipmentIds=SHIP-001,SHIP-ABC&mode=driver&accessToken=<jwt>`

### 5) Issue JWT from backend (recommended)

Instead of signing JWT in frontend, ask this service to issue short-lived tokens from your backend.

Required env vars in deploy:

- `TRACKING_JWT_SECRET`: JWT signing/verification secret.
- `TRACKING_TOKEN_ISSUER_KEY`: key your backend uses to call issuer endpoint.
- `TRACKING_TOKEN_DEFAULT_TTL`: optional token ttl (default `15m`).

Endpoint:

`POST /api/auth/tracking-token`

Headers:

- `x-issuer-key: <TRACKING_TOKEN_ISSUER_KEY>`
- `Content-Type: application/json`

Body example:

```json
{
	"userId": "user-42",
	"shipmentIds": ["SHIP-001", "SHIP-ABC"],
	"role": "viewer",
	"expiresIn": "10m"
}
```

Response:

```json
{
	"ok": true,
	"token": "<jwt>",
	"expiresIn": "10m",
	"claims": {
		"sub": "user-42",
		"role": "viewer",
		"shipmentIds": ["SHIP-001", "SHIP-ABC"],
		"allShipments": false
	}
}
```

### 6) Use this deploy from your client app (Render)

Assume your tracking deploy URL is:

`https://tu-tracking.onrender.com`

Recommended flow:

1. In your main backend (the one with authenticated users), call token issuer:

```bash
curl -X POST "https://tu-tracking.onrender.com/api/auth/tracking-token" \
  -H "Content-Type: application/json" \
  -H "x-issuer-key: TU_ISSUER_KEY" \
  -d '{"userId":"user-42","shipmentIds":["SHIP-001"],"role":"viewer","expiresIn":"10m"}'
```

2. Receive `token` and send it to your frontend.

3. Open tracking view with that token:

`https://tu-tracking.onrender.com/?shipmentId=SHIP-001&mode=viewer&accessToken=<jwt>`

4. For driver mode:

`https://tu-tracking.onrender.com/?shipmentIds=SHIP-001,SHIP-ABC&mode=driver&accessToken=<jwt>`

Important:

- Never expose `TRACKING_TOKEN_ISSUER_KEY` in frontend/mobile apps.
- Generate JWT only in backend after checking user permissions for shipment.
- Use short expirations (`5m` to `15m`) and refresh when needed.

### 7) Read latest location (fallback query)

Endpoint:

`GET /api/tracking/SHIP-001/latest`
