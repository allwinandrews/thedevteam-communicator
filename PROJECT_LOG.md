# Project Log (Builder Perspective)

## Presentation Summary
- Dates covered: 2026-03-03 to 2026-03-04
- Scope: React frontend + ASP.NET Core backend communicator app
- Core focus: clear UX, real-time updates with fallback, and offline tolerance

## Architecture Snapshot
- Frontend: React (Vite), REST via `fetch`, SignalR for live updates
- Backend: ASP.NET Core Web API + SignalR hub
- Auth: JWT with password hashing
- Storage: in-memory user and message stores

## Feature Highlights
- Auth and session validation on load
- Users list with previews, ordering, and unread counts
- Chat thread with auto-scroll and per-thread refresh
- Real-time messaging with polling fallback
- Offline outbox with queued-to-delivered replacement
- Online/offline presence indicators

## Detailed Log

## 2026-03-03

### 1) Project Start

- Created a new workspace folder: `thedevteam-communicator`.
- Goal: React frontend + ASP.NET Core backend for a minimal communicator app.
- Key decision: keep it small and clear, using in‑memory storage and polling, not real‑time sockets.

### 2) Backend Scaffold

- Ran `dotnet new webapi` to scaffold `Communicator.Api`.
- Replaced the template weather endpoint with:
  - `POST /auth/register` (register user)
  - `POST /auth/login` (login, returns JWT)
  - `GET /users` (list other users)
  - `POST /messages` (send message)
  - `GET /messages/inbox` (messages sent to you)
- Added in‑memory stores:
  - `UserStore` for users
  - `MessageStore` for messages
- Added password hashing with `PasswordHasher<UserRecord>`.
- Added JWT issuing and validation.
- Added CORS (allow all) for local dev.
- Added `Jwt:Key` to `appsettings.json`.
- Added NuGet dependency: `Microsoft.AspNetCore.Authentication.JwtBearer`.

### 3) Frontend Scaffold

- Ran `npm create vite@latest` with React template to scaffold `Communicator.Web`.
- Installed dependencies with `npm install`.

### 4) Frontend Implementation

- Replaced the template UI with a small app:
  - Login/Register form
  - User list
  - Send message
  - Inbox
  - Online/Offline indicator
- Implemented API calls using `fetch`.
- Implemented offline queue:
  - Messages queued in `localStorage` when offline or on send failure.
  - Automatically flushes when back online.
- Added minimal styling for readability and layout.

### 5) Documentation

- Added `README.md` with:
  - Requirements coverage
  - Simplifications
  - Local run instructions
  - Notes about JWT secret and API URL.

### 6) Usability Tweaks

- Added a manual refresh button in the header to pull latest users and inbox.
- Added "Last refresh" time indicator so you can see when data was fetched.
- Files updated: `Communicator.Web/src/App.jsx`

### 7) Bug Fix: JWT Key Length

- Fixed auth failure caused by too-short JWT signing key.
- Updated `Jwt:Key` to 32+ bytes (required for HS256).
- File updated: `Communicator.Api/appsettings.json`

### 8) Bug Fix: 401 Loop on Send

- Prevented infinite retry loop when a JWT is invalid/expired.
- If a send or queue flush gets 401, the app logs out and stops retrying.
- File updated: `Communicator.Web/src/App.jsx`

### 9) UI Filter: Hide Current User

- Frontend now filters out the current user from the Users list.
- File updated: `Communicator.Web/src/App.jsx`

### 10) Debug Auth Failures

- Added JWT authentication failure header (`x-auth-error`) to make 401 causes visible.
- Added `GET /auth/me` to quickly verify a token is accepted.
- File updated: `Communicator.Api/Program.cs`

### 11) Expose Auth Error Header

- CORS now exposes `x-auth-error` so the browser can read it.
- File updated: `Communicator.Api/Program.cs`

### 12) Bug Fix: Sub Claim Mapping

- `sub` claim gets mapped to `NameIdentifier` by default in ASP.NET.
- Updated user ID extraction to read either `sub` or `NameIdentifier`.
- Fixes 401 from `POST /messages` when the token is valid.
- File updated: `Communicator.Api/Program.cs`

### 13) UI Change: Users-Only Home

- After login, the home page now shows only the Users section.
- Added WhatsApp-style search input and a virtualized list for fast scrolling.
- Removed inbox fetch from the home page.
- Files updated: `Communicator.Web/src/App.jsx`, `Communicator.Web/src/App.css`

### 14) Chat Panel Slide-In

- Clicking a user now opens a slide-in chat panel with the thread.
- Added `/messages/thread/{userId}` backend endpoint to fetch two-way messages.
- Restored message send + offline queue, scoped to the chat panel.
- Files updated: `Communicator.Api/Program.cs`, `Communicator.Web/src/App.jsx`, `Communicator.Web/src/App.css`

### 15) UI Change: Remove Chat Panel

- Removed the slide-in chat panel from the home page UI.
- Restored the users-only screen layout.
- Files updated: `Communicator.Web/src/App.jsx`, `Communicator.Web/src/App.css`

