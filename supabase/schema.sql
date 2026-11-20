-- ============================================================================
-- EVENT POS, DIGITAL STAMP RALLY & DUAL-IDR LEADERBOARD SCHEMA
-- PostgreSQL / Supabase Production DDL
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. USERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT 'SUPABASE_AUTH_MANAGED',
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

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (LOWER(username));

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
    cold_bounty_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.25
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
-- 3. TICKET UIDS
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
-- 4. EVENT PARTICIPANTS (Buyers per Event)
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
CREATE INDEX IF NOT EXISTS idx_event_participants_user
    ON public.event_participants (user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_qr
    ON public.event_participants (event_id, qr_code);

-- ----------------------------------------------------------------------------
-- 5. TENANTS (Merchants / Booths per Event)
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
    cold_bounty_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.25
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
-- 7. STAMPS (Check-In #1 + Booth Stamps)
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
CREATE INDEX IF NOT EXISTS idx_stamps_tenant
    ON public.stamps (tenant_id)
    WHERE tenant_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. TRANSACTIONS (Dual-IDR Master Ledger)
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

CREATE INDEX IF NOT EXISTS idx_transactions_event_created
    ON public.transactions (event_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 9. EVENT CHAT MESSAGES (Role-Enforced Anti-Spam Structured Chat)
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

-- ============================================================================
-- UPDATED_AT & SECURITY TRIGGERS
-- ============================================================================

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

-- Helper predicates (SECURITY DEFINER avoids infinite RLS recursion)
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = auth.uid()
          AND is_admin = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.is_event_participant(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.event_participants
        WHERE event_id = p_event_id
          AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_event_merchant(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE event_id = p_event_id
          AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_event_member(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_app_admin()
        OR public.is_event_participant(p_event_id)
        OR public.is_event_merchant(p_event_id);
$$;

-- Prevent authenticated non-admin clients from tampering with privileged columns on users
CREATE OR REPLACE FUNCTION public.guard_user_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_app_admin() THEN
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
           OR NEW.lifetime_actual_spent_idr IS DISTINCT FROM OLD.lifetime_actual_spent_idr
           OR NEW.lifetime_sales_idr IS DISTINCT FROM OLD.lifetime_sales_idr
           OR NEW.events_count IS DISTINCT FROM OLD.events_count
           OR NEW.earned_badges IS DISTINCT FROM OLD.earned_badges THEN
            RAISE EXCEPTION 'Unauthorized modification of protected user profile metrics';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_sensitive_columns ON public.users;
CREATE TRIGGER trg_guard_user_sensitive_columns
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.guard_user_sensitive_columns();

-- Auto-create public.users profile when a user registers via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_username TEXT;
BEGIN
    v_username := COALESCE(
        NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), ''),
        split_part(NEW.email, '@', 1) || '_' || substr(NEW.id::TEXT, 1, 4)
    );

    INSERT INTO public.users (id, email, username, password_hash, active_view_mode)
    VALUES (NEW.id, NEW.email, v_username, 'SUPABASE_AUTH_MANAGED', 'buyer')
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Safe creation if auth schema exists (standard in Supabase)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
    END IF;
END;
$$;

-- ============================================================================
-- PRIVACY-SAFE LEADERBOARD VIEW (Exposes ONLY leaderboard_idr, NEVER actual_spent_idr)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_event_leaderboard
WITH (security_invoker = FALSE)
AS
SELECT
    ep.id AS participant_id,
    ep.event_id,
    ep.user_id,
    u.username,
    ep.leaderboard_idr,
    ep.streak_expires_at,
    COALESCE(sc.stamps_count, 0)::INTEGER AS stamps_count,
    DENSE_RANK() OVER (
        PARTITION BY ep.event_id
        ORDER BY ep.leaderboard_idr DESC, COALESCE(sc.stamps_count, 0) DESC, ep.created_at ASC
    )::INTEGER AS rank_position
FROM public.event_participants ep
JOIN public.users u ON u.id = ep.user_id
LEFT JOIN (
    SELECT participant_id, COUNT(*)::INTEGER AS stamps_count
    FROM public.stamps
    GROUP BY participant_id
) sc ON sc.participant_id = ep.id;

GRANT SELECT ON public.v_event_leaderboard TO authenticated;

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES FOR ALL 9 TABLES
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_uids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_chat_messages ENABLE ROW LEVEL SECURITY;

-- 1. users policies
DROP POLICY IF EXISTS users_select_own_or_admin ON public.users;
CREATE POLICY users_select_own_or_admin ON public.users
    FOR SELECT
    USING (id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users
    FOR INSERT
    WITH CHECK (id = auth.uid() AND is_admin = FALSE);

DROP POLICY IF EXISTS users_update_own_or_admin ON public.users;
CREATE POLICY users_update_own_or_admin ON public.users
    FOR UPDATE
    USING (id = auth.uid() OR public.is_app_admin())
    WITH CHECK (id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS users_delete_admin_only ON public.users;
CREATE POLICY users_delete_admin_only ON public.users
    FOR DELETE
    USING (public.is_app_admin());

-- 2. events policies
DROP POLICY IF EXISTS events_select_public_or_admin ON public.events;
CREATE POLICY events_select_public_or_admin ON public.events
    FOR SELECT
    USING (status IN ('active', 'archived') OR public.is_app_admin());

DROP POLICY IF EXISTS events_admin_insert ON public.events;
CREATE POLICY events_admin_insert ON public.events
    FOR INSERT
    WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS events_admin_update ON public.events;
CREATE POLICY events_admin_update ON public.events
    FOR UPDATE
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS events_admin_delete ON public.events;
CREATE POLICY events_admin_delete ON public.events
    FOR DELETE
    USING (public.is_app_admin());

-- 3. ticket_uids policies
DROP POLICY IF EXISTS ticket_uids_select_own_or_admin ON public.ticket_uids;
CREATE POLICY ticket_uids_select_own_or_admin ON public.ticket_uids
    FOR SELECT
    USING (claimed_by_user_id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS ticket_uids_admin_insert ON public.ticket_uids;
CREATE POLICY ticket_uids_admin_insert ON public.ticket_uids
    FOR INSERT
    WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS ticket_uids_admin_update ON public.ticket_uids;
CREATE POLICY ticket_uids_admin_update ON public.ticket_uids
    FOR UPDATE
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS ticket_uids_admin_delete ON public.ticket_uids;
CREATE POLICY ticket_uids_admin_delete ON public.ticket_uids
    FOR DELETE
    USING (public.is_app_admin());

-- 4. event_participants policies
-- Private actual_spent_idr is strictly restricted to the owning buyer & admins.
-- Public rankings use v_event_leaderboard; POS QR verification uses lookup_participant_by_qr RPC.
DROP POLICY IF EXISTS participants_select_own_or_admin ON public.event_participants;
CREATE POLICY participants_select_own_or_admin ON public.event_participants
    FOR SELECT
    USING (user_id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS participants_admin_manage ON public.event_participants;
CREATE POLICY participants_admin_manage ON public.event_participants
    FOR ALL
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

-- 5. tenants policies
DROP POLICY IF EXISTS tenants_select_event_or_admin ON public.tenants;
CREATE POLICY tenants_select_event_or_admin ON public.tenants
    FOR SELECT
    USING (
        public.is_app_admin()
        OR EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = tenants.event_id AND e.status IN ('active', 'archived')
        )
    );

DROP POLICY IF EXISTS tenants_update_owner_or_admin ON public.tenants;
CREATE POLICY tenants_update_owner_or_admin ON public.tenants
    FOR UPDATE
    USING (user_id = auth.uid() OR public.is_app_admin())
    WITH CHECK (user_id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS tenants_admin_insert ON public.tenants;
CREATE POLICY tenants_admin_insert ON public.tenants
    FOR INSERT
    WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS tenants_admin_delete ON public.tenants;
CREATE POLICY tenants_admin_delete ON public.tenants
    FOR DELETE
    USING (public.is_app_admin());

-- 6. tenant_items policies
DROP POLICY IF EXISTS tenant_items_select_visible ON public.tenant_items;
CREATE POLICY tenant_items_select_visible ON public.tenant_items
    FOR SELECT
    USING (
        public.is_app_admin()
        OR EXISTS (
            SELECT 1
            FROM public.tenants t
            JOIN public.events e ON e.id = t.event_id
            WHERE t.id = tenant_items.tenant_id
              AND e.status IN ('active', 'archived')
        )
    );

DROP POLICY IF EXISTS tenant_items_manage_owner_or_admin ON public.tenant_items;
CREATE POLICY tenant_items_manage_owner_or_admin ON public.tenant_items
    FOR ALL
    USING (
        public.is_app_admin()
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = tenant_items.tenant_id AND t.user_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_app_admin()
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = tenant_items.tenant_id AND t.user_id = auth.uid()
        )
    );

-- 7. stamps policies
DROP POLICY IF EXISTS stamps_select_own_tenant_or_admin ON public.stamps;
CREATE POLICY stamps_select_own_tenant_or_admin ON public.stamps
    FOR SELECT
    USING (
        public.is_app_admin()
        OR EXISTS (
            SELECT 1 FROM public.event_participants ep
            WHERE ep.id = stamps.participant_id AND ep.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = stamps.tenant_id AND t.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS stamps_admin_manage ON public.stamps;
CREATE POLICY stamps_admin_manage ON public.stamps
    FOR ALL
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

-- 8. transactions policies
DROP POLICY IF EXISTS transactions_select_party_or_admin ON public.transactions;
CREATE POLICY transactions_select_party_or_admin ON public.transactions
    FOR SELECT
    USING (
        public.is_app_admin()
        OR EXISTS (
            SELECT 1 FROM public.event_participants ep
            WHERE ep.id = transactions.participant_id AND ep.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = transactions.tenant_id AND t.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS transactions_admin_manage ON public.transactions;
CREATE POLICY transactions_admin_manage ON public.transactions
    FOR ALL
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

-- 9. event_chat_messages policies
DROP POLICY IF EXISTS chat_select_event_members ON public.event_chat_messages;
CREATE POLICY chat_select_event_members ON public.event_chat_messages
    FOR SELECT
    USING (public.is_event_member(event_id));

DROP POLICY IF EXISTS chat_insert_role_enforced ON public.event_chat_messages;
CREATE POLICY chat_insert_role_enforced ON public.event_chat_messages
    FOR INSERT
    WITH CHECK (
        sender_user_id = auth.uid()
        AND public.is_event_member(event_id)
        AND (
            (message_type = 'admin_announcement' AND sender_role = 'organizer' AND public.is_app_admin())
            OR
            (
                message_type = 'looking_for'
                AND (
                    (sender_role = 'buyer' AND public.is_event_participant(event_id))
                    OR (sender_role = 'merchant' AND public.is_event_merchant(event_id))
                    OR (sender_role = 'organizer' AND public.is_app_admin())
                )
            )
        )
    );

DROP POLICY IF EXISTS chat_delete_sender_or_admin ON public.event_chat_messages;
CREATE POLICY chat_delete_sender_or_admin ON public.event_chat_messages
    FOR DELETE
    USING (sender_user_id = auth.uid() OR public.is_app_admin());

-- ============================================================================
-- ATOMIC SERVER-SIDE RPC FUNCTIONS (TICKET GATE, CHECKOUT, PIN VOID, CHAT PING)
-- ============================================================================

-- Cryptographic non-sequential EV-XXXXXX QR generator
CREATE OR REPLACE FUNCTION public.generate_event_qr_code(p_event_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    v_bytes BYTEA;
    v_code TEXT;
    i INTEGER;
    v_attempts INTEGER := 0;
BEGIN
    LOOP
        v_attempts := v_attempts + 1;
        IF v_attempts > 25 THEN
            RAISE EXCEPTION 'Unable to generate unique QR code after 25 attempts';
        END IF;

        v_bytes := gen_random_bytes(6);
        v_code := 'EV-';
        FOR i IN 0..5 LOOP
            v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
        END LOOP;

        IF NOT EXISTS (
            SELECT 1 FROM public.event_participants
            WHERE event_id = p_event_id AND qr_code = v_code
        ) THEN
            RETURN v_code;
        END IF;
    END LOOP;
END;
$$;

-- Claim a Buyer or Merchant Ticket UID to join an event
CREATE OR REPLACE FUNCTION public.claim_ticket_uid(
    p_event_id UUID,
    p_uid_code TEXT,
    p_booth_name TEXT DEFAULT NULL,
    p_booth_number TEXT DEFAULT NULL,
    p_booth_bio TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ticket public.ticket_uids%ROWTYPE;
    v_event public.events%ROWTYPE;
    v_qr TEXT;
    v_participant_id UUID;
    v_tenant_id UUID;
    v_is_new_membership BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
    IF NOT FOUND OR v_event.status <> 'active' THEN
        RAISE EXCEPTION 'Event is not active for ticket registration';
    END IF;

    SELECT * INTO v_ticket
    FROM public.ticket_uids
    WHERE event_id = p_event_id
      AND UPPER(uid_code) = UPPER(btrim(p_uid_code))
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid Ticket UID for this event';
    END IF;

    IF v_ticket.claimed_by_user_id IS NOT NULL AND v_ticket.claimed_by_user_id <> v_user_id THEN
        RAISE EXCEPTION 'Ticket UID has already been claimed by another account';
    END IF;

    IF v_ticket.claimed_by_user_id IS NULL THEN
        UPDATE public.ticket_uids
        SET claimed_by_user_id = v_user_id,
            claimed_at = NOW()
        WHERE id = v_ticket.id;
    END IF;

    IF v_ticket.role_type = 'buyer' THEN
        SELECT id, qr_code INTO v_participant_id, v_qr
        FROM public.event_participants
        WHERE event_id = p_event_id AND user_id = v_user_id;

        IF v_participant_id IS NULL THEN
            v_is_new_membership := TRUE;
            v_qr := public.generate_event_qr_code(p_event_id);

            INSERT INTO public.event_participants (event_id, user_id, qr_code)
            VALUES (p_event_id, v_user_id, v_qr)
            RETURNING id INTO v_participant_id;

            -- Unlock Stamp #1 (Event Check-In) automatically
            INSERT INTO public.stamps (event_id, participant_id, tenant_id, stamp_type)
            VALUES (p_event_id, v_participant_id, NULL, 'checkin')
            ON CONFLICT DO NOTHING;

            UPDATE public.users
            SET events_count = events_count + 1
            WHERE id = v_user_id;
        END IF;

        RETURN jsonb_build_object(
            'role_type', 'buyer',
            'participant_id', v_participant_id,
            'qr_code', v_qr,
            'is_new_membership', v_is_new_membership
        );
    ELSE
        -- Merchant ticket: also unlocks buyer participant profile if not yet enrolled,
        -- upgrades user.is_merchant = TRUE, and creates their event booth tenant.
        UPDATE public.users
        SET is_merchant = TRUE,
            merchant_brand_name = COALESCE(NULLIF(btrim(p_booth_name), ''), merchant_brand_name, username),
            merchant_bio = COALESCE(NULLIF(btrim(p_booth_bio), ''), merchant_bio)
        WHERE id = v_user_id;

        SELECT id INTO v_tenant_id
        FROM public.tenants
        WHERE event_id = p_event_id AND user_id = v_user_id;

        IF v_tenant_id IS NULL THEN
            v_is_new_membership := TRUE;
            INSERT INTO public.tenants (
                event_id,
                user_id,
                booth_number,
                booth_name,
                description
            )
            VALUES (
                p_event_id,
                v_user_id,
                COALESCE(NULLIF(btrim(p_booth_number), ''), 'B-' || substr(v_user_id::TEXT, 1, 3)),
                COALESCE(NULLIF(btrim(p_booth_name), ''), (SELECT username || '''s Booth' FROM public.users WHERE id = v_user_id)),
                COALESCE(p_booth_bio, '')
            )
            RETURNING id INTO v_tenant_id;
        END IF;

        RETURN jsonb_build_object(
            'role_type', 'merchant',
            'tenant_id', v_tenant_id,
            'is_new_membership', v_is_new_membership
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_ticket_uid(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Privacy-safe QR lookup for Merchants at POS (never exposes buyer's private actual_spent_idr)
CREATE OR REPLACE FUNCTION public.lookup_participant_by_qr(
    p_event_id UUID,
    p_qr_code TEXT,
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_participant public.event_participants%ROWTYPE;
    v_username TEXT;
    v_last_same_booth TIMESTAMPTZ;
    v_cooldown_remaining INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.is_app_admin() AND NOT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = p_tenant_id AND event_id = p_event_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized booth scanner';
    END IF;

    SELECT * INTO v_participant
    FROM public.event_participants
    WHERE event_id = p_event_id
      AND UPPER(qr_code) = UPPER(btrim(p_qr_code));

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT username INTO v_username FROM public.users WHERE id = v_participant.user_id;

    SELECT MAX(created_at) INTO v_last_same_booth
    FROM public.transactions
    WHERE event_id = p_event_id
      AND participant_id = v_participant.id
      AND tenant_id = p_tenant_id
      AND status = 'completed';

    IF v_last_same_booth IS NOT NULL THEN
        v_cooldown_remaining := GREATEST(0, 180 - FLOOR(EXTRACT(EPOCH FROM (NOW() - v_last_same_booth)))::INTEGER);
    END IF;

    RETURN jsonb_build_object(
        'participant_id', v_participant.id,
        'user_id', v_participant.user_id,
        'username', v_username,
        'qr_code', v_participant.qr_code,
        'leaderboard_idr', v_participant.leaderboard_idr,
        'streak_expires_at', v_participant.streak_expires_at,
        'cooldown_remaining_seconds', v_cooldown_remaining,
        'has_booth_stamp', EXISTS (
            SELECT 1 FROM public.stamps
            WHERE participant_id = v_participant.id AND tenant_id = p_tenant_id
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_participant_by_qr(UUID, TEXT, UUID) TO authenticated;

-- Atomic Dual-IDR POS Checkout RPC (enforces cooldown, streak, cold bounty, hidden bounty & idempotency)
CREATE OR REPLACE FUNCTION public.process_pos_checkout(
    p_event_id UUID,
    p_tenant_id UUID,
    p_buyer_qr_code TEXT,
    p_actual_amount_idr BIGINT,
    p_client_tx_id TEXT DEFAULT NULL,
    p_item_summary JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_event public.events%ROWTYPE;
    v_tenant public.tenants%ROWTYPE;
    v_participant public.event_participants%ROWTYPE;
    v_existing_tx public.transactions%ROWTYPE;
    v_last_same_booth TIMESTAMPTZ;
    v_last_other_booth TIMESTAMPTZ;
    v_recent_burst_count INTEGER := 0;
    v_distinct_booths_60m INTEGER := 0;
    v_streak_active BOOLEAN := FALSE;
    v_cold_bounty_active BOOLEAN := FALSE;
    v_streak_bonus NUMERIC(5, 2) := 0.00;
    v_cold_bonus NUMERIC(5, 2) := 0.00;
    v_multiplier NUMERIC(5, 2) := 1.00;
    v_hidden_bonus_idr BIGINT := 0;
    v_hit_hidden_bounty BOOLEAN := FALSE;
    v_leaderboard_amount_idr BIGINT;
    v_new_streak_expires TIMESTAMPTZ;
    v_is_flagged BOOLEAN := FALSE;
    v_flag_reasons TEXT[] := '{}'::TEXT[];
    v_stamp_unlocked BOOLEAN := FALSE;
    v_tx_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_actual_amount_idr IS NULL OR p_actual_amount_idr <= 0 THEN
        RAISE EXCEPTION 'Transaction amount must be greater than Rp 0';
    END IF;

    -- Idempotency check for offline queue replay
    IF p_client_tx_id IS NOT NULL THEN
        SELECT * INTO v_existing_tx
        FROM public.transactions
        WHERE client_tx_id = p_client_tx_id;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'idempotent_replay', TRUE,
                'transaction_id', v_existing_tx.id,
                'actual_amount_idr', v_existing_tx.actual_amount_idr,
                'leaderboard_amount_idr', v_existing_tx.leaderboard_amount_idr,
                'multiplier_applied', v_existing_tx.multiplier_applied,
                'hit_hidden_bounty', v_existing_tx.hit_hidden_bounty
            );
        END IF;
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
    IF NOT FOUND OR v_event.status <> 'active' THEN
        RAISE EXCEPTION 'Event is not active';
    END IF;

    SELECT * INTO v_tenant
    FROM public.tenants
    WHERE id = p_tenant_id AND event_id = p_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booth not found in this event';
    END IF;

    IF NOT public.is_app_admin() AND v_tenant.user_id <> v_user_id THEN
        RAISE EXCEPTION 'Unauthorized POS terminal access';
    END IF;

    SELECT * INTO v_participant
    FROM public.event_participants
    WHERE event_id = p_event_id AND UPPER(qr_code) = UPPER(btrim(p_buyer_qr_code))
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Buyer QR code not registered in this event';
    END IF;

    -- 1. Enforce 180-second (3-minute) same-booth cooldown
    SELECT MAX(created_at) INTO v_last_same_booth
    FROM public.transactions
    WHERE event_id = p_event_id
      AND participant_id = v_participant.id
      AND tenant_id = p_tenant_id
      AND status = 'completed';

    IF v_last_same_booth IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - v_last_same_booth)) < 180 THEN
        RAISE EXCEPTION 'COOLDOWN_ACTIVE:%', CEIL(180 - EXTRACT(EPOCH FROM (NOW() - v_last_same_booth)))::INTEGER;
    END IF;

    -- 2. Rapid-fire cross-booth scan anomaly detection
    SELECT MAX(created_at) INTO v_last_other_booth
    FROM public.transactions
    WHERE event_id = p_event_id
      AND participant_id = v_participant.id
      AND tenant_id <> p_tenant_id
      AND status = 'completed';

    IF v_last_other_booth IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - v_last_other_booth)) < 20 THEN
        v_is_flagged := TRUE;
        v_flag_reasons := array_append(v_flag_reasons, 'RAPID_CROSS_BOOTH_SCAN (<20s)');
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_recent_burst_count
    FROM public.transactions
    WHERE event_id = p_event_id
      AND participant_id = v_participant.id
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '120 seconds';

    IF v_recent_burst_count >= 3 THEN
        v_is_flagged := TRUE;
        v_flag_reasons := array_append(v_flag_reasons, 'RAPID_FIRE_SCAN_BURST (4+ scans in 2m)');
    END IF;

    IF p_actual_amount_idr >= 10000000 THEN
        v_is_flagged := TRUE;
        v_flag_reasons := array_append(v_flag_reasons, 'HIGH_VALUE_TRANSACTION (>= Rp 10.000.000)');
    END IF;

    -- 3. 60-minute Streak Engine (3 distinct booths within 60 minutes)
    SELECT COUNT(DISTINCT sub.tid)::INTEGER INTO v_distinct_booths_60m
    FROM (
        SELECT tenant_id AS tid
        FROM public.transactions
        WHERE event_id = p_event_id
          AND participant_id = v_participant.id
          AND status = 'completed'
          AND created_at >= NOW() - INTERVAL '60 minutes'
        UNION
        SELECT p_tenant_id AS tid
    ) sub;

    IF v_distinct_booths_60m >= 3 THEN
        v_streak_active := TRUE;
        v_new_streak_expires := NOW() + INTERVAL '60 minutes';
    ELSIF v_participant.streak_expires_at IS NOT NULL AND v_participant.streak_expires_at > NOW() THEN
        v_streak_active := TRUE;
        v_new_streak_expires := v_participant.streak_expires_at;
    ELSE
        v_streak_active := FALSE;
        v_new_streak_expires := NULL;
    END IF;

    IF v_streak_active THEN
        v_streak_bonus := 0.25;
    END IF;

    -- 4. Cold-Booth Bounty Multiplier
    IF v_tenant.is_cold_bounty AND (v_tenant.cold_bounty_expires_at IS NULL OR v_tenant.cold_bounty_expires_at > NOW()) THEN
        v_cold_bounty_active := TRUE;
        v_cold_bonus := GREATEST(0.00, v_tenant.cold_bounty_multiplier - 1.00);
    END IF;

    v_multiplier := 1.00 + v_streak_bonus + v_cold_bonus;

    -- 5. Hidden Bounty Check
    IF v_tenant.is_hidden_bounty THEN
        v_hit_hidden_bounty := TRUE;
        v_hidden_bonus_idr := COALESCE(v_tenant.hidden_bounty_bonus_idr, v_event.hidden_bounty_bonus_idr, 0);
    END IF;

    v_leaderboard_amount_idr := ROUND(p_actual_amount_idr * v_multiplier)::BIGINT + v_hidden_bonus_idr;

    -- 6. Insert Dual-IDR Transaction
    INSERT INTO public.transactions (
        client_tx_id,
        event_id,
        participant_id,
        tenant_id,
        actual_amount_idr,
        leaderboard_amount_idr,
        multiplier_applied,
        hit_hidden_bounty,
        hidden_bounty_bonus_idr,
        status,
        is_flagged,
        flag_reason,
        item_summary
    )
    VALUES (
        p_client_tx_id,
        p_event_id,
        v_participant.id,
        p_tenant_id,
        p_actual_amount_idr,
        v_leaderboard_amount_idr,
        v_multiplier,
        v_hit_hidden_bounty,
        v_hidden_bonus_idr,
        'completed',
        v_is_flagged,
        NULLIF(array_to_string(v_flag_reasons, '; '), ''),
        p_item_summary
    )
    RETURNING id INTO v_tx_id;

    -- 7. Update Participant Dual-IDR & Global Lifetime Totals
    UPDATE public.event_participants
    SET actual_spent_idr = actual_spent_idr + p_actual_amount_idr,
        leaderboard_idr = leaderboard_idr + v_leaderboard_amount_idr,
        streak_expires_at = v_new_streak_expires
    WHERE id = v_participant.id;

    UPDATE public.users
    SET lifetime_actual_spent_idr = lifetime_actual_spent_idr + p_actual_amount_idr
    WHERE id = v_participant.user_id;

    -- 8. Unlock Booth Stamp if >= min_stamp_spend_idr and not yet stamped
    IF p_actual_amount_idr >= v_event.min_stamp_spend_idr THEN
        INSERT INTO public.stamps (event_id, participant_id, tenant_id, stamp_type)
        VALUES (p_event_id, v_participant.id, p_tenant_id, 'booth')
        ON CONFLICT DO NOTHING;

        IF FOUND THEN
            v_stamp_unlocked := TRUE;
        END IF;
    END IF;

    -- 9. Update Tenant Real Sales & Stamp Count + Merchant Lifetime Sales
    UPDATE public.tenants
    SET event_sales_idr = event_sales_idr + p_actual_amount_idr,
        unique_stamps_count = unique_stamps_count + CASE WHEN v_stamp_unlocked THEN 1 ELSE 0 END
    WHERE id = p_tenant_id;

    UPDATE public.users
    SET lifetime_sales_idr = lifetime_sales_idr + p_actual_amount_idr
    WHERE id = v_tenant.user_id;

    RETURN jsonb_build_object(
        'idempotent_replay', FALSE,
        'transaction_id', v_tx_id,
        'actual_amount_idr', p_actual_amount_idr,
        'leaderboard_amount_idr', v_leaderboard_amount_idr,
        'multiplier_applied', v_multiplier,
        'hit_hidden_bounty', v_hit_hidden_bounty,
        'hidden_bounty_bonus_idr', v_hidden_bonus_idr,
        'stamp_unlocked', v_stamp_unlocked,
        'streak_expires_at', v_new_streak_expires,
        'is_flagged', v_is_flagged
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_pos_checkout(UUID, UUID, TEXT, BIGINT, TEXT, JSONB) TO authenticated;

-- PIN-Protected Void Transaction RPC (Reverses Dual-IDR, Lifetime Totals & Orphaned Stamp)
CREATE OR REPLACE FUNCTION public.void_pos_transaction(
    p_transaction_id UUID,
    p_admin_void_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_tx public.transactions%ROWTYPE;
    v_event public.events%ROWTYPE;
    v_tenant public.tenants%ROWTYPE;
    v_participant public.event_participants%ROWTYPE;
    v_has_qualifying_remaining BOOLEAN := FALSE;
    v_stamp_reversed BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_tx
    FROM public.transactions
    WHERE id = p_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction not found';
    END IF;

    IF v_tx.status = 'voided' THEN
        RAISE EXCEPTION 'Transaction is already voided';
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = v_tx.event_id;
    SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tx.tenant_id FOR UPDATE;
    SELECT * INTO v_participant FROM public.event_participants WHERE id = v_tx.participant_id FOR UPDATE;

    IF NOT public.is_app_admin() AND v_tenant.user_id <> v_user_id THEN
        RAISE EXCEPTION 'Unauthorized to void transactions for this booth';
    END IF;

    IF btrim(p_admin_void_pin) <> v_event.admin_void_pin THEN
        RAISE EXCEPTION 'INVALID_VOID_PIN';
    END IF;

    -- Mark transaction voided
    UPDATE public.transactions
    SET status = 'voided',
        voided_at = NOW(),
        voided_by_user_id = v_user_id
    WHERE id = v_tx.id;

    -- Deduct Dual-IDR totals safely
    UPDATE public.event_participants
    SET actual_spent_idr = GREATEST(0, actual_spent_idr - v_tx.actual_amount_idr),
        leaderboard_idr = GREATEST(0, leaderboard_idr - v_tx.leaderboard_amount_idr)
    WHERE id = v_participant.id;

    UPDATE public.users
    SET lifetime_actual_spent_idr = GREATEST(0, lifetime_actual_spent_idr - v_tx.actual_amount_idr)
    WHERE id = v_participant.user_id;

    -- Check if buyer still has any remaining completed transaction >= min_stamp_spend_idr at this booth
    SELECT EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE event_id = v_tx.event_id
          AND participant_id = v_tx.participant_id
          AND tenant_id = v_tx.tenant_id
          AND status = 'completed'
          AND actual_amount_idr >= v_event.min_stamp_spend_idr
    ) INTO v_has_qualifying_remaining;

    IF NOT v_has_qualifying_remaining THEN
        DELETE FROM public.stamps
        WHERE participant_id = v_tx.participant_id
          AND tenant_id = v_tx.tenant_id
          AND stamp_type = 'booth';

        IF FOUND THEN
            v_stamp_reversed := TRUE;
        END IF;
    END IF;

    UPDATE public.tenants
    SET event_sales_idr = GREATEST(0, event_sales_idr - v_tx.actual_amount_idr),
        unique_stamps_count = GREATEST(0, unique_stamps_count - CASE WHEN v_stamp_reversed THEN 1 ELSE 0 END)
    WHERE id = v_tenant.id;

    UPDATE public.users
    SET lifetime_sales_idr = GREATEST(0, lifetime_sales_idr - v_tx.actual_amount_idr)
    WHERE id = v_tenant.user_id;

    RETURN jsonb_build_object(
        'transaction_id', v_tx.id,
        'status', 'voided',
        'deducted_actual_idr', v_tx.actual_amount_idr,
        'deducted_leaderboard_idr', v_tx.leaderboard_amount_idr,
        'stamp_reversed', v_stamp_reversed
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_pos_transaction(UUID, TEXT) TO authenticated;

-- Toggle "I'm Here / Interested" ping on structured chat posts
CREATE OR REPLACE FUNCTION public.toggle_chat_interest(p_message_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_msg public.event_chat_messages%ROWTYPE;
    v_updated UUID[];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_msg
    FROM public.event_chat_messages
    WHERE id = p_message_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chat message not found';
    END IF;

    IF NOT public.is_event_member(v_msg.event_id) THEN
        RAISE EXCEPTION 'Must join this event hub to interact in group chat';
    END IF;

    IF v_user_id = ANY(v_msg.interested_user_ids) THEN
        v_updated := array_remove(v_msg.interested_user_ids, v_user_id);
    ELSE
        v_updated := array_append(v_msg.interested_user_ids, v_user_id);
    END IF;

    UPDATE public.event_chat_messages
    SET interested_user_ids = v_updated
    WHERE id = p_message_id;

    RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_chat_interest(UUID) TO authenticated;