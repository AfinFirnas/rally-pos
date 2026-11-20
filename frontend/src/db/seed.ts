import type {
  DemoSeedDataset,
  Event,
  EventChatMessage,
  EventParticipant,
  Stamp,
  Tenant,
  TenantItem,
  TicketUid,
  Transaction,
  User,
} from '../types/types';

// ============================================================================
// DETERMINISTIC UUIDs (RFC-4122 UUIDv4 formatted for PostgreSQL UUID columns)
// ============================================================================

const BASE_TIME_MS = new Date('2025-05-17T10:00:00.000Z').getTime();
const isoAtOffsetMinutes = (minutesOffset: number): string =>
  new Date(BASE_TIME_MS + minutesOffset * 60_000).toISOString();

const ARCHIVED_BASE_MS = new Date('2024-11-16T09:00:00.000Z').getTime();
const archivedIsoAtMinutes = (minutesOffset: number): string =>
  new Date(ARCHIVED_BASE_MS + minutesOffset * 60_000).toISOString();

// Inline crisp 1:1 SVG mascot/logo badges (zero broken external asset links)
function makeStampSvgDataUri(label: string, bgHex: string, accentHex: string, emoji: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="22" fill="${bgHex}"/><circle cx="60" cy="54" r="34" fill="${accentHex}" opacity="0.22"/><circle cx="60" cy="54" r="28" fill="none" stroke="${accentHex}" stroke-width="4" stroke-dasharray="6 4"/><text x="60" y="64" font-size="34" text-anchor="middle" dominant-baseline="middle">${emoji}</text><text x="60" y="103" font-family="system-ui,sans-serif" font-weight="800" font-size="11" fill="#ffffff" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Event IDs
export const EVENT_IDS = {
  ARCHIVED_CSF: '10000000-0000-4000-8000-000000000001',
  ACTIVE_COMIFURO: '10000000-0000-4000-8000-000000000002',
} as const;

// User IDs (1 Organizer + 8 Merchants + 15 Buyers)
export const USER_IDS = {
  ADMIN: '20000000-0000-4000-8000-000000000001',
  MERCHANT_01: '20000000-0000-4000-8000-000000000101',
  MERCHANT_02: '20000000-0000-4000-8000-000000000102',
  MERCHANT_03: '20000000-0000-4000-8000-000000000103',
  MERCHANT_04: '20000000-0000-4000-8000-000000000104',
  MERCHANT_05: '20000000-0000-4000-8000-000000000105',
  MERCHANT_06: '20000000-0000-4000-8000-000000000106',
  MERCHANT_07: '20000000-0000-4000-8000-000000000107',
  MERCHANT_08: '20000000-0000-4000-8000-000000000108',
  BUYER_01: '20000000-0000-4000-8000-000000000201',
  BUYER_02: '20000000-0000-4000-8000-000000000202',
  BUYER_03: '20000000-0000-4000-8000-000000000203',
  BUYER_04: '20000000-0000-4000-8000-000000000204',
  BUYER_05: '20000000-0000-4000-8000-000000000205',
  BUYER_06: '20000000-0000-4000-8000-000000000206',
  BUYER_07: '20000000-0000-4000-8000-000000000207',
  BUYER_08: '20000000-0000-4000-8000-000000000208',
  BUYER_09: '20000000-0000-4000-8000-000000000209',
  BUYER_10: '20000000-0000-4000-8000-000000000210',
  BUYER_11: '20000000-0000-4000-8000-000000000211',
  BUYER_12: '20000000-0000-4000-8000-000000000212',
  BUYER_13: '20000000-0000-4000-8000-000000000213',
  BUYER_14: '20000000-0000-4000-8000-000000000214',
  BUYER_15: '20000000-0000-4000-8000-000000000215',
} as const;

// Tenant IDs (2 archived + 8 active Comifuro Demo booths)
const ARCHIVED_TENANT_IDS = {
  AT01: '30000000-0000-4000-8000-000000000001',
  AT02: '30000000-0000-4000-8000-000000000002',
} as const;

export const TENANT_IDS = {
  T01: '30000000-0000-4000-8000-000000000101',
  T02: '30000000-0000-4000-8000-000000000102',
  T03: '30000000-0000-4000-8000-000000000103',
  T04: '30000000-0000-4000-8000-000000000104',
  T05: '30000000-0000-4000-8000-000000000105',
  T06: '30000000-0000-4000-8000-000000000106',
  T07: '30000000-0000-4000-8000-000000000107',
  T08: '30000000-0000-4000-8000-000000000108',
} as const;

// Participant IDs (3 archived + 15 active attendees)
const ARCHIVED_PARTICIPANT_IDS = {
  AP01: '40000000-0000-4000-8000-000000000001',
  AP02: '40000000-0000-4000-8000-000000000002',
  AP03: '40000000-0000-4000-8000-000000000003',
} as const;

export const PARTICIPANT_IDS = {
  P01: '40000000-0000-4000-8000-000000000201',
  P02: '40000000-0000-4000-8000-000000000202',
  P03: '40000000-0000-4000-8000-000000000203',
  P04: '40000000-0000-4000-8000-000000000204',
  P05: '40000000-0000-4000-8000-000000000205',
  P06: '40000000-0000-4000-8000-000000000206',
  P07: '40000000-0000-4000-8000-000000000207',
  P08: '40000000-0000-4000-8000-000000000208',
  P09: '40000000-0000-4000-8000-000000000209',
  P10: '40000000-0000-4000-8000-000000000210',
  P11: '40000000-0000-4000-8000-000000000211',
  P12: '40000000-0000-4000-8000-000000000212',
  P13: '40000000-0000-4000-8000-000000000213',
  P14: '40000000-0000-4000-8000-000000000214',
  P15: '40000000-0000-4000-8000-000000000215',
} as const;

// ----------------------------------------------------------------------------
// 1. EVENTS (1 Archived + 1 Active Comifuro Demo)
// ----------------------------------------------------------------------------

const SEED_EVENTS: Event[] = [
  {
    id: EVENT_IDS.ARCHIVED_CSF,
    name: 'Creators Super Fest 2024',
    description:
      'Jakarta flagship creator exhibition & cosplay rally (Archived historical standings).',
    status: 'archived',
    min_stamp_spend_idr: 25000,
    admin_void_pin: '882024',
    cold_bounty_multiplier: 1.25,
    hidden_bounty_bonus_idr: 25000,
    venue_zones: ['Main Stage', 'Creator Alley', 'Cosplay Zone'],
    event_date: archivedIsoAtMinutes(0),
    started_at: archivedIsoAtMinutes(0),
    ended_at: archivedIsoAtMinutes(600),
    created_by: USER_IDS.ADMIN,
    created_at: archivedIsoAtMinutes(-1440),
    updated_at: archivedIsoAtMinutes(600),
  },
  {
    id: EVENT_IDS.ACTIVE_COMIFURO,
    name: 'Comifuro Demo',
    description:
      'Live doujin, illustration, cosplay & indie merch rally powered by Dual-IDR POS tracking.',
    status: 'active',
    min_stamp_spend_idr: 20000,
    admin_void_pin: '123456',
    cold_bounty_multiplier: 1.25,
    hidden_bounty_bonus_idr: 25000,
    venue_zones: ['Main Stage', 'Photo Zone A', 'Photo Zone B', 'Cosplay Lounge', 'Food Court'],
    event_date: isoAtOffsetMinutes(0),
    started_at: isoAtOffsetMinutes(0),
    ended_at: null,
    created_by: USER_IDS.ADMIN,
    created_at: isoAtOffsetMinutes(-2880),
    updated_at: isoAtOffsetMinutes(180),
  },
];

// ----------------------------------------------------------------------------
// 2. BASE PARTICIPANTS & TENANTS (Totals computed deterministically from txns)
// ----------------------------------------------------------------------------

interface ParticipantBlueprint {
  id: string;
  event_id: string;
  user_id: string;
  qr_code: string;
  streak_expires_at: string | null;
  created_at: string;
}

const PARTICIPANT_BLUEPRINTS: ParticipantBlueprint[] = [
  // Archived Event Participants (Top 3)
  {
    id: ARCHIVED_PARTICIPANT_IDS.AP01,
    event_id: EVENT_IDS.ARCHIVED_CSF,
    user_id: USER_IDS.BUYER_01,
    qr_code: 'EV-CSF91K',
    streak_expires_at: null,
    created_at: archivedIsoAtMinutes(5),
  },
  {
    id: ARCHIVED_PARTICIPANT_IDS.AP02,
    event_id: EVENT_IDS.ARCHIVED_CSF,
    user_id: USER_IDS.BUYER_02,
    qr_code: 'EV-CSF48M',
    streak_expires_at: null,
    created_at: archivedIsoAtMinutes(10),
  },
  {
    id: ARCHIVED_PARTICIPANT_IDS.AP03,
    event_id: EVENT_IDS.ARCHIVED_CSF,
    user_id: USER_IDS.BUYER_04,
    qr_code: 'EV-CSF27P',
    streak_expires_at: null,
    created_at: archivedIsoAtMinutes(15),
  },
  // Active Event: Comifuro Demo (15 Attendees)
  {
    id: PARTICIPANT_IDS.P01,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_01,
    qr_code: 'EV-9X4K2M',
    streak_expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    created_at: isoAtOffsetMinutes(5),
  },
  {
    id: PARTICIPANT_IDS.P02,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_02,
    qr_code: 'EV-7P3W8N',
    streak_expires_at: new Date(Date.now() + 38 * 60_000).toISOString(),
    created_at: isoAtOffsetMinutes(7),
  },
  {
    id: PARTICIPANT_IDS.P03,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_03,
    qr_code: 'EV-5H8Q4R',
    streak_expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
    created_at: isoAtOffsetMinutes(9),
  },
  {
    id: PARTICIPANT_IDS.P04,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_04,
    qr_code: 'EV-3M6V9T',
    streak_expires_at: new Date(Date.now() + 50 * 60_000).toISOString(),
    created_at: isoAtOffsetMinutes(12),
  },
  {
    id: PARTICIPANT_IDS.P05,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_05,
    qr_code: 'EV-8K2J7C',
    streak_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    created_at: isoAtOffsetMinutes(14),
  },
  {
    id: PARTICIPANT_IDS.P06,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_06,
    qr_code: 'EV-4D9F5B',
    streak_expires_at: new Date(Date.now() + 42 * 60_000).toISOString(),
    created_at: isoAtOffsetMinutes(18),
  },
  {
    id: PARTICIPANT_IDS.P07,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_07,
    qr_code: 'EV-6Z2X9Y',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(20),
  },
  {
    id: PARTICIPANT_IDS.P08,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_08,
    qr_code: 'EV-2L7N4G',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(24),
  },
  {
    id: PARTICIPANT_IDS.P09,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_09,
    qr_code: 'EV-9W5S3E',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(28),
  },
  {
    id: PARTICIPANT_IDS.P10,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_10,
    qr_code: 'EV-4R8T6U',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(32),
  },
  {
    id: PARTICIPANT_IDS.P11,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_11,
    qr_code: 'EV-7B3C5V',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(36),
  },
  {
    id: PARTICIPANT_IDS.P12,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_12,
    qr_code: 'EV-5G9H2J',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(40),
  },
  {
    id: PARTICIPANT_IDS.P13,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_13,
    qr_code: 'EV-8P4M6K',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(45),
  },
  {
    id: PARTICIPANT_IDS.P14,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_14,
    qr_code: 'EV-3N7Y5Q',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(50),
  },
  {
    id: PARTICIPANT_IDS.P15,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.BUYER_15,
    qr_code: 'EV-6T2W8D',
    streak_expires_at: null,
    created_at: isoAtOffsetMinutes(55),
  },
];

interface TenantBlueprint {
  id: string;
  event_id: string;
  user_id: string;
  booth_number: string;
  booth_name: string;
  description: string;
  stamp_image_url: string;
  is_cold_bounty: boolean;
  cold_bounty_expires_at: string | null;
  cold_bounty_multiplier: number;
  is_hidden_bounty: boolean;
  hidden_bounty_bonus_idr: number;
  created_at: string;
}

const TENANT_BLUEPRINTS: TenantBlueprint[] = [
  // Archived Event Booths
  {
    id: ARCHIVED_TENANT_IDS.AT01,
    event_id: EVENT_IDS.ARCHIVED_CSF,
    user_id: USER_IDS.MERCHANT_01,
    booth_number: 'AA-01',
    booth_name: 'Kitsune Ink Studio',
    description: 'Original fox-spirit artbooks, holo prints & enamel pins.',
    stamp_image_url: makeStampSvgDataUri('KITSUNE', '#7C3AED', '#FDE047', '🦊'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: archivedIsoAtMinutes(-60),
  },
  {
    id: ARCHIVED_TENANT_IDS.AT02,
    event_id: EVENT_IDS.ARCHIVED_CSF,
    user_id: USER_IDS.MERCHANT_02,
    booth_number: 'AA-08',
    booth_name: 'Pixel Neko Merch',
    description: 'Retro pixel keychains, deskmats & apparel.',
    stamp_image_url: makeStampSvgDataUri('PIXEL NEKO', '#0F766E', '#5EEAD4', '🐱'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: archivedIsoAtMinutes(-60),
  },
  // Active Event: Comifuro Demo (8 Booths)
  {
    id: TENANT_IDS.T01,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_01,
    booth_number: 'A-01',
    booth_name: 'Kitsune Ink Studio',
    description: 'Hand-foiled artbooks, shikishi boards & limited holo sticker packs.',
    stamp_image_url: makeStampSvgDataUri('KITSUNE', '#7C3AED', '#FDE047', '🦊'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T02,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_02,
    booth_number: 'A-04',
    booth_name: 'Pixel Neko Merch',
    description: 'Pixel-art acrylic standees, XL mousepads & oversized cotton tees.',
    stamp_image_url: makeStampSvgDataUri('PIXEL NEKO', '#0F766E', '#5EEAD4', '🐱'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T03,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_03,
    booth_number: 'B-07',
    booth_name: 'Mecha Forge Workshop',
    description: '3D-printed mecha busts, resin model kits & metallic decals.',
    stamp_image_url: makeStampSvgDataUri('MECHA', '#1E3A8A', '#60A5FA', '🤖'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: true,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T04,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_04,
    booth_number: 'B-12',
    booth_name: 'Starlight Cosplay Props',
    description: 'EVA-foam cosplay swords, LED hairpins & wig styling kits.',
    stamp_image_url: makeStampSvgDataUri('STARLIGHT', '#BE185D', '#F9A8D4', '⚔️'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T05,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_05,
    booth_number: 'C-03',
    booth_name: 'Matcha & Manga Cafe',
    description: 'Cold-whisked Uji matcha, dorayaki & cozy manga zines.',
    stamp_image_url: makeStampSvgDataUri('MATCHA', '#15803D', '#BEF264', '🍵'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: true,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T06,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_06,
    booth_number: 'C-09',
    booth_name: 'Shibuya Vinyl & Pins',
    description: 'City-pop cassette tapes, anisong vinyls & hard-enamel badges.',
    stamp_image_url: makeStampSvgDataUri('SHIBUYA', '#B45309', '#FDE68A', '💿'),
    is_cold_bounty: true,
    cold_bounty_expires_at: new Date(Date.now() + 28 * 60_000).toISOString(),
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T07,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_07,
    booth_number: 'D-02',
    booth_name: 'Chibi Charm Atelier',
    description: 'Shaker keychains, holographic photocard holders & washi tapes.',
    stamp_image_url: makeStampSvgDataUri('CHIBI', '#9333EA', '#F5D0FE', '🎀'),
    is_cold_bounty: true,
    cold_bounty_expires_at: new Date(Date.now() + 28 * 60_000).toISOString(),
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: true,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
  {
    id: TENANT_IDS.T08,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    user_id: USER_IDS.MERCHANT_08,
    booth_number: 'D-15',
    booth_name: 'Retro Arcade Prints',
    description: 'Riso-printed game posters, CRT pixel zines & cartridge pins.',
    stamp_image_url: makeStampSvgDataUri('ARCADE', '#334155', '#38BDF8', '🕹️'),
    is_cold_bounty: false,
    cold_bounty_expires_at: null,
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: false,
    hidden_bounty_bonus_idr: 25000,
    created_at: isoAtOffsetMinutes(-60),
  },
];

// ----------------------------------------------------------------------------
// 3. TENANT ITEMS (Quick-Tap Catalog Buttons for All 8+2 Booths)
// ----------------------------------------------------------------------------

const itemId = (index: number): string =>
  `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const SEED_TENANT_ITEMS: TenantItem[] = [
  // Archived booth items
  {
    id: itemId(1),
    tenant_id: ARCHIVED_TENANT_IDS.AT01,
    item_name: 'Shikishi Print',
    price_idr: 75000,
    sort_order: 1,
    is_active: true,
    created_at: archivedIsoAtMinutes(-30),
  },
  {
    id: itemId(2),
    tenant_id: ARCHIVED_TENANT_IDS.AT02,
    item_name: 'Pixel Deskmat',
    price_idr: 165000,
    sort_order: 1,
    is_active: true,
    created_at: archivedIsoAtMinutes(-30),
  },

  // T01: Kitsune Ink Studio
  { id: itemId(101), tenant_id: TENANT_IDS.T01, item_name: 'Holo Sticker Pack', price_idr: 25000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(102), tenant_id: TENANT_IDS.T01, item_name: 'Fox Spirit Artbook', price_idr: 150000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(103), tenant_id: TENANT_IDS.T01, item_name: 'Foil A3 Poster', price_idr: 65000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T02: Pixel Neko Merch
  { id: itemId(201), tenant_id: TENANT_IDS.T02, item_name: 'Pixel Keychain', price_idr: 30000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(202), tenant_id: TENANT_IDS.T02, item_name: 'Acrylic Standee', price_idr: 85000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(203), tenant_id: TENANT_IDS.T02, item_name: 'Neko Oversized Tee', price_idr: 180000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T03: Mecha Forge Workshop
  { id: itemId(301), tenant_id: TENANT_IDS.T03, item_name: 'Metallic Decal Sheet', price_idr: 35000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(302), tenant_id: TENANT_IDS.T03, item_name: 'Chibi Mecha Bust', price_idr: 150000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(303), tenant_id: TENANT_IDS.T03, item_name: 'Collector Resin Kit', price_idr: 300000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T04: Starlight Cosplay Props
  { id: itemId(401), tenant_id: TENANT_IDS.T04, item_name: 'LED Star Hairpin', price_idr: 45000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(402), tenant_id: TENANT_IDS.T04, item_name: 'Wig Care Kit', price_idr: 95000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(403), tenant_id: TENANT_IDS.T04, item_name: 'EVA Foam Sword', price_idr: 240000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T05: Matcha & Manga Cafe
  { id: itemId(501), tenant_id: TENANT_IDS.T05, item_name: 'Iced Uji Matcha', price_idr: 40000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(502), tenant_id: TENANT_IDS.T05, item_name: 'Dorayaki Box (3pcs)', price_idr: 55000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(503), tenant_id: TENANT_IDS.T05, item_name: 'Indie Manga Anthology', price_idr: 120000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T06: Shibuya Vinyl & Pins
  { id: itemId(601), tenant_id: TENANT_IDS.T06, item_name: 'Enamel Badge', price_idr: 50000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(602), tenant_id: TENANT_IDS.T06, item_name: 'City-Pop Cassette', price_idr: 110000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(603), tenant_id: TENANT_IDS.T06, item_name: 'Anisong LP Bundle', price_idr: 200000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T07: Chibi Charm Atelier
  { id: itemId(701), tenant_id: TENANT_IDS.T07, item_name: 'Holo Washi Tape', price_idr: 25000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(702), tenant_id: TENANT_IDS.T07, item_name: 'Shaker Keychain', price_idr: 60000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(703), tenant_id: TENANT_IDS.T07, item_name: 'Full Charm Set', price_idr: 120000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },

  // T08: Retro Arcade Prints
  { id: itemId(801), tenant_id: TENANT_IDS.T08, item_name: 'Cartridge Pin', price_idr: 35000, sort_order: 1, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(802), tenant_id: TENANT_IDS.T08, item_name: 'CRT Pixel Zine', price_idr: 80000, sort_order: 2, is_active: true, created_at: isoAtOffsetMinutes(-30) },
  { id: itemId(803), tenant_id: TENANT_IDS.T08, item_name: 'Riso Arcade Bundle', price_idr: 200000, sort_order: 3, is_active: true, created_at: isoAtOffsetMinutes(-30) },
];

// ----------------------------------------------------------------------------
// 4. TRANSACTIONS (Exact Dual-IDR Ledger across Archived & Active Events)
// ----------------------------------------------------------------------------

const txId = (index: number): string =>
  `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const SEED_TRANSACTIONS: Transaction[] = [
  // --- Archived Event (Creators Super Fest 2024) ---
  {
    id: txId(1),
    client_tx_id: 'SEED-CSF-001',
    event_id: EVENT_IDS.ARCHIVED_CSF,
    participant_id: ARCHIVED_PARTICIPANT_IDS.AP01,
    tenant_id: ARCHIVED_TENANT_IDS.AT01,
    actual_amount_idr: 225000,
    leaderboard_amount_idr: 225000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Shikishi Print', quantity: 3, unit_price_idr: 75000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: archivedIsoAtMinutes(60),
  },
  {
    id: txId(2),
    client_tx_id: 'SEED-CSF-002',
    event_id: EVENT_IDS.ARCHIVED_CSF,
    participant_id: ARCHIVED_PARTICIPANT_IDS.AP02,
    tenant_id: ARCHIVED_TENANT_IDS.AT02,
    actual_amount_idr: 165000,
    leaderboard_amount_idr: 165000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Pixel Deskmat', quantity: 1, unit_price_idr: 165000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: archivedIsoAtMinutes(90),
  },
  {
    id: txId(3),
    client_tx_id: 'SEED-CSF-003',
    event_id: EVENT_IDS.ARCHIVED_CSF,
    participant_id: ARCHIVED_PARTICIPANT_IDS.AP03,
    tenant_id: ARCHIVED_TENANT_IDS.AT01,
    actual_amount_idr: 150000,
    leaderboard_amount_idr: 187500,
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Shikishi Print', quantity: 2, unit_price_idr: 75000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: archivedIsoAtMinutes(115),
  },

  // --- Active Event: Comifuro Demo ---
  // P01 (RizkyPratama): 7 booths -> actual 1,310,000 | leaderboard 1,620,000
  {
    id: txId(101),
    client_tx_id: 'SEED-CF-101',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 250000,
    leaderboard_amount_idr: 250000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(20),
  },
  {
    id: txId(102),
    client_tx_id: 'SEED-CF-102',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 180000,
    leaderboard_amount_idr: 180000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Neko Oversized Tee', quantity: 1, unit_price_idr: 180000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(34),
  },
  {
    id: txId(103),
    client_tx_id: 'SEED-CF-103',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 300000,
    leaderboard_amount_idr: 400000, // 300,000 * 1.25 (3-booth streak) + 25,000 Hidden Bounty
    multiplier_applied: 1.25,
    hit_hidden_bounty: true,
    hidden_bounty_bonus_idr: 25000,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Collector Resin Kit', quantity: 1, unit_price_idr: 300000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(48),
  },
  {
    id: txId(104),
    client_tx_id: 'SEED-CF-104',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 200000,
    leaderboard_amount_idr: 250000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(62),
  },
  {
    id: txId(105),
    client_tx_id: 'SEED-CF-105',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T05,
    actual_amount_idr: 120000,
    leaderboard_amount_idr: 150000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Indie Manga Anthology', quantity: 1, unit_price_idr: 120000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(75),
  },
  {
    id: txId(106),
    client_tx_id: 'SEED-CF-106',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T06,
    actual_amount_idr: 160000,
    leaderboard_amount_idr: 240000, // 1.50x (1.25x streak + 1.25x Cold Booth)
    multiplier_applied: 1.5,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(88),
  },
  {
    id: txId(107),
    client_tx_id: 'SEED-CF-107',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P01,
    tenant_id: TENANT_IDS.T07,
    actual_amount_idr: 100000,
    leaderboard_amount_idr: 150000, // 1.50x (1.25x streak + 1.25x Cold Booth)
    multiplier_applied: 1.5,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(102),
  },

  // P02 (SoraAoi): 5 booths -> actual 1,200,000 | leaderboard 1,360,000
  {
    id: txId(201),
    client_tx_id: 'SEED-CF-201',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P02,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 320000,
    leaderboard_amount_idr: 320000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(22),
  },
  {
    id: txId(202),
    client_tx_id: 'SEED-CF-202',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P02,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 240000,
    leaderboard_amount_idr: 240000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(40),
  },
  {
    id: txId(203),
    client_tx_id: 'SEED-CF-203',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P02,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 280000,
    leaderboard_amount_idr: 350000, // 1.25x streak activated
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(55),
  },
  {
    id: txId(204),
    client_tx_id: 'SEED-CF-204',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P02,
    tenant_id: TENANT_IDS.T05,
    actual_amount_idr: 160000,
    leaderboard_amount_idr: 200000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(82),
  },
  {
    id: txId(205),
    client_tx_id: 'SEED-CF-205',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P02,
    tenant_id: TENANT_IDS.T08,
    actual_amount_idr: 200000,
    leaderboard_amount_idr: 250000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Riso Arcade Bundle', quantity: 1, unit_price_idr: 200000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(108),
  },

  // P03 (KenjiWatanabe): 4 booths -> actual 1,010,000 | leaderboard 1,170,000
  {
    id: txId(301),
    client_tx_id: 'SEED-CF-301',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P03,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 150000,
    leaderboard_amount_idr: 150000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Fox Spirit Artbook', quantity: 1, unit_price_idr: 150000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(25),
  },
  {
    id: txId(302),
    client_tx_id: 'SEED-CF-302',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P03,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 220000,
    leaderboard_amount_idr: 220000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(42),
  },
  {
    id: txId(303),
    client_tx_id: 'SEED-CF-303',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P03,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 400000,
    leaderboard_amount_idr: 500000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(64),
  },
  {
    id: txId(304),
    client_tx_id: 'SEED-CF-304',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P03,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 240000,
    leaderboard_amount_idr: 300000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'EVA Foam Sword', quantity: 1, unit_price_idr: 240000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(92),
  },

  // P04 (NadiaPutri): 3 booths -> actual 800,000 | leaderboard 900,000
  {
    id: txId(401),
    client_tx_id: 'SEED-CF-401',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P04,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 350000,
    leaderboard_amount_idr: 350000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(30),
  },
  {
    id: txId(402),
    client_tx_id: 'SEED-CF-402',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P04,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 250000,
    leaderboard_amount_idr: 250000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(50),
  },
  {
    id: txId(403),
    client_tx_id: 'SEED-CF-403',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P04,
    tenant_id: TENANT_IDS.T06,
    actual_amount_idr: 200000,
    leaderboard_amount_idr: 300000, // 1.50x (streak + cold booth)
    multiplier_applied: 1.5,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Anisong LP Bundle', quantity: 1, unit_price_idr: 200000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(72),
  },

  // P05 (BimaSakura): 3 booths -> actual 720,000 | leaderboard 770,000
  {
    id: txId(501),
    client_tx_id: 'SEED-CF-501',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P05,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 280000,
    leaderboard_amount_idr: 280000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(45),
  },
  {
    id: txId(502),
    client_tx_id: 'SEED-CF-502',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P05,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 240000,
    leaderboard_amount_idr: 240000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(68),
  },
  {
    id: txId(503),
    client_tx_id: 'SEED-CF-503',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P05,
    tenant_id: TENANT_IDS.T05,
    actual_amount_idr: 200000,
    leaderboard_amount_idr: 250000, // 1.25x streak
    multiplier_applied: 1.25,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(90),
  },

  // P06 (YukiTanaka): 3 booths -> actual 600,000 | leaderboard 685,000
  {
    id: txId(601),
    client_tx_id: 'SEED-CF-601',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P06,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 300000,
    leaderboard_amount_idr: 300000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(60),
  },
  {
    id: txId(602),
    client_tx_id: 'SEED-CF-602',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P06,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 180000,
    leaderboard_amount_idr: 180000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(85),
  },
  {
    id: txId(603),
    client_tx_id: 'SEED-CF-603',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P06,
    tenant_id: TENANT_IDS.T07,
    actual_amount_idr: 120000,
    leaderboard_amount_idr: 205000, // 120,000 * 1.50 (streak + cold) + 25,000 Hidden Bounty
    multiplier_applied: 1.5,
    hit_hidden_bounty: true,
    hidden_bounty_bonus_idr: 25000,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: [{ item_name: 'Full Charm Set', quantity: 1, unit_price_idr: 120000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(112),
  },

  // P07 (DaffaAlfarizi): 2 booths -> actual 550,000 | leaderboard 550,000
  {
    id: txId(701),
    client_tx_id: 'SEED-CF-701',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P07,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 250000,
    leaderboard_amount_idr: 250000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(70),
  },
  {
    id: txId(702),
    client_tx_id: 'SEED-CF-702',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P07,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 300000,
    leaderboard_amount_idr: 300000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(135),
  },

  // P08 (ClarissaV): 2 booths -> actual 470,000 | leaderboard 470,000
  {
    id: txId(801),
    client_tx_id: 'SEED-CF-801',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P08,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 260000,
    leaderboard_amount_idr: 260000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(78),
  },
  {
    id: txId(802),
    client_tx_id: 'SEED-CF-802',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P08,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 210000,
    leaderboard_amount_idr: 210000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(142),
  },

  // P09 (FajarKurosaki): 2 booths -> actual 410,000 | leaderboard 410,000
  {
    id: txId(901),
    client_tx_id: 'SEED-CF-901',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P09,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 190000,
    leaderboard_amount_idr: 190000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(80),
  },
  {
    id: txId(902),
    client_tx_id: 'SEED-CF-902',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P09,
    tenant_id: TENANT_IDS.T05,
    actual_amount_idr: 220000,
    leaderboard_amount_idr: 220000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(145),
  },

  // P10 (HanaMizuki): 2 completed booths + 1 voided typo tx -> actual 330,000 | leaderboard 330,000
  {
    id: txId(1001),
    client_tx_id: 'SEED-CF-1001',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P10,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 160000,
    leaderboard_amount_idr: 160000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(95),
  },
  {
    id: txId(1002),
    client_tx_id: 'SEED-CF-1002',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P10,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 170000,
    leaderboard_amount_idr: 170000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(158),
  },
  {
    id: txId(1003),
    client_tx_id: 'SEED-CF-1003-VOID',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P10,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 1700000,
    leaderboard_amount_idr: 1700000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'voided',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: isoAtOffsetMinutes(157),
    voided_by_user_id: USER_IDS.ADMIN,
    created_at: isoAtOffsetMinutes(156),
  },

  // P11 (GavinLim): 1 booth -> actual 240,000 | leaderboard 240,000
  {
    id: txId(1101),
    client_tx_id: 'SEED-CF-1101',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P11,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 240000,
    leaderboard_amount_idr: 240000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(118),
  },

  // P12 (MikaelaS): 1 stamped booth + 1 sub-threshold Rp 15.000 purchase -> actual 200,000 | leaderboard 200,000
  {
    id: txId(1201),
    client_tx_id: 'SEED-CF-1201',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P12,
    tenant_id: TENANT_IDS.T02,
    actual_amount_idr: 185000,
    leaderboard_amount_idr: 185000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(120),
  },
  {
    id: txId(1202),
    client_tx_id: 'SEED-CF-1202',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P12,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 15000, // Valid sale, below min_stamp_spend_idr (Rp 20.000) -> no T04 stamp
    leaderboard_amount_idr: 15000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(132),
  },

  // P13 (ArifNugroho): 1 booth -> actual 140,000 | leaderboard 140,000
  {
    id: txId(1301),
    client_tx_id: 'SEED-CF-1301',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P13,
    tenant_id: TENANT_IDS.T01,
    actual_amount_idr: 140000,
    leaderboard_amount_idr: 140000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(140),
  },

  // P14 (TaniaChandra): 2 rapid cross-booth scans (10s apart -> flagged anomaly for Admin queue)
  {
    id: txId(1401),
    client_tx_id: 'SEED-CF-1401',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P14,
    tenant_id: TENANT_IDS.T03,
    actual_amount_idr: 65000,
    leaderboard_amount_idr: 65000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: false,
    flag_reason: null,
    item_summary: null,
    voided_at: null,
    voided_by_user_id: null,
    created_at: isoAtOffsetMinutes(150),
  },
  {
    id: txId(1402),
    client_tx_id: 'SEED-CF-1402',
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    participant_id: PARTICIPANT_IDS.P14,
    tenant_id: TENANT_IDS.T04,
    actual_amount_idr: 45000,
    leaderboard_amount_idr: 45000,
    multiplier_applied: 1.0,
    hit_hidden_bounty: false,
    hidden_bounty_bonus_idr: 0,
    status: 'completed',
    is_flagged: true,
    flag_reason: 'RAPID_CROSS_BOOTH_SCAN (<20s)',
    item_summary: [{ item_name: 'LED Star Hairpin', quantity: 1, unit_price_idr: 45000 }],
    voided_at: null,
    voided_by_user_id: null,
    created_at: new Date(BASE_TIME_MS + 150 * 60_000 + 10_000).toISOString(),
  },
  // P15 (ZakiHidayat): Rp 0 spent yet, starts with Check-In Stamp #1 (1/9)
];

// ----------------------------------------------------------------------------
// 5. DERIVE EXACT STAMPS, PARTICIPANT TOTALS, TENANT TOTALS & USER TOTALS
// ----------------------------------------------------------------------------

const stampId = (index: number): string =>
  `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const eventMinSpendMap = new Map<string, number>(
  SEED_EVENTS.map((evt) => [evt.id, evt.min_stamp_spend_idr])
);

const SEED_STAMPS: Stamp[] = [];
let stampSeq = 1;

// Stamp #1 (Check-In) for every participant
for (const bp of PARTICIPANT_BLUEPRINTS) {
  SEED_STAMPS.push({
    id: stampId(stampSeq++),
    event_id: bp.event_id,
    participant_id: bp.id,
    tenant_id: null,
    stamp_type: 'checkin',
    unlocked_at: bp.created_at,
  });
}

// Booth stamps for every qualifying completed transaction (>= event.min_stamp_spend_idr)
const seenBoothStamps = new Set<string>();
for (const tx of SEED_TRANSACTIONS) {
  if (tx.status !== 'completed') continue;
  const minSpend = eventMinSpendMap.get(tx.event_id) ?? 20000;
  if (tx.actual_amount_idr < minSpend) continue;

  const key = `${tx.participant_id}::${tx.tenant_id}`;
  if (seenBoothStamps.has(key)) continue;
  seenBoothStamps.add(key);

  SEED_STAMPS.push({
    id: stampId(stampSeq++),
    event_id: tx.event_id,
    participant_id: tx.participant_id,
    tenant_id: tx.tenant_id,
    stamp_type: 'booth',
    unlocked_at: tx.created_at,
  });
}

// Aggregate Dual-IDR sums per participant & booth from completed transactions
const participantActualMap = new Map<string, number>();
const participantLeaderboardMap = new Map<string, number>();
const tenantSalesMap = new Map<string, number>();
const tenantStampCountMap = new Map<string, number>();

for (const tx of SEED_TRANSACTIONS) {
  if (tx.status !== 'completed') continue;
  participantActualMap.set(
    tx.participant_id,
    (participantActualMap.get(tx.participant_id) ?? 0) + tx.actual_amount_idr
  );
  participantLeaderboardMap.set(
    tx.participant_id,
    (participantLeaderboardMap.get(tx.participant_id) ?? 0) + tx.leaderboard_amount_idr
  );
  tenantSalesMap.set(
    tx.tenant_id,
    (tenantSalesMap.get(tx.tenant_id) ?? 0) + tx.actual_amount_idr
  );
}

for (const s of SEED_STAMPS) {
  if (s.stamp_type === 'booth' && s.tenant_id) {
    tenantStampCountMap.set(s.tenant_id, (tenantStampCountMap.get(s.tenant_id) ?? 0) + 1);
  }
}

const SEED_PARTICIPANTS: EventParticipant[] = PARTICIPANT_BLUEPRINTS.map((bp) => ({
  id: bp.id,
  event_id: bp.event_id,
  user_id: bp.user_id,
  qr_code: bp.qr_code,
  actual_spent_idr: participantActualMap.get(bp.id) ?? 0,
  leaderboard_idr: participantLeaderboardMap.get(bp.id) ?? 0,
  streak_expires_at: bp.streak_expires_at,
  created_at: bp.created_at,
  updated_at: bp.created_at,
}));

const SEED_TENANTS: Tenant[] = TENANT_BLUEPRINTS.map((tb) => ({
  ...tb,
  event_sales_idr: tenantSalesMap.get(tb.id) ?? 0,
  unique_stamps_count: tenantStampCountMap.get(tb.id) ?? 0,
  updated_at: tb.created_at,
}));

// Roll up exact global user totals across archived + active events
const userLifetimeActualMap = new Map<string, number>();
const userLifetimeSalesMap = new Map<string, number>();
const userEventsSetMap = new Map<string, Set<string>>();

for (const p of SEED_PARTICIPANTS) {
  userLifetimeActualMap.set(
    p.user_id,
    (userLifetimeActualMap.get(p.user_id) ?? 0) + p.actual_spent_idr
  );
  const evtSet = userEventsSetMap.get(p.user_id) ?? new Set<string>();
  evtSet.add(p.event_id);
  userEventsSetMap.set(p.user_id, evtSet);
}

for (const t of SEED_TENANTS) {
  userLifetimeSalesMap.set(
    t.user_id,
    (userLifetimeSalesMap.get(t.user_id) ?? 0) + t.event_sales_idr
  );
  const evtSet = userEventsSetMap.get(t.user_id) ?? new Set<string>();
  evtSet.add(t.event_id);
  userEventsSetMap.set(t.user_id, evtSet);
}

// ----------------------------------------------------------------------------
// 6. USERS (1 Organizer, 8 Merchants, 15 Attendees)
// ----------------------------------------------------------------------------

const BUYER_PROFILES: Array<{
  id: string;
  email: string;
  username: string;
  badges: string[];
}> = [
  { id: USER_IDS.BUYER_01, email: 'rizky.pratama@demo.id', username: 'RizkyPratama', badges: ['Speedrunner Streak', 'Bounty Hunter', 'Patron Whale'] },
  { id: USER_IDS.BUYER_02, email: 'sora.aoi@demo.id', username: 'SoraAoi', badges: ['Speedrunner Streak', 'Patron Whale'] },
  { id: USER_IDS.BUYER_03, email: 'kenji.watanabe@demo.id', username: 'KenjiWatanabe', badges: ['Speedrunner Streak', 'Patron Whale'] },
  { id: USER_IDS.BUYER_04, email: 'nadia.putri@demo.id', username: 'NadiaPutri', badges: ['Speedrunner Streak', 'Bounty Hunter'] },
  { id: USER_IDS.BUYER_05, email: 'bima.sakura@demo.id', username: 'BimaSakura', badges: ['Speedrunner Streak'] },
  { id: USER_IDS.BUYER_06, email: 'yuki.tanaka@demo.id', username: 'YukiTanaka', badges: ['Speedrunner Streak', 'Bounty Hunter'] },
  { id: USER_IDS.BUYER_07, email: 'daffa.alfarizi@demo.id', username: 'DaffaAlfarizi', badges: [] },
  { id: USER_IDS.BUYER_08, email: 'clarissa.v@demo.id', username: 'ClarissaV', badges: [] },
  { id: USER_IDS.BUYER_09, email: 'fajar.kurosaki@demo.id', username: 'FajarKurosaki', badges: [] },
  { id: USER_IDS.BUYER_10, email: 'hana.mizuki@demo.id', username: 'HanaMizuki', badges: [] },
  { id: USER_IDS.BUYER_11, email: 'gavin.lim@demo.id', username: 'GavinLim', badges: [] },
  { id: USER_IDS.BUYER_12, email: 'mikaela.s@demo.id', username: 'MikaelaS', badges: [] },
  { id: USER_IDS.BUYER_13, email: 'arif.nugroho@demo.id', username: 'ArifNugroho', badges: [] },
  { id: USER_IDS.BUYER_14, email: 'tania.chandra@demo.id', username: 'TaniaChandra', badges: [] },
  { id: USER_IDS.BUYER_15, email: 'zaki.hidayat@demo.id', username: 'ZakiHidayat', badges: [] },
];

const MERCHANT_PROFILES: Array<{
  id: string;
  email: string;
  username: string;
  brand: string;
  bio: string;
  badges: string[];
}> = [
  { id: USER_IDS.MERCHANT_01, email: 'kitsune@demo.id', username: 'KitsuneInk', brand: 'Kitsune Ink Studio', bio: 'Doujin artbooks & metallic foil prints.', badges: ['Top Booth Seller'] },
  { id: USER_IDS.MERCHANT_02, email: 'pixelneko@demo.id', username: 'PixelNeko', brand: 'Pixel Neko Merch', bio: 'Pixel art apparel & acrylic collectibles.', badges: ['Top Booth Seller'] },
  { id: USER_IDS.MERCHANT_03, email: 'mechaforge@demo.id', username: 'MechaForge', brand: 'Mecha Forge Workshop', bio: 'Custom resin mecha kits & busts.', badges: [] },
  { id: USER_IDS.MERCHANT_04, email: 'starlight@demo.id', username: 'StarlightProps', brand: 'Starlight Cosplay Props', bio: 'Handcrafted foam props & cosplay gear.', badges: [] },
  { id: USER_IDS.MERCHANT_05, email: 'matchacafe@demo.id', username: 'MatchaManga', brand: 'Matcha & Manga Cafe', bio: 'Artisan drinks & indie manga.', badges: [] },
  { id: USER_IDS.MERCHANT_06, email: 'shibuyavinyl@demo.id', username: 'ShibuyaVinyl', brand: 'Shibuya Vinyl & Pins', bio: 'City-pop records & hard-enamel pins.', badges: [] },
  { id: USER_IDS.MERCHANT_07, email: 'chibicharm@demo.id', username: 'ChibiAtelier', brand: 'Chibi Charm Atelier', bio: 'Acrylic shakers & stationery.', badges: [] },
  { id: USER_IDS.MERCHANT_08, email: 'retroarcade@demo.id', username: 'RetroArcade', brand: 'Retro Arcade Prints', bio: 'Riso posters & pixel zines.', badges: [] },
];

const SEED_USERS: User[] = [
  {
    id: USER_IDS.ADMIN,
    email: 'organizer@comifuro-demo.id',
    username: 'ComifuroAdmin',
    password_hash: 'DEMO_HASH_ADMIN',
    is_merchant: true,
    is_admin: true,
    active_view_mode: 'buyer',
    merchant_brand_name: 'Event HQ Organizer',
    merchant_bio: 'Official organizer command account.',
    lifetime_actual_spent_idr: 0,
    lifetime_sales_idr: 0,
    events_count: 2,
    earned_badges: ['Event Organizer'],
    created_at: archivedIsoAtMinutes(-2880),
    updated_at: isoAtOffsetMinutes(0),
  },
  ...MERCHANT_PROFILES.map((m): User => ({
    id: m.id,
    email: m.email,
    username: m.username,
    password_hash: 'DEMO_HASH_MERCHANT',
    is_merchant: true,
    is_admin: false,
    active_view_mode: 'merchant',
    merchant_brand_name: m.brand,
    merchant_bio: m.bio,
    lifetime_actual_spent_idr: userLifetimeActualMap.get(m.id) ?? 0,
    lifetime_sales_idr: userLifetimeSalesMap.get(m.id) ?? 0,
    events_count: userEventsSetMap.get(m.id)?.size ?? 1,
    earned_badges: m.badges,
    created_at: archivedIsoAtMinutes(-2000),
    updated_at: isoAtOffsetMinutes(10),
  })),
  ...BUYER_PROFILES.map((b): User => ({
    id: b.id,
    email: b.email,
    username: b.username,
    password_hash: 'DEMO_HASH_BUYER',
    is_merchant: false,
    is_admin: false,
    active_view_mode: 'buyer',
    merchant_brand_name: null,
    merchant_bio: null,
    lifetime_actual_spent_idr: userLifetimeActualMap.get(b.id) ?? 0,
    lifetime_sales_idr: 0,
    events_count: userEventsSetMap.get(b.id)?.size ?? 1,
    earned_badges: b.badges,
    created_at: archivedIsoAtMinutes(-1500),
    updated_at: isoAtOffsetMinutes(10),
  })),
];

// ----------------------------------------------------------------------------
// 7. TICKET UIDS (Including Ready-to-Claim TKT-DEMO-BYR & TKT-DEMO-SLR)
// ----------------------------------------------------------------------------

const ticketId = (index: number): string =>
  `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const SEED_TICKET_UIDS: TicketUid[] = [
  // Unclaimed quick-test demo Ticket UIDs for the Event Join Gate & Become-a-Merchant flow
  {
    id: ticketId(1),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    uid_code: 'TKT-DEMO-BYR',
    role_type: 'buyer',
    claimed_by_user_id: null,
    claimed_at: null,
    created_at: isoAtOffsetMinutes(-1440),
  },
  {
    id: ticketId(2),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    uid_code: 'TKT-DEMO-SLR',
    role_type: 'merchant',
    claimed_by_user_id: null,
    claimed_at: null,
    created_at: isoAtOffsetMinutes(-1440),
  },
  // Claimed Ticket UIDs for the 8 pre-seeded Comifuro Demo Merchants
  ...MERCHANT_PROFILES.map((m, idx): TicketUid => ({
    id: ticketId(100 + idx),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    uid_code: `TKT-CF20-SLR-${String(idx + 1).padStart(2, '0')}`,
    role_type: 'merchant',
    claimed_by_user_id: m.id,
    claimed_at: isoAtOffsetMinutes(-60),
    created_at: isoAtOffsetMinutes(-1440),
  })),
  // Claimed Ticket UIDs for the 15 pre-seeded Comifuro Demo Buyers
  ...BUYER_PROFILES.map((b, idx): TicketUid => ({
    id: ticketId(200 + idx),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    uid_code: `TKT-CF20-BYR-${String(idx + 1).padStart(2, '0')}`,
    role_type: 'buyer',
    claimed_by_user_id: b.id,
    claimed_at: isoAtOffsetMinutes(idx + 1),
    created_at: isoAtOffsetMinutes(-1440),
  })),
];

// ----------------------------------------------------------------------------
// 8. STRUCTURED EVENT CHAT MESSAGES (Announcements + Looking For Board)
// ----------------------------------------------------------------------------

const chatId = (index: number): string =>
  `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const SEED_CHAT_MESSAGES: EventChatMessage[] = [
  {
    id: chatId(1),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.ADMIN,
    sender_username: 'ComifuroAdmin',
    sender_role: 'organizer',
    message_type: 'admin_announcement',
    announcement_text:
      'Welcome to Comifuro Demo! Visit 3 distinct booths within 60 minutes to activate a 1.25x Leaderboard Spend Multiplier!',
    target_character: null,
    target_location: null,
    target_activity: null,
    interested_user_ids: [USER_IDS.BUYER_01, USER_IDS.BUYER_02, USER_IDS.BUYER_04],
    is_pinned: true,
    created_at: isoAtOffsetMinutes(2),
  },
  {
    id: chatId(2),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.ADMIN,
    sender_username: 'ComifuroAdmin',
    sender_role: 'organizer',
    message_type: 'admin_announcement',
    announcement_text:
      'GOLD COLD-BOOTH BOUNTY LIVE (30m): Booth C-09 Shibuya Vinyl & Pins and Booth D-02 Chibi Charm Atelier now grant a 1.25x Leaderboard Spend Boost!',
    target_character: null,
    target_location: null,
    target_activity: null,
    interested_user_ids: [USER_IDS.BUYER_01, USER_IDS.BUYER_06],
    is_pinned: true,
    created_at: isoAtOffsetMinutes(70),
  },
  {
    id: chatId(3),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.BUYER_02,
    sender_username: 'SoraAoi',
    sender_role: 'buyer',
    message_type: 'looking_for',
    announcement_text: null,
    target_character: 'Ahri (Spirit Blossom)',
    target_location: 'Photo Zone A',
    target_activity: 'Photoshoot',
    interested_user_ids: [USER_IDS.BUYER_04, USER_IDS.BUYER_08],
    is_pinned: false,
    created_at: isoAtOffsetMinutes(45),
  },
  {
    id: chatId(4),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.BUYER_03,
    sender_username: 'KenjiWatanabe',
    sender_role: 'buyer',
    message_type: 'looking_for',
    announcement_text: null,
    target_character: 'Leon S. Kennedy',
    target_location: 'Booth B-12 (Starlight Cosplay Props)',
    target_activity: 'Reels / TikTok Collab',
    interested_user_ids: [USER_IDS.BUYER_01, USER_IDS.MERCHANT_04],
    is_pinned: false,
    created_at: isoAtOffsetMinutes(66),
  },
  {
    id: chatId(5),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.MERCHANT_01,
    sender_username: 'KitsuneInk',
    sender_role: 'merchant',
    message_type: 'looking_for',
    announcement_text: null,
    target_character: 'Naruto / Sasuke Duo',
    target_location: 'Booth A-01 (Kitsune Ink Studio)',
    target_activity: 'Group Meetup',
    interested_user_ids: [USER_IDS.BUYER_05, USER_IDS.BUYER_09, USER_IDS.BUYER_11],
    is_pinned: false,
    created_at: isoAtOffsetMinutes(98),
  },
  {
    id: chatId(6),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.BUYER_06,
    sender_username: 'YukiTanaka',
    sender_role: 'buyer',
    message_type: 'looking_for',
    announcement_text: null,
    target_character: 'Luffy Gear 5',
    target_location: 'Main Stage',
    target_activity: 'Merch Trade',
    interested_user_ids: [USER_IDS.BUYER_07],
    is_pinned: false,
    created_at: isoAtOffsetMinutes(125),
  },
  {
    id: chatId(7),
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    sender_user_id: USER_IDS.MERCHANT_06,
    sender_username: 'ShibuyaVinyl',
    sender_role: 'merchant',
    message_type: 'looking_for',
    announcement_text: null,
    target_character: 'Bocchi / Kessoku Band',
    target_location: 'Booth C-09 (Shibuya Vinyl & Pins)',
    target_activity: 'Hangout',
    interested_user_ids: [USER_IDS.BUYER_04, USER_IDS.BUYER_12],
    is_pinned: false,
    created_at: isoAtOffsetMinutes(148),
  },
];

// ----------------------------------------------------------------------------
// EXPORTED COMPLETE SEED DATASET
// ----------------------------------------------------------------------------

export const DEMO_SEED_DATA: DemoSeedDataset = {
  users: SEED_USERS,
  events: SEED_EVENTS,
  ticket_uids: SEED_TICKET_UIDS,
  event_participants: SEED_PARTICIPANTS,
  tenants: SEED_TENANTS,
  tenant_items: SEED_TENANT_ITEMS,
  stamps: SEED_STAMPS,
  transactions: SEED_TRANSACTIONS,
  event_chat_messages: SEED_CHAT_MESSAGES,
};

// ----------------------------------------------------------------------------
// SEED INTEGRITY VERIFIER
// ----------------------------------------------------------------------------

/**
 * Verifies mathematical consistency across Dual-IDR ledgers, stamps, and rollups.
 */
export function verifySeedIntegrity(dataset: DemoSeedDataset = DEMO_SEED_DATA): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  const participantById = new Map(dataset.event_participants.map((p) => [p.id, p]));
  const tenantById = new Map(dataset.tenants.map((t) => [t.id, t]));

  const actualByParticipant = new Map<string, number>();
  const lbByParticipant = new Map<string, number>();
  const salesByTenant = new Map<string, number>();

  for (const tx of dataset.transactions) {
    if (!participantById.has(tx.participant_id)) {
      issues.push(`Orphan transaction participant_id: ${tx.participant_id}`);
    }
    if (!tenantById.has(tx.tenant_id)) {
      issues.push(`Orphan transaction tenant_id: ${tx.tenant_id}`);
    }
    if (tx.status === 'completed') {
      actualByParticipant.set(
        tx.participant_id,
        (actualByParticipant.get(tx.participant_id) ?? 0) + tx.actual_amount_idr
      );
      lbByParticipant.set(
        tx.participant_id,
        (lbByParticipant.get(tx.participant_id) ?? 0) + tx.leaderboard_amount_idr
      );
      salesByTenant.set(tx.tenant_id, (salesByTenant.get(tx.tenant_id) ?? 0) + tx.actual_amount_idr);
    }
  }

  for (const p of dataset.event_participants) {
    const expectedActual = actualByParticipant.get(p.id) ?? 0;
    const expectedLb = lbByParticipant.get(p.id) ?? 0;
    if (p.actual_spent_idr !== expectedActual) {
      issues.push(`Participant ${p.id} actual_spent_idr mismatch: ${p.actual_spent_idr} !== ${expectedActual}`);
    }
    if (p.leaderboard_idr !== expectedLb) {
      issues.push(`Participant ${p.id} leaderboard_idr mismatch: ${p.leaderboard_idr} !== ${expectedLb}`);
    }
  }

  for (const t of dataset.tenants) {
    const expectedSales = salesByTenant.get(t.id) ?? 0;
    const boothStamps = dataset.stamps.filter((s) => s.stamp_type === 'booth' && s.tenant_id === t.id).length;
    if (t.event_sales_idr !== expectedSales) {
      issues.push(`Tenant ${t.id} event_sales_idr mismatch: ${t.event_sales_idr} !== ${expectedSales}`);
    }
    if (t.unique_stamps_count !== boothStamps) {
      issues.push(`Tenant ${t.id} unique_stamps_count mismatch: ${t.unique_stamps_count} !== ${boothStamps}`);
    }
  }

  return { valid: issues.length === 0, issues };
}