### 16) Chat Page + URL Persistence

- Clicking a user now opens a dedicated chat page instead of staying on the users list.
- Chat state is reflected in the URL hash (#/chat/{userId}) so refresh/back keeps the thread.
- Added thread fetching + send flow in the chat view, with logout on 401s.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 17) Chat Page: Keep Users List Visible

- Chat view now keeps the users list visible for fast switching between conversations.
- Added active row styling and split layout when a chat is open.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 18) Users List + Inbox Preview

- Users list now shows the latest incoming (or active thread) message preview with timestamp, WhatsApp-style.
- Inbox messages are fetched alongside users to power the previews.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 19) Inbox View + Offline Outbox

- Added inbox list in the sidebar so users can see messages sent to them.
- Implemented an offline outbox queue (localStorage) with retry when back online.
- Added queued indicator in the header.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 20) Remove Inbox Section

- Removed the standalone inbox list from the sidebar while keeping the users list and chat flow.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 21) Chat Auto-Scroll

- Chat thread now auto-scrolls to the latest message when new messages load or send.
- File updated: Communicator.Web/src/App.jsx

### 22) Real-Time Chat (SignalR)

- Added SignalR hub on the backend and broadcast new messages to sender + recipient.
- Frontend now connects via SignalR and updates threads/previews in real time.
- Files updated: Communicator.Api/Program.cs, Communicator.Web/src/App.jsx, Communicator.Web/package.json

### 23) SignalR Live Updates Fix

- Stabilized SignalR handlers by using refs for current auth/chat selection to avoid stale closures.
- Prevented unnecessary SignalR reconnects when switching chats.
- File updated: Communicator.Web/src/App.jsx

### 24) Session Validation on Load

- Added /auth/me check on app load so stale tokens/users are cleared after backend restarts.
- Logout now can surface a session-expired message.
- File updated: Communicator.Web/src/App.jsx

### 25) Thread Refresh + Polling Fallback

- Refresh now also reloads the active chat thread.
- Added polling (every 4s) to keep chat updated if SignalR is unavailable.
- File updated: Communicator.Web/src/App.jsx

### 26) Users List Ordering + Unread Highlight

- Users list now orders by most recent chat activity.
- Added unread badge/highlight per user (clears when opening the chat).
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 27) Users List Realtime Updates

- Added inbox polling (without UI) to keep user previews, ordering, and unread badges updated even if SignalR drops.
- SignalR now also updates last-seen message IDs to avoid duplicate unread counts.
- File updated: Communicator.Web/src/App.jsx

### 28) Polling Fallback Only

- Added SignalR connection state and disabled inbox polling while realtime is connected.
- Polling now runs only as a fallback when the hub is disconnected.
- File updated: Communicator.Web/src/App.jsx

### 29) Unread Highlight Contrast

- Improved text contrast for unread-highlighted user rows.
- File updated: Communicator.Web/src/App.css

### 30) Accurate Unread Counts

- Added last-read timestamps per user and recomputed unread counts from inbox data.
- Unread badges now reflect actual unread messages since last open.
- File updated: Communicator.Web/src/App.jsx

### 31) Logout Blank Page Guard

- Added safe JSON parsing for cached auth/outbox/unread state.
- Logout now clears cached outbox/unread/last-read keys to prevent corrupted UI state.
- File updated: Communicator.Web/src/App.jsx

### 32) Fix Logout Render Error

- Prevented logout click events from being rendered as status messages.
- Logout button now calls handler without passing the click event.
- File updated: Communicator.Web/src/App.jsx

### 33) Toast Errors

- Added toast notifications (5s) for session/auth and refresh errors.
- Logout and auth failures now surface via toasts.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 34) Frontend Auth Validation

- Added required field validation for login/register with focused missing field.
- Added basic password length check and user-friendly toasts.
- File updated: Communicator.Web/src/App.jsx

### 35) Auth Error Toasts

- Toasts now render on the login/register screen too (so unauthenticated errors are visible).
- File updated: Communicator.Web/src/App.jsx

### 36) Toast Stack Styling

- Toasts now appear top-center in a stack with error coloring.
- Supports multiple messages simultaneously.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 37) Toast Palette Tuning

- Updated toast colors to a calmer neutral base and readable error palette.
- File updated: Communicator.Web/src/App.css

### 38) Users List Text Contrast

- Set a stronger default color for usernames to improve readability.
- File updated: Communicator.Web/src/App.css

## How We’ll Use This Log

- I will append entries for every meaningful change.
- Each entry will note: what was changed, why, and where.

## 2026-03-04

### 39) Chat Close Button

- Replaced "Back to users" with an X close button in the chat header for a cleaner UI.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 40) Navbar Layout

- Reworked the header into a compact navbar with left-aligned title/meta and right-aligned status/actions.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 41) Layout Fit at 100% Zoom

- Switched the main layout to use viewport height and flexed the users list/chat thread so bottom content stays visible.
- Tightened navbar spacing and made it non-shrinking.
- Files updated: Communicator.Web/src/App.css

### 42) Toasts Limited to Session Expiry

