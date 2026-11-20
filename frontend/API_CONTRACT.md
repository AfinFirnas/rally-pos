# RallyPOS Frontend REST API Contract

Base URL is configured via `VITE_API_BASE_URL` (e.g., `http://localhost:8000`).  
When `VITE_API_BASE_URL` is unset or unreachable (`Failed to fetch`), `src/services/apiClient.ts` automatically falls back to a standalone local mock adapter backed by `src/db/seed.ts`, `src/lib/ledgerEngine.ts`, `src/lib/offlineQueue.ts`, and `localStorage`.

---

## Global Conventions

### Headers
- `Content-Type: application/json`
- `Authorization: Bearer <token>` (attached automatically on all requests when a JWT token is stored)

### Error Responses (HTTP 4xx / 5xx)
```json
{
  "error": "Human-readable error message",
  "message": "Optional alternative error message"
}
```
Note: `apiClient.ts` only triggers the local mock fallback on network/reachability errors (`TypeError: Failed to fetch`). Domain errors (`400`, `401`, `403`, `404`, `409`, `422`) are thrown to the UI and displayed inline.

---

## 1. Authentication & Session

### `POST /api/auth/login`
Authenticate a user with email and password.

**Request Body:**
```json
{
  "email": "attendee@example.com",
  "password": "secret-password"
}
```

**Response (`200 OK`):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "attendee@example.com",
    "username": "AkiraCosplay",
    "password_hash": "",
    "is_merchant": false,
    "is_admin": false,
    "active_view_mode": "buyer",
    "merchant_brand_name": null,
    "merchant_bio": null,
    "lifetime_actual_spent_idr": 0,
    "lifetime_sales_idr": 0,
    "events_count": 1,
    "earned_badges": [],
    "created_at": "2025-05-01T10:00:00.000Z",
    "updated_at": "2025-05-01T10:00:00.000Z"
  }
}
```

### `POST /api/auth/register`
Create a new Attendee account (defaults to `active_view_mode: "buyer"`).

**Request Body:**
```json
{
  "email": "new.attendee@example.com",
  "username": "MikuFan99",
  "password": "password123"
}
```

**Response (`201 Created` / `200 OK`):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "...User" }
}
```

### `POST /api/auth/demo`
Launch an interactive demo account session (optional server support; handled locally if absent).

**Request Body:**
```json
{
  "preset": "fresh_buyer"
}
```
`preset` is one of `"fresh_buyer" | "active_buyer" | "merchant" | "admin"`.

