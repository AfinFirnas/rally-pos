from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

ViewMode = Literal["buyer", "merchant"]
EventStatus = Literal["draft", "active", "archived"]
TicketRoleType = Literal["buyer", "merchant"]
StampType = Literal["checkin", "booth"]
TransactionStatus = Literal["completed", "voided"]
ChatSenderRole = Literal["organizer", "buyer", "merchant"]
ChatMessageType = Literal["admin_announcement", "looking_for"]
DemoPresetRole = Literal["fresh_buyer", "active_buyer", "merchant", "admin"]


def _to_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return value


def _to_str(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    return value


class ApiBaseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ============================================================================
# CORE DOMAIN MODELS (1:1 WITH src/types/types.ts)
# ============================================================================


class UserOut(ApiBaseModel):
    id: str
    email: str
    username: str
    password_hash: str = ""
    is_merchant: bool
    is_admin: bool
    active_view_mode: ViewMode
    merchant_brand_name: str | None = None
    merchant_bio: str | None = None
    lifetime_actual_spent_idr: int = 0
    lifetime_sales_idr: int = 0
    events_count: int = 0
    earned_badges: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str

    @field_validator("id", mode="before")
    @classmethod
    def _coerce_id(cls, v: Any) -> str:
        return str(v)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> str:
        return str(_to_iso(v))

    @field_validator("password_hash", mode="before")
    @classmethod
    def _redact_hash(cls, v: Any) -> str:
        # Never expose real password hashes over HTTP API
        return "" if v is not None else ""


class EventOut(ApiBaseModel):
    id: str
    name: str
    description: str
    status: EventStatus
    min_stamp_spend_idr: int
    admin_void_pin: str = ""
    cold_bounty_multiplier: float
    hidden_bounty_bonus_idr: int
    venue_zones: list[str] = Field(default_factory=list)
    event_date: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    created_by: str | None = None
    created_at: str
    updated_at: str

    @field_validator("id", "created_by", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("cold_bounty_multiplier", mode="before")
    @classmethod
    def _coerce_float(cls, v: Any) -> float:
        return float(v)

    @field_validator("event_date", "started_at", "ended_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v) if v is not None else None


class TicketUidOut(ApiBaseModel):
    id: str
    event_id: str
    uid_code: str
    role_type: TicketRoleType
    claimed_by_user_id: str | None = None
    claimed_at: str | None = None
    created_at: str

    @field_validator("id", "event_id", "claimed_by_user_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("claimed_at", "created_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v) if v is not None else None


class EventParticipantOut(ApiBaseModel):
    id: str
    event_id: str
    user_id: str
    qr_code: str
    actual_spent_idr: int
    leaderboard_idr: int
    streak_expires_at: str | None = None
    created_at: str
    updated_at: str

    @field_validator("id", "event_id", "user_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("streak_expires_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v) if v is not None else None


class TenantOut(ApiBaseModel):
    id: str
    event_id: str
    user_id: str
    booth_number: str
    booth_name: str
    description: str
    stamp_image_url: str
    event_sales_idr: int
    unique_stamps_count: int
    is_cold_bounty: bool
    cold_bounty_expires_at: str | None = None
    cold_bounty_multiplier: float
    is_hidden_bounty: bool
    hidden_bounty_bonus_idr: int
    created_at: str
    updated_at: str

    @field_validator("id", "event_id", "user_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("cold_bounty_multiplier", mode="before")
    @classmethod
    def _coerce_float(cls, v: Any) -> float:
        return float(v)

    @field_validator("cold_bounty_expires_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v) if v is not None else None


class TenantItemOut(ApiBaseModel):
    id: str
    tenant_id: str
    item_name: str
    price_idr: int
    sort_order: int
    is_active: bool
    created_at: str

    @field_validator("id", "tenant_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("created_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v)


class StampOut(ApiBaseModel):
    id: str
    event_id: str
    participant_id: str
    tenant_id: str | None = None
    stamp_type: StampType
    unlocked_at: str

    @field_validator("id", "event_id", "participant_id", "tenant_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("unlocked_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v)


class TransactionItemSummary(ApiBaseModel):
    item_id: str | None = None
    item_name: str
    quantity: int = Field(gt=0)
    unit_price_idr: int = Field(gt=0)


class TransactionOut(ApiBaseModel):
    id: str
    client_tx_id: str | None = None
    event_id: str
    participant_id: str
    tenant_id: str
    actual_amount_idr: int
    leaderboard_amount_idr: int
    multiplier_applied: float
    hit_hidden_bounty: bool
    hidden_bounty_bonus_idr: int
    status: TransactionStatus
    is_flagged: bool
    flag_reason: str | None = None
    item_summary: list[TransactionItemSummary] | None = None
    voided_at: str | None = None
    voided_by_user_id: str | None = None
    created_at: str

    @field_validator(
        "id", "event_id", "participant_id", "tenant_id", "voided_by_user_id", mode="before"
    )
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("multiplier_applied", mode="before")
    @classmethod
    def _coerce_float(cls, v: Any) -> float:
        return float(v)

    @field_validator("voided_at", "created_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v) if v is not None else None


class EventChatMessageOut(ApiBaseModel):
    id: str
    event_id: str
    sender_user_id: str
    sender_username: str
    sender_role: ChatSenderRole
    message_type: ChatMessageType
    announcement_text: str | None = None
    target_character: str | None = None
    target_location: str | None = None
    target_activity: str | None = None
    interested_user_ids: list[str] = Field(default_factory=list)
    is_pinned: bool
    created_at: str

    @field_validator("id", "event_id", "sender_user_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> Any:
        return _to_str(v)

    @field_validator("interested_user_ids", mode="before")
    @classmethod
    def _coerce_uuid_list(cls, v: Any) -> list[str]:
        return [str(x) for x in (v or [])]

    @field_validator("created_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v)


# ============================================================================
# AUTHENTICATION SCHEMAS
# ============================================================================


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3)
    username: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=4)


class DemoAuthRequest(BaseModel):
    preset: DemoPresetRole = "fresh_buyer"


class SwitchViewModeRequest(BaseModel):
    active_view_mode: ViewMode


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class UserEnvelope(BaseModel):
    user: UserOut | None


class OkResponse(BaseModel):
    ok: bool = True


# ============================================================================
# EVENTS & CHECK-IN SCHEMAS
# ============================================================================


class EventsBootstrapResponse(BaseModel):
    events: list[EventOut]
    participants: list[EventParticipantOut]
    tenants: list[TenantOut]
    tenant_items: list[TenantItemOut]
    stamps: list[StampOut]
    transactions: list[TransactionOut]
    ticket_uids: list[TicketUidOut]
    meetups: list[EventChatMessageOut]
    users: list[UserOut]


class EventDetailResponse(BaseModel):
    event: EventOut
    tenants: list[TenantOut]
    tenant_items: list[TenantItemOut]
    participants_count: int
    my_participant: EventParticipantOut | None = None
    my_tenant: TenantOut | None = None


class CheckInRequest(BaseModel):
    uid_code: str = Field(min_length=3)
    booth_name: str | None = None
    booth_number: str | None = None
    booth_bio: str | None = None


class CheckInResponse(BaseModel):
    event: EventOut
    role_type: TicketRoleType
    participant: EventParticipantOut
    tenant: TenantOut | None = None
    check_in_stamp: StampOut
    ticket_uid: TicketUidOut | None = None
    user: UserOut | None = None
    is_new_join: bool


class LinkBoothRequest(BaseModel):
    uid_code: str = Field(min_length=3)
    booth_name: str = Field(min_length=2, max_length=100)
    booth_number: str | None = None
    bio: str | None = ""


class LinkBoothResponse(BaseModel):
    user: UserOut
    tenant: TenantOut
    participant: EventParticipantOut
    check_in_stamp: StampOut
    ticket_uid: TicketUidOut | None = None


# ============================================================================
# BOOTH PROFILE, CATALOG & ANALYTICS SCHEMAS
# ============================================================================


class UpdateBoothProfileRequest(BaseModel):
    booth_name: str = Field(min_length=2, max_length=100)
    booth_number: str = Field(min_length=1, max_length=20)
    description: str = ""
    stamp_image_url: str = ""


class TenantEnvelope(BaseModel):
    tenant: TenantOut


class CreateBoothItemRequest(BaseModel):
    item_name: str = Field(min_length=1, max_length=100)
    price_idr: int = Field(gt=0)
    sort_order: int | None = None
    is_active: bool = True


class UpdateBoothItemRequest(BaseModel):
    item_name: str | None = Field(default=None, min_length=1, max_length=100)
    price_idr: int | None = Field(default=None, gt=0)
    is_active: bool | None = None
    sort_order: int | None = None


class BoothItemEnvelope(BaseModel):
    item: TenantItemOut


class DeleteBoothItemResponse(BaseModel):
    ok: bool = True
    id: str


class BoothAnalyticsResponse(BaseModel):
    tenant: TenantOut
    total_sales_idr: int
    completed_transactions_count: int
    voided_transactions_count: int
    unique_stamps_count: int
    recent_transactions: list[TransactionOut]


# ============================================================================
# POS CHECKOUT & REVERSAL SCHEMAS
# ============================================================================


class PosCheckoutRequest(BaseModel):
    client_tx_id: str = Field(
        validation_alias=AliasChoices("client_tx_id", "transaction_uuid"),
        min_length=4,
        max_length=128,
    )
    event_id: str
    tenant_id: str
    buyer_qr_code: str = Field(min_length=4, max_length=32)
    actual_amount_idr: int = Field(gt=0)
    item_summary: list[TransactionItemSummary] | None = None


class PosCheckoutResponse(BaseModel):
    transaction: TransactionOut
    participant: EventParticipantOut
    tenant: TenantOut
    unlocked_stamp: StampOut | None = None
    hidden_bounty_triggered: bool
    hidden_bounty_bonus_idr: int


class PosReverseRequest(BaseModel):
    transaction_id: str
    admin_void_pin: str | None = None


class PosReverseResponse(BaseModel):
    transaction: TransactionOut
    participant: EventParticipantOut
    tenant: TenantOut
    reversed_stamp_id: str | None = None
    deduct_actual_idr: int
    deduct_leaderboard_idr: int


# ============================================================================
# LEADERBOARD SCHEMAS (PRIVACY-SAFE: NO actual_spent_idr)
# ============================================================================


class LeaderboardEntryOut(ApiBaseModel):
    participant_id: str
    event_id: str
    user_id: str
    username: str
    leaderboard_idr: int
    streak_expires_at: str | None = None
    stamps_count: int
    rank_position: int

    @field_validator("participant_id", "event_id", "user_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, v: Any) -> str:
        return str(v)

    @field_validator("streak_expires_at", mode="before")
    @classmethod
    def _coerce_dates(cls, v: Any) -> Any:
        return _to_iso(v) if v is not None else None


class LeaderboardResponse(BaseModel):
    event_id: str
    entries: list[LeaderboardEntryOut]


# ============================================================================
# MEETUPS & ANNOUNCEMENTS SCHEMAS
# ============================================================================


class MeetupsListResponse(BaseModel):
    event_id: str
    messages: list[EventChatMessageOut]


class CreateMeetupRequest(BaseModel):
    message_type: ChatMessageType
    announcement_text: str | None = None
    is_pinned: bool = False
    target_character: str | None = None
    target_location: str | None = None
    target_activity: str | None = None
    sender_role: ChatSenderRole | None = None

    @model_validator(mode="after")
    def validate_anti_spam_structure(self) -> "CreateMeetupRequest":
        if self.message_type == "admin_announcement":
            if not self.announcement_text or not self.announcement_text.strip():
                raise ValueError("Announcement text is required for admin_announcement.")
        else:
            if not self.target_character or not self.target_character.strip():
                raise ValueError("target_character is required for looking_for posts.")
            if not self.target_location or not self.target_location.strip():
                raise ValueError("target_location is required for looking_for posts.")
            if not self.target_activity or not self.target_activity.strip():
                raise ValueError("target_activity is required for looking_for posts.")
        return self


class MeetupMessageEnvelope(BaseModel):
    message: EventChatMessageOut


class ToggleMeetupInterestResponse(BaseModel):
    message: EventChatMessageOut
    interested: bool


# ============================================================================
# ORGANIZER COMMAND CENTER SCHEMAS
# ============================================================================


class CreateEventRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = ""
    min_stamp_spend_idr: int = Field(ge=0)
    admin_void_pin: str = Field(min_length=4, max_length=32)
    cold_bounty_multiplier: float = Field(default=1.5, ge=1.0)
    hidden_bounty_bonus_idr: int = Field(default=25000, ge=0)
    venue_zones: list[str] | None = None


class EventEnvelope(BaseModel):
    event: EventOut


class UpdateEventStatusRequest(BaseModel):
    status: Literal["active", "archived"]


class UpdateEventStatusResponse(BaseModel):
    event: EventOut
    welcome_announcement: EventChatMessageOut | None = None


class TicketImportItem(BaseModel):
    uid_code: str = Field(min_length=3, max_length=64)
    role_type: TicketRoleType


class CreateEventTicketsRequest(BaseModel):
    mode: Literal["generate", "import"]
    role_type: TicketRoleType | None = None
    count: int | None = Field(default=10, ge=1, le=50)
    tickets: list[TicketImportItem] | None = None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> "CreateEventTicketsRequest":
        if self.mode == "generate" and not self.role_type:
            raise ValueError("role_type is required when mode='generate'.")
        if self.mode == "import" and (not self.tickets or len(self.tickets) == 0):
            raise ValueError("tickets list is required when mode='import'.")
        return self


class TicketsListResponse(BaseModel):
    tickets: list[TicketUidOut]


class ActivateColdBountyRequest(BaseModel):
    tenant_ids: list[str] = Field(min_length=1, max_length=3)
    multiplier: float = Field(default=1.5, ge=1.0, le=5.0)
    duration_minutes: int = Field(default=30, ge=5, le=240)


class ActivateColdBountyResponse(BaseModel):
    tenants: list[TenantOut]
    announcement: EventChatMessageOut | None = None


class ToggleHiddenBountyRequest(BaseModel):
    is_hidden_bounty: bool


class RotateHiddenBountyRequest(BaseModel):
    count: int | None = Field(default=None, ge=1, le=20)


class TenantsListResponse(BaseModel):
    tenants: list[TenantOut]


class TransactionEnvelope(BaseModel):
    transaction: TransactionOut
