# RallyPOS Standalone Backend (FastAPI + PostgreSQL)

Standalone REST API server for **RallyPOS**, implementing 1:1 contract parity with `API_CONTRACT.md` and `src/services/apiClient.ts`.

## Prerequisites (Windows)

- **Python 3.11+** (`py --version`)
- **PostgreSQL 16+** with `psql` and `createdb` available in `PATH` (typically `C:\Program Files\PostgreSQL\16\bin`)

---

## Windows PowerShell Setup Guide

### 1. Create and Activate Virtual Environment

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

> If PowerShell blocks script execution, allow it for the current session:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> .\.venv\Scripts\Activate.ps1
> ```

### 2. Install Dependencies

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Configure Environment Variables

```powershell
Copy-Item .env.example .env
```

Edit `.env` if your PostgreSQL credentials, port, or frontend origin differ:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rallypos
JWT_SECRET=change-me-in-production
CORS_ORIGINS=http://localhost:5173
```

> **Note:** When `http://localhost:5173` is configured in `CORS_ORIGINS`, the server also permits `http://localhost:3000`, `http://127.0.0.1:5173`, and `http://127.0.0.1:3000` for local Vite development flexibility.

### 4. Create PostgreSQL Database & Apply Schema + Seed Data

Make sure the PostgreSQL service is running, then create the `rallypos` database and load `sql\schema.sql` and `sql\seed.sql`:

```powershell
createdb -U postgres rallypos
psql -U postgres -d rallypos -f sql\schema.sql
psql -U postgres -d rallypos -f sql\seed.sql
```

*(Alternatively, using `psql` alone to create the database:)*

```powershell
psql -U postgres -c "CREATE DATABASE rallypos;"
psql -U postgres -d rallypos -f sql\schema.sql
psql -U postgres -d rallypos -f sql\seed.sql
```

`sql\seed.sql` is idempotent (`ON CONFLICT DO NOTHING`) and provisions the Comifuro Demo and Creators Super Fest 2024 datasets, including:
- 8 booths + booth catalog items
- 15 attendees (`EV-` passes, stamps, dual-IDR balances)
- Claimable demo ticket codes `TKT-DEMO-BYR` and `TKT-DEMO-SLR`
- Initial transactions and meetup messages

### 5. Start the Development Server

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify the server is running:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "database": "connected"
}
```

Interactive OpenAPI docs are available at `http://localhost:8000/docs`.

---

## Connecting the Frontend

In the frontend root (`frontend/` or repository root), set `.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Start the frontend Vite dev server (`npm run dev`, typically on `http://localhost:5173` or `http://localhost:3000`). All requests from `apiClient.ts` will now route to FastAPI + PostgreSQL.

---

## Running Unit Tests

Run the pure-Python ledger and dual-IDR math tests without needing a live database:

```powershell
python -m unittest discover -s tests -v
```

---

## Key Security & Business Rules Enforced Server-Side

- **Dual-IDR Privacy:** `actual_spent_idr` and `leaderboard_idr` are stored separately. `GET /api/events/{event_id}/leaderboard` never returns `actual_spent_idr`, and `GET /api/events` masks `actual_spent_idr` and `admin_void_pin` for non-owners/non-organizers.
- **Atomic Checkout & Idempotency:** `POST /api/pos/checkout` runs inside a PostgreSQL transaction (`FOR UPDATE` row locks) keyed by `client_tx_id` (`transaction_uuid` alias supported) so offline queue replays never double-charge or double-award stamps, while enforcing a 10-second duplicate-scan cooldown per attendee + booth.
- **PIN-Verified Reversals:** `POST /api/pos/reverse` verifies the booth `admin_void_pin`, restores `actual_spent_idr` and `leaderboard_idr`, and revokes stamps if remaining booth spend drops below `min_spend_for_stamp`.
- **Single-Claim Tickets:** `POST /api/events/{event_id}/check-in` locks ticket codes (`TKT-DEMO-BYR`, `TKT-DEMO-SLR`, and organizer-generated batches) with `FOR UPDATE` and mints unique `EV-XXXXXX` Event Pass IDs.