**Response (`200 OK`):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "...User" }
}
```

### `GET /api/auth/me`
Fetch the currently authenticated user profile from the Bearer token.

**Response (`200 OK`):**
```json
{
  "user": { "...User" }
}
```

### `POST /api/auth/logout`
Invalidate the current session token.

**Response (`200 OK`):**
```json
{
  "ok": true
}
```

### `PATCH /api/auth/view-mode`
Switch between Attendee (`buyer`) and Booth (`merchant`) views for users with `is_merchant: true`.

**Request Body:**
```json
{
  "active_view_mode": "merchant"
}
```

**Response (`200 OK`):**
```json
{
  "user": { "...User" }
}
```

---

## 2. Events & Bootstrap Hydration

### `GET /api/events`
Hydrate events directory, participant passes, booths, catalog items, stamps, transactions, ticket codes, meetup board messages, and public user profiles.

**Response (`200 OK`):**
```json
{
  "events": [ { "...Event" } ],
  "participants": [ { "...EventParticipant" } ],
  "tenants": [ { "...Tenant" } ],
  "tenant_items": [ { "...TenantItem" } ],
  "stamps": [ { "...Stamp" } ],
  "transactions": [ { "...Transaction" } ],
  "ticket_uids": [ { "...TicketUid" } ],
  "meetups": [ { "...EventChatMessage" } ],
  "users": [ { "...User" } ]
}
```

### `GET /api/events/:eventId/leaderboard`
Fetch ranked public leaderboard standings for an event (privacy-safe: omits `actual_spent_idr`).

**Response (`200 OK`):**
```json
{
  "event_id": "event-uuid",
  "entries": [
    {
      "participant_id": "part-uuid",
      "event_id": "event-uuid",
      "user_id": "user-uuid",
      "username": "RizkyPatron",
      "leaderboard_idr": 625000,
      "streak_expires_at": "2025-05-01T12:30:00.000Z",
      "stamps_count": 4,
      "rank_position": 1
    }
  ]
}
```

---

## 3. Event Check-In & Booth Setup

### `POST /api/events/:eventId/check-in`
Claim an Event Ticket Code (`TKT-...`), mint a cryptographic `EV-XXXXXX` QR pass, unlock Stamp #1 (`stamp_type: "checkin"`), and optionally provision a booth when claiming a merchant ticket.

**Request Body:**
```json
{
  "uid_code": "TKT-DEMO-BYR",
  "booth_name": "Optional Booth Name",
  "booth_number": "E-04",
  "booth_bio": "Optional summary"
}
```

**Response (`200 OK`):**
```json
{
  "event": { "...Event" },
  "role_type": "buyer",
  "participant": {
    "id": "part-uuid",
    "event_id": "event-uuid",
    "user_id": "user-uuid",
    "qr_code": "EV-9X4K2M",
    "actual_spent_idr": 0,
    "leaderboard_idr": 0,
    "streak_expires_at": null,
    "created_at": "2025-05-01T10:00:00.000Z",
    "updated_at": "2025-05-01T10:00:00.000Z"
  },
  "tenant": null,
  "check_in_stamp": {
    "id": "stamp-uuid",
    "event_id": "event-uuid",
    "participant_id": "part-uuid",
    "tenant_id": null,
    "stamp_type": "checkin",
    "unlocked_at": "2025-05-01T10:00:00.000Z"
  },
  "ticket_uid": { "...TicketUid" },
  "user": { "...User" },
  "is_new_join": true
}
```

### `POST /api/events/:eventId/link-booth`
Upgrade the signed-in attendee to Merchant / Booth mode by claiming a Booth Event Ticket Code (`role_type: "merchant"`).

**Request Body:**
```json
{
  "uid_code": "TKT-DEMO-SLR",
  "booth_name": "Tsukimi Doujin Circle",
  "booth_number": "E-04",
  "bio": "Artbooks, holo keychains & commissions"
}
```

**Response (`200 OK`):**
```json
{
  "user": { "...User (is_merchant: true, active_view_mode: 'merchant')" },
  "tenant": { "...Tenant" },
  "participant": { "...EventParticipant" },
  "check_in_stamp": { "...Stamp" },
  "ticket_uid": { "...TicketUid" }
}
```

### `PATCH /api/booths/:tenantId`
Update booth profile metadata and 1:1 square stamp artwork URL/data URI.

**Request Body:**
```json
{
  "booth_name": "KitsuneInk Studio",
  "booth_number": "A-12",
  "description": "Original prints and acrylic standees.",
  "stamp_image_url": "data:image/png;base64,..."
}
```

**Response (`200 OK`):**
```json
{
  "tenant": { "...Tenant" }
}
```

### `POST /api/booths/:tenantId/items`
Create a quick-tap POS catalog item for a booth.

**Request Body:**
```json
{
  "item_name": "Holo Sticker Pack",
  "price_idr": 25000,
  "sort_order": 1,
  "is_active": true
}
```

**Response (`201 Created` / `200 OK`):**
```json
{
  "item": { "...TenantItem" }
}
```

### `PATCH /api/booths/:tenantId/items/:itemId`
Update or toggle visibility of a booth POS catalog item.

**Request Body:**
```json
{
  "item_name": "Holo Sticker Pack v2",
  "price_idr": 30000,
  "is_active": true
}
```

**Response (`200 OK`):**
```json
{
  "item": { "...TenantItem" }
}
```

### `DELETE /api/booths/:tenantId/items/:itemId`
Delete a booth POS catalog item.

**Response (`200 OK`):**
```json
{
  "ok": true,
  "id": "item-uuid"
}
```

---

## 4. POS Checkout & Reversal (Dual-IDR Ledger)

### `POST /api/pos/checkout`
Process an idempotent Dual-IDR booth checkout (used both live and when replaying IndexedDB offline queue transactions via `client_tx_id`).

**Request Body:**
```json
{
  "client_tx_id": "pos-550e8400-e29b-41d4-a716-446655440000",
  "event_id": "event-uuid",
  "tenant_id": "tenant-uuid",
  "buyer_qr_code": "EV-9X4K2M",
  "actual_amount_idr": 50000,
  "item_summary": [
    {
      "item_id": "item-uuid",
      "item_name": "Acrylic Keychain",
      "quantity": 2,
      "unit_price_idr": 25000
    }
  ]
}
```

**Response (`200 OK`):**
```json
{
  "transaction": {
    "id": "tx-uuid",
    "client_tx_id": "pos-550e8400-e29b-41d4-a716-446655440000",
    "event_id": "event-uuid",
    "participant_id": "part-uuid",
    "tenant_id": "tenant-uuid",
    "actual_amount_idr": 50000,
    "leaderboard_amount_idr": 87500,
    "multiplier_applied": 1.25,
    "hit_hidden_bounty": true,
    "hidden_bounty_bonus_idr": 25000,
    "status": "completed",
    "is_flagged": false,
    "flag_reason": null,
    "item_summary": [ { "...TransactionItemSummary" } ],
    "voided_at": null,
    "voided_by_user_id": null,
    "created_at": "2025-05-01T11:15:00.000Z"
  },
  "participant": { "...EventParticipant (updated totals)" },
  "tenant": { "...Tenant (updated sales & stamp count)" },
  "unlocked_stamp": { "...Stamp | null" },
  "hidden_bounty_triggered": true,
  "hidden_bounty_bonus_idr": 25000
}
```

### `POST /api/pos/reverse`
Void a completed transaction (protected by Organizer Admin Void PIN or organizer privilege), deducting Dual-IDR totals and reversing the booth stamp if no other qualifying spend remains.

**Request Body:**
```json
{
  "transaction_id": "tx-uuid",
  "admin_void_pin": "123456"
}
```

**Response (`200 OK`):**
```json
{
  "transaction": { "...Transaction (status: 'voided')" },
  "participant": { "...EventParticipant (deducted totals)" },
  "tenant": { "...Tenant (deducted sales & stamp count)" },
  "reversed_stamp_id": "stamp-uuid-or-null",
  "deduct_actual_idr": 50000,
  "deduct_leaderboard_idr": 62500
}
```

---

## 5. Meetups & Announcements

### `GET /api/events/:eventId/meetups`
Fetch organizer announcements and verified attendee meetup posts for an event.

**Response (`200 OK`):**
```json
{
  "event_id": "event-uuid",
  "messages": [ { "...EventChatMessage" } ]
}
```

### `POST /api/events/:eventId/meetups`
Publish either a structured cosplay/meetup request (`looking_for`) or an official organizer announcement (`admin_announcement`).

**Request Body (Meetup Request):**
```json
{
  "message_type": "looking_for",
  "target_character": "Gojo Satoru",
  "target_location": "Main Stage",
  "target_activity": "Photoshoot",
  "sender_role": "buyer"
}
```

**Request Body (Organizer Announcement):**
```json
{
  "message_type": "admin_announcement",
  "announcement_text": "Stage cosplay parade starts in 15 minutes!",
  "is_pinned": true,
  "sender_role": "organizer"
}
```

**Response (`201 Created` / `200 OK`):**
```json
{
  "message": { "...EventChatMessage" }
}
```

### `POST /api/meetups/:id/interest`
Toggle the authenticated user's `"I'm Interested"` / `"Interested ✓"` status on a meetup post or announcement.

**Request Body:**
```json
{}
```

**Response (`200 OK`):**
```json
{
  "message": { "...EventChatMessage (updated interested_user_ids)" },
  "interested": true
}
```

---

## 6. Organizer Command Center Endpoints

### `POST /api/organizer/events`
Create a new draft convention event.

**Request Body:**
```json
{
  "name": "Comifuro Winter",
  "description": "Live Dual-IDR POS & Stamp Rally event.",
  "min_stamp_spend_idr": 20000,
  "admin_void_pin": "123456"
}
```

**Response (`201 Created` / `200 OK`):**
```json
{
  "event": { "...Event" }
}
```

### `PATCH /api/organizer/events/:eventId/status`
Transition an event between `active` and `archived`. Starting an event may return an initial pinned welcome announcement.

**Request Body:**
```json
{
  "status": "active"
}
```

**Response (`200 OK`):**
```json
{
  "event": { "...Event" },
  "welcome_announcement": { "...EventChatMessage | null" }
}
```

### `POST /api/organizer/events/:eventId/tickets`
Generate a batch of unique Event Ticket Codes or bulk-import parsed CSV codes.

**Request Body (Generate):**
```json
{
  "mode": "generate",
  "role_type": "buyer",
  "count": 10
}
```

**Request Body (Bulk Import):**
```json
{
  "mode": "import",
  "tickets": [
    { "uid_code": "TKT-CF20-BYR", "role_type": "buyer" },
    { "uid_code": "TKT-CF20-SLR", "role_type": "merchant" }
  ]
}
```

**Response (`201 Created` / `200 OK`):**
```json
{
  "tickets": [ { "...TicketUid" } ]
}
```

### `POST /api/organizer/events/:eventId/cold-bounty`
Activate a timed Gold Cold-Booth Bounty boost on up to 3 low-traffic booths and optionally broadcast an announcement.

**Request Body:**
```json
{
  "tenant_ids": ["tenant-uuid-1", "tenant-uuid-2"],
  "multiplier": 1.25,
  "duration_minutes": 30
}
```

**Response (`200 OK`):**
```json
{
  "tenants": [ { "...Tenant" } ],
  "announcement": { "...EventChatMessage | null" }
}
```

### `DELETE /api/organizer/events/:eventId/cold-bounty/:tenantId`
Stop an active Cold-Booth Bounty on a specific booth.

**Response (`200 OK`):**
```json
{
  "tenant": { "...Tenant" }
}
```

### `PATCH /api/organizer/booths/:tenantId/hidden-bounty`
Enable or disable Hourly Hidden Bounty status on a single booth.

**Request Body:**
```json
{
  "is_hidden_bounty": true
}
```

**Response (`200 OK`):**
```json
{
  "tenant": { "...Tenant" }
}
```

### `POST /api/organizer/events/:eventId/hidden-bounty/rotate`
Randomly rotate secret Hourly Hidden Bounty status across 3–5 booths in an event.

**Request Body:**
```json
{
  "count": 4
}
```

**Response (`200 OK`):**
```json
{
  "tenants": [ { "...Tenant" } ]
}
```

### `POST /api/organizer/transactions/:transactionId/dismiss-flag`
Dismiss an anti-fraud anomaly flag after organizer review.

**Request Body:**
```json
{}
```

**Response (`200 OK`):**
```json
{
  "transaction": { "...Transaction (is_flagged: false)" }
}
```
