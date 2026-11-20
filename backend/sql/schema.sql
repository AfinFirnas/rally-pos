-- ============================================================================
-- RallyPOS Standalone PostgreSQL 16+ Schema
-- Tables, Constraints, Partial Unique Indexes & Triggers
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. USERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_merchant BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    active_view_mode TEXT NOT NULL DEFAULT 'buyer'
        CHECK (active_view_mode IN ('buyer', 'merchant')),
    merchant_brand_name TEXT,
    merchant_bio TEXT,
    lifetime_actual_spent_idr BIGINT NOT NULL DEFAULT 0
        CHECK (lifetime_actual_spent_idr >= 0),
    lifetime_sales_idr BIGINT NOT NULL DEFAULT 0
        CHECK (lifetime_sales_idr >= 0),
    events_count INTEGER NOT NULL DEFAULT 0
        CHECK (events_count >= 0),
    earned_badges TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_merchant_mode_requires_merchant
        CHECK (active_view_mode = 'buyer' OR is_merchant = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON public.users (LOWER(username));

-- ----------------------------------------------------------------------------
-- 2. EVENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'archived')),
    min_stamp_spend_idr BIGINT NOT NULL DEFAULT 20000
        CHECK (min_stamp_spend_idr >= 0),
    admin_void_pin TEXT NOT NULL
        CHECK (char_length(admin_void_pin) >= 4),
    cold_bounty_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.50
        CHECK (cold_bounty_multiplier >= 1.00),
    hidden_bounty_bonus_idr BIGINT NOT NULL DEFAULT 25000
        CHECK (hidden_bounty_bonus_idr >= 0),
    venue_zones TEXT[] NOT NULL DEFAULT ARRAY[
        'Main Stage',
        'Photo Zone A',
        'Photo Zone B',
        'Cosplay Lounge',
        'Food Court'
    ]::TEXT[],
    event_date TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_status ON public.events (status, started_at DESC);

