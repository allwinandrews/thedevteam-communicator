# Communicator Take-Home ? What Was Done

## One-Line Summary
Built a minimal yet robust communicator app with JWT auth, real-time messaging via SignalR, offline tolerance, and a focused UX.

## Scope And Constraints
- React frontend + ASP.NET Core backend
- In-memory persistence (no external DB)
- Real-time where possible, polling fallback for resilience

## Architecture Snapshot
- Frontend: React (Vite), REST via `fetch`, SignalR client
- Backend: ASP.NET Core Web API + SignalR hub
- Auth: JWT with password hashing
- Storage: in-memory user and message stores

## API Surface Implemented
Auth and users:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /users`

Messaging:
- `POST /messages`
- `GET /messages/inbox`
- `GET /messages/thread/{userId}`

Presence:
- `GET /presence`
- `POST /presence/ping`

## Core Features Delivered
Authentication and session:
- JWT auth, validation, and explicit error visibility
- Session validation on app load to clear stale tokens

Messaging UX:
- Users list with latest message preview and timestamps
- Chat thread view with auto-scroll
- Unread counts and unread highlighting

Real-time and resilience:
- SignalR for live message delivery and presence
- Polling fallback when hub is disconnected
- Client message IDs for dedup across REST + SignalR

Offline handling:
- Outbox queue in localStorage
- Queued messages rendered inline
- Queued-to-delivered in-place replacement (no flicker)

Presence:
- Online/offline indicators
- Heartbeat + TTL-based tracking

## Reliability And Data Integrity
- Dedup guards for queued vs delivered messages
- REST + SignalR duplication suppression
- Safe parsing and cache clearing on logout

## UX And Polish
- Compact navbar with contextual meta
- Per-section refresh controls with timestamps
- Skeleton loaders for users list and chat thread
- Toasts for session-expired errors only (other errors inline)

## Milestones By Date
### 2026-03-03
- Initial scaffolding (backend + frontend)
- Auth, users, messages, and basic UI
- Offline queue and refresh controls
- Chat routing and users list previews
- SignalR integration and polling fallback
- Unread counts and error handling refinements

### 2026-03-04
- Presence tracking with TTL + heartbeat
- UI refinements (navbar, refresh controls, loaders)
- Stronger message dedup and queued-to-delivered handling
- README run notes
