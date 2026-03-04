# TheDevTeam Communicator

Minimal full‑stack demo: React + ASP.NET Core Web API.

## Requirements Covered
- Only registered users can access the app (JWT auth).
- Logged‑in users can see other users.
- Users can message other users.
- Users can see messages sent to them (inbox).
- Presence indicators (online/offline).
- Offline handling: outgoing messages are queued locally and sent on reconnect.
- Somewhat secure: password hashing + JWT tokens + auth validation on load.

## Simplifications
- In‑memory storage (no database).
- Polling/refresh via manual fetch (no WebSocket real‑time).
- Single instance only (no shared cache).

## Run Locally
Backend (API):
1. `cd Communicator.Api`
2. `dotnet run --urls http://localhost:5001`

Frontend (React):
1. `cd Communicator.Web`
2. `npm install`
3. `npm run dev`

Open the app at the Vite URL (usually `http://localhost:5173`).

## Setup Notes
- Run the API and Web app in separate terminals.
- If you change the API message contract (e.g., `clientMessageId`), restart the API and reload the web app.

## Notes
- JWT secret is in `Communicator.Api/appsettings.json` for demo use only.
- If you want a different API URL, set `VITE_API_URL` before `npm run dev`.

## Known Limitations (Intentional)
- Data is in-memory only, so users/messages reset on API restart.
- Security is demo-grade (JWT key in config, permissive CORS, no rate limiting/lockout).
- Offline mode queues outgoing messages only; incoming messages arrive on reconnect.