- Toasts now only appear for the specific "session expired or user missing" message; other errors use inline status text.
- File updated: Communicator.Web/src/App.jsx

### 43) Queued Message Highlight

- Queued messages now render in the chat thread with a distinct queued color and queued timestamp styling.
- File updated: Communicator.Web/src/App.css

### 44) Queued Preview in Users List

- Users list now shows queued outgoing previews with a distinct label and time styling.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 45) Active User Indicator

- Added a green activity dot on user avatars when recent message activity is detected.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 46) Real Presence Indicator

- Added server-side presence tracking via SignalR connect/disconnect events and a /presence endpoint.
- Users list now shows the green dot only for users currently online.
- Files updated: Communicator.Api/Program.cs, Communicator.Web/src/App.jsx

### 47) Presence Heartbeat + TTL

- Added presence ping endpoint and client heartbeat to keep online status accurate even with abrupt disconnects.
- Presence now uses a 30s TTL based on last-seen timestamps.
- Files updated: Communicator.Api/Program.cs, Communicator.Web/src/App.jsx

### 48) Toast Dedup + Reset Timer

- Duplicate toast messages now reuse the existing toast and reset its 5s timer instead of stacking.
- File updated: Communicator.Web/src/App.jsx

### 49) Online/Offline Presence Dots

- Users list now shows a green dot when online and red dot when offline, driven by real-time presence.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 50) Queued Messages Rendered In Chat

- Offline queued messages now render inside the active chat thread with a visible queued label.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 51) Refresh + Loading Indicators

- Added loading indicators for refresh, users list, and chat thread states.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 52) Queue Dedup In Chat

- Suppressed queued messages when a delivered copy is already present to avoid temporary duplicates.
- File updated: Communicator.Web/src/App.jsx

### 53) Send Dedup Guard

- Prevented duplicate chat entries when REST + SignalR both deliver the same sent message.
- File updated: Communicator.Web/src/App.jsx

### 54) Separate Refresh Controls

- Added dedicated refresh buttons for the users list and the active chat thread.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 55) Refresh Icons

- Switched refresh button labels to icon-only controls with accessible labels.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 56) Refresh Icon Spinner

- Refresh icons now spin while loading and the buttons stay disabled during refresh.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 57) Remove Main Refresh Button

- Removed the global navbar refresh button in favor of per-section refresh controls.
- File updated: Communicator.Web/src/App.jsx

### 58) Navbar Right Alignment + Height

- Ensured status/logout cluster sits on the right and reduced navbar height.
- File updated: Communicator.Web/src/App.css

### 59) Navbar Meta Layout

- Kept the title on the left and stacked auth/refresh meta above the status/logout actions on the right.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 60) Navbar Styling Pass

- Tuned navbar spacing, typography, and meta styling for a cleaner layout.
- File updated: Communicator.Web/src/App.css

### 61) Navbar Height Reduction

- Reduced navbar padding/typography so the header stays compact while keeping the title left-aligned.
- File updated: Communicator.Web/src/App.css

### 62) Navbar Left Alignment Tweak

- Tightened left padding and anchored the title block to the left edge.
- File updated: Communicator.Web/src/App.css

### 63) Navbar Single-Row Layout

- Kept navbar content on one line by moving meta next to the title and aligning actions inline.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 64) Minimal Navbar + Meta Pills

- Simplified navbar styling (minimal border, no shadow) and kept all items on one line.
- Rendered auth meta as pills and tightened spacing to match logout height.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 65) Per-Section Refresh Timestamps

- Removed global navbar refresh time.
- Added users list “Last refresh” label near the users refresh button.
- Added chat thread “Last refresh” label near the chat refresh button and update on thread fetch.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 66) Users Header Cleanup

- Removed the “Find people to message.” helper text.
- Improved users header alignment and refresh pill styling.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 67) Chat Header Cleanup

- Removed the user ID line from the chat header.
- File updated: Communicator.Web/src/App.jsx

### 68) Skeleton Loaders

- Replaced spinner rows with skeleton loaders for users list and chat thread.
- Files updated: Communicator.Web/src/App.jsx, Communicator.Web/src/App.css

### 69) Client Message ID Deduping

- Added `clientMessageId` to message send payloads and API responses.
- Backend now stores and echoes `clientMessageId` for reliable deduping across polling + SignalR.
- Frontend uses `clientMessageId` to suppress duplicates, including queued-to-delivered transitions.
- Files updated: Communicator.Api/Program.cs, Communicator.Web/src/App.jsx

### 70) Outbox Immediate Removal

- Remove queued items from the outbox as soon as a send succeeds to avoid transient duplicates.
- File updated: Communicator.Web/src/App.jsx

### 71) Queued-to-Delivered In-Place Update

- Render queued messages directly in the thread state for the active chat.
- Replace queued items in-place when the delivered message arrives (no remove/re-add flicker).
- Merge pending queued items into thread loads so offline messages stay visible.
- File updated: Communicator.Web/src/App.jsx

### 72) README Run Notes

- Clarified local run instructions and added setup notes about restarting API after contract changes.
- File updated: README.md