-- ----------------------------------------------------------------------------
-- 3. EVENT TICKET CODES (Single-Claim)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_uids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    uid_code TEXT NOT NULL UNIQUE,
    role_type TEXT NOT NULL
        CHECK (role_type IN ('buyer', 'merchant')),
    claimed_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ticket_claim_pair
        CHECK (
            (claimed_by_user_id IS NULL AND claimed_at IS NULL)
            OR (claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_ticket_uids_event_code
    ON public.ticket_uids (event_id, UPPER(uid_code));
CREATE INDEX IF NOT EXISTS idx_ticket_uids_unclaimed
    ON public.ticket_uids (event_id, role_type)
    WHERE claimed_by_user_id IS NULL;

-- ----------------------------------------------------------------------------
-- 4. EVENT PARTICIPANTS (Attendee Passes & Dual-IDR Balances)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    qr_code TEXT NOT NULL
        CHECK (qr_code ~ '^EV-[A-Z0-9]{6}$'),
    actual_spent_idr BIGINT NOT NULL DEFAULT 0
        CHECK (actual_spent_idr >= 0),
    leaderboard_idr BIGINT NOT NULL DEFAULT 0
        CHECK (leaderboard_idr >= 0),
    streak_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_participant_event_user UNIQUE (event_id, user_id),
    CONSTRAINT uq_participant_event_qr UNIQUE (event_id, qr_code)
);

CREATE INDEX IF NOT EXISTS idx_event_participants_leaderboard
    ON public.event_participants (event_id, leaderboard_idr DESC, updated_at ASC);
CREATE INDEX IF NOT EXISTS idx_event_participants_qr
    ON public.event_participants (event_id, UPPER(qr_code));

-- ----------------------------------------------------------------------------
-- 5. TENANTS (Booths per Event)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    booth_number TEXT NOT NULL,
    booth_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    stamp_image_url TEXT NOT NULL DEFAULT '',
    event_sales_idr BIGINT NOT NULL DEFAULT 0
        CHECK (event_sales_idr >= 0),
    unique_stamps_count INTEGER NOT NULL DEFAULT 0
        CHECK (unique_stamps_count >= 0),
    is_cold_bounty BOOLEAN NOT NULL DEFAULT FALSE,
    cold_bounty_expires_at TIMESTAMPTZ,
    cold_bounty_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.50
        CHECK (cold_bounty_multiplier >= 1.00),
    is_hidden_bounty BOOLEAN NOT NULL DEFAULT FALSE,
    hidden_bounty_bonus_idr BIGINT NOT NULL DEFAULT 25000
        CHECK (hidden_bounty_bonus_idr >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_event_user UNIQUE (event_id, user_id),
    CONSTRAINT uq_tenant_event_booth UNIQUE (event_id, booth_number)
);

CREATE INDEX IF NOT EXISTS idx_tenants_cold_radar
    ON public.tenants (event_id, unique_stamps_count ASC, booth_number ASC);
CREATE INDEX IF NOT EXISTS idx_tenants_user
    ON public.tenants (user_id, event_id);

-- ----------------------------------------------------------------------------
-- 6. TENANT ITEMS (Quick-Tap POS Catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    price_idr BIGINT NOT NULL
        CHECK (price_idr > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_items_tenant
    ON public.tenant_items (tenant_id, is_active, sort_order ASC);

-- ----------------------------------------------------------------------------
-- 7. STAMPS (Check-In #1 + Unique Booth Stamps)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stamps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.event_participants (id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    stamp_type TEXT NOT NULL
        CHECK (stamp_type IN ('checkin', 'booth')),
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stamp_type_tenant
        CHECK (
            (stamp_type = 'checkin' AND tenant_id IS NULL)
            OR (stamp_type = 'booth' AND tenant_id IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stamps_checkin_per_participant
    ON public.stamps (participant_id)
    WHERE stamp_type = 'checkin';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stamps_booth_per_participant
    ON public.stamps (participant_id, tenant_id)
    WHERE stamp_type = 'booth' AND tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stamps_event_participant
    ON public.stamps (event_id, participant_id);

-- ----------------------------------------------------------------------------
-- 8. TRANSACTIONS (Idempotent Dual-IDR Master Ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_tx_id TEXT UNIQUE,
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.event_participants (id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
    actual_amount_idr BIGINT NOT NULL
        CHECK (actual_amount_idr > 0),
    leaderboard_amount_idr BIGINT NOT NULL
        CHECK (leaderboard_amount_idr >= actual_amount_idr),
    multiplier_applied NUMERIC(5, 2) NOT NULL DEFAULT 1.00
        CHECK (multiplier_applied >= 1.00),
    hit_hidden_bounty BOOLEAN NOT NULL DEFAULT FALSE,
    hidden_bounty_bonus_idr BIGINT NOT NULL DEFAULT 0
        CHECK (hidden_bounty_bonus_idr >= 0),
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('completed', 'voided')),
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason TEXT,
    item_summary JSONB,
    voided_at TIMESTAMPTZ,
    voided_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_cooldown
    ON public.transactions (event_id, participant_id, tenant_id, created_at DESC)
    WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_transactions_streak_window
    ON public.transactions (event_id, participant_id, created_at DESC)
    WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_analytics
    ON public.transactions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_flagged
    ON public.transactions (event_id, created_at DESC)
    WHERE is_flagged = TRUE;

-- ----------------------------------------------------------------------------
-- 9. EVENT CHAT MESSAGES (Announcements & Cosplay/Meetup Board)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    sender_username TEXT NOT NULL,
    sender_role TEXT NOT NULL
        CHECK (sender_role IN ('organizer', 'buyer', 'merchant')),
    message_type TEXT NOT NULL
        CHECK (message_type IN ('admin_announcement', 'looking_for')),
    announcement_text TEXT,
    target_character TEXT,
    target_location TEXT,
    target_activity TEXT,
    interested_user_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_chat_anti_spam_structure
        CHECK (
            (
                message_type = 'admin_announcement'
                AND sender_role = 'organizer'
                AND announcement_text IS NOT NULL
                AND char_length(btrim(announcement_text)) > 0
                AND target_character IS NULL
                AND target_location IS NULL
                AND target_activity IS NULL
            )
            OR
            (
                message_type = 'looking_for'
                AND announcement_text IS NULL
                AND target_character IS NOT NULL
                AND char_length(btrim(target_character)) > 0
                AND target_location IS NOT NULL
                AND char_length(btrim(target_location)) > 0
                AND target_activity IS NOT NULL
                AND char_length(btrim(target_activity)) > 0
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_chat_event_created
    ON public.event_chat_messages (event_id, is_pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_interested_gin
    ON public.event_chat_messages USING GIN (interested_user_ids);

-- ----------------------------------------------------------------------------
-- UPDATED_AT TRIGGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_participants_updated_at ON public.event_participants;
CREATE TRIGGER trg_event_participants_updated_at
    BEFORE UPDATE ON public.event_participants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
