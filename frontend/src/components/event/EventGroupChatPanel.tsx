import React, { useEffect, useMemo, useState } from 'react';
import {
  Filter,
  MapPin,
  Megaphone,
  MessageSquare,
  Pin,
  Search,
  Send,
  Sparkles,
  Tag,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { soundFeedback } from '../../lib/soundFeedback';
import { apiClient } from '../../services/apiClient';
import type {
  ChatSenderRole,
  DemoSeedDataset,
  Event,
  EventChatMessage,
} from '../../types/types';

interface EventGroupChatPanelProps {
  event: Event;
  dataset: DemoSeedDataset;
  onDatasetChange: (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => void;
}

const POPULAR_CHARACTER_CHIPS = [
  'Naruto',
  'Luffy',
  'Ahri',
  'Leon',
  'Gojo Satoru',
  'Hatsune Miku',
] as const;

const ACTIVITY_TAGS = [
  'Photoshoot',
  'Group Meetup',
  'Merch Trade',
  'Reels / TikTok Collab',
  'Hangout',
] as const;

export const EventGroupChatPanel: React.FC<EventGroupChatPanelProps> = ({
  event,
  dataset,
  onDatasetChange,
}) => {
  const { currentUser, activeViewMode } = useApp();

  // Cosplay & Meetup Finder State
  const [targetCharacter, setTargetCharacter] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [targetActivity, setTargetActivity] = useState<string>(ACTIVITY_TAGS[0]);

  // Organizer Announcement State
  const [announcementText, setAnnouncementText] = useState('');
  const [pinAnnouncement, setPinAnnouncement] = useState(true);
  const [composerMode, setComposerMode] = useState<'announcement' | 'looking_for'>(() =>
    currentUser?.is_admin ? 'announcement' : 'looking_for'
  );

  // Feed Filters
  const [characterFilter, setCharacterFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [activityFilter, setActivityFilter] = useState('ALL');
  const [postingError, setPostingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void apiClient
      .getEventMeetups(event.id)
      .then((res) => {
        if (active && apiClient.isRemoteConfigured() && !apiClient.isFallbackActive()) {
          onDatasetChange((prev) => ({
            ...prev,
            event_chat_messages: [
              ...res.messages,
              ...prev.event_chat_messages.filter((m) => m.event_id !== event.id),
            ],
          }));
        }
      })
      .catch(() => {
        // Fallback seamlessly to local dataset messages
      });
    return () => {
      active = false;
    };
  }, [event.id, onDatasetChange]);

  const isOrganizer = Boolean(currentUser?.is_admin);
  const isEventArchived = event.status === 'archived';

  const eventBooths = useMemo(
    () =>
      dataset.tenants
        .filter((t) => t.event_id === event.id)
        .sort((a, b) => a.booth_number.localeCompare(b.booth_number)),
    [dataset.tenants, event.id]
  );

  const locationOptions = useMemo(() => {
    const zones = event.venue_zones ?? ['Main Stage', 'Photo Zone A'];
    const boothLocations = eventBooths.map(
      (b) => `Booth ${b.booth_number} (${b.booth_name})`
    );
    return [...zones, ...boothLocations];
  }, [event.venue_zones, eventBooths]);

  const effectiveLocation = targetLocation || locationOptions[0] || 'Main Stage';

  const canPostToEvent = useMemo(() => {
    if (!currentUser || isEventArchived) return false;
    if (currentUser.is_admin) return true;
    const hasParticipant = dataset.event_participants.some(
      (p) => p.event_id === event.id && p.user_id === currentUser.id
    );
    const hasTenant = dataset.tenants.some(
      (t) => t.event_id === event.id && t.user_id === currentUser.id
    );
    return hasParticipant || hasTenant;
  }, [currentUser, isEventArchived, dataset.event_participants, dataset.tenants, event.id]);

  const senderRole: ChatSenderRole = useMemo(() => {
    if (currentUser?.is_admin) return 'organizer';
    if (
      activeViewMode === 'merchant' &&
      eventBooths.some((b) => b.user_id === currentUser?.id)
    ) {
      return 'merchant';
    }
    return 'buyer';
  }, [currentUser, activeViewMode, eventBooths]);

  const eventMessages = useMemo(() => {
    const all = dataset.event_chat_messages.filter((m) => m.event_id === event.id);

    const filtered = all.filter((msg) => {
      if (msg.message_type === 'admin_announcement') {
        return locationFilter === 'ALL' && activityFilter === 'ALL' && !characterFilter.trim();
      }
      if (
        characterFilter.trim() &&
        !(msg.target_character ?? '')
          .toLowerCase()
          .includes(characterFilter.trim().toLowerCase())
      ) {
        return false;
      }
      if (locationFilter !== 'ALL' && msg.target_location !== locationFilter) {
        return false;
      }
      if (activityFilter !== 'ALL' && msg.target_activity !== activityFilter) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [
    dataset.event_chat_messages,
    event.id,
    characterFilter,
    locationFilter,
    activityFilter,
  ]);

  const handleSelectCharacterChip = (char: string) => {
    // Tapping an already-selected chip always keeps it active (never wipes input)
    setTargetCharacter(char);
    if (postingError) setPostingError(null);
  };

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !isOrganizer) return;
    const cleanText = announcementText.trim();
    if (!cleanText) {
      setPostingError('Please write an announcement message before posting.');
      return;
    }

    setPostingError(null);
    setSubmitting(true);
    try {
      const { message: newMsg } = await apiClient.createMeetupMessage(
        event.id,
        {
          message_type: 'admin_announcement',
          announcement_text: cleanText,
          is_pinned: pinAnnouncement,
          sender_role: 'organizer',
        },
        currentUser
      );

      onDatasetChange((prev) => ({
        ...prev,
        event_chat_messages: [newMsg, ...prev.event_chat_messages],
      }));
      setAnnouncementText('');
      await soundFeedback.playTapTick();
    } catch (err) {
      setPostingError(
        err instanceof Error ? err.message : 'Unable to post announcement.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostLookingFor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !canPostToEvent) return;

    const cleanChar = targetCharacter.trim();
    if (cleanChar.length < 2) {
      setPostingError('Please pick a character chip or enter a character name (2+ characters).');
      return;
    }

    setPostingError(null);
    setSubmitting(true);
    try {
      const { message: newMsg } = await apiClient.createMeetupMessage(
        event.id,
        {
          message_type: 'looking_for',
          target_character: cleanChar,
          target_location: effectiveLocation,
          target_activity: targetActivity,
          sender_role: senderRole,
        },
        currentUser
      );

      onDatasetChange((prev) => ({
        ...prev,
        event_chat_messages: [newMsg, ...prev.event_chat_messages],
      }));
      setTargetCharacter('');
      await soundFeedback.playTapTick();
    } catch (err) {
      setPostingError(
        err instanceof Error ? err.message : 'Unable to post meetup request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleInterested = async (msg: EventChatMessage) => {
    if (!currentUser || !canPostToEvent) return;
    await soundFeedback.playTapTick();

    const { message: updatedMsg } = await apiClient.toggleMeetupInterest(
      msg.id,
      currentUser.id
    );

    onDatasetChange((prev) => ({
      ...prev,
      event_chat_messages: prev.event_chat_messages.map((m) =>
        m.id === updatedMsg.id ? updatedMsg : m
      ),
    }));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Left 5 Cols: Cosplay & Meetup Finder */}
      <div className="lg:col-span-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-5 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-sky-400" />
              <h2 className="text-base font-bold text-white">
                Cosplay &amp; Meetup Finder
              </h2>
            </div>
            <span className="text-xs font-semibold text-emerald-300">
              Verified Board
            </span>
          </div>

          {isOrganizer && (
            <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setComposerMode('announcement');
                  setPostingError(null);
                }}
                className={`min-h-[38px] rounded-lg py-1.5 font-semibold transition ${
                  composerMode === 'announcement'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Announcement
              </button>
              <button
                type="button"
                onClick={() => {
                  setComposerMode('looking_for');
                  setPostingError(null);
                }}
                className={`min-h-[38px] rounded-lg py-1.5 font-semibold transition ${
                  composerMode === 'looking_for'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Meetup Request
              </button>
            </div>
          )}

          {postingError && (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200"
            >
              {postingError}
            </div>
          )}

          {!canPostToEvent ? (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400">
              {isEventArchived
                ? 'This event has ended. Meetup posts are read-only.'
                : 'Check in with an Event Ticket Code to post or join meetups.'}
            </div>
          ) : isOrganizer && composerMode === 'announcement' ? (
            <form onSubmit={handlePostAnnouncement} noValidate className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="admin-announcement-text"
                  className="mb-1.5 block text-xs font-semibold text-amber-300"
                >
                  Official Organizer Announcement
                </label>
                <textarea
                  id="admin-announcement-text"
                  rows={4}
                  value={announcementText}
                  onChange={(e) => {
                    setAnnouncementText(e.target.value);
                    if (postingError) setPostingError(null);
                  }}
                  placeholder="Share stage schedules, Gold Boost alerts, or closing reminders..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <label className="flex min-h-[36px] items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={pinAnnouncement}
                  onChange={(e) => setPinAnnouncement(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-amber-500"
                />
                <span>Pin announcement to top of board</span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
              >
                <Megaphone className="h-4 w-4" />
                <span>{submitting ? 'Publishing...' : 'Publish Announcement'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handlePostLookingFor} noValidate className="mt-4 space-y-4">
              <p className="text-xs text-slate-400">
                Pick a character, venue spot, and activity to post a meetup card:
              </p>

              {/* 1. Cosplayer / Character */}
              <div>
                <label
                  htmlFor="chat-character"
                  className="mb-1.5 block text-xs font-semibold text-slate-200"
                >
                  1. Cosplayer / Character
                </label>
                <div className="relative">
                  <input
                    id="chat-character"
                    type="text"
                    value={targetCharacter}
                    onChange={(e) => {
                      setTargetCharacter(e.target.value);
                      if (postingError) setPostingError(null);
                    }}
                    placeholder="Type a character or tap a tag..."
                    className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-3.5 pr-11 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                  {targetCharacter && (
                    <button
                      type="button"
                      onClick={() => setTargetCharacter('')}
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                      aria-label="Clear character"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {POPULAR_CHARACTER_CHIPS.map((char) => {
                    const isSelected =
                      targetCharacter.trim().toLowerCase() === char.toLowerCase();
                    return (
                      <button
                        key={char}
                        type="button"
                        onClick={() => handleSelectCharacterChip(char)}
                        aria-pressed={isSelected}
                        className={`min-h-[36px] rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          isSelected
                            ? 'border-sky-400 bg-sky-500/25 text-sky-100'
                            : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {char}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Location / Booth */}
              <div>
                <label
                  htmlFor="chat-location"
                  className="mb-1.5 block text-xs font-semibold text-slate-200"
                >
                  2. Location / Booth
                </label>
                <select
                  id="chat-location"
                  value={effectiveLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none"
                >
                  {locationOptions.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Activity */}
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-200">
                  3. Activity
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_TAGS.map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setTargetActivity(act)}
                      className={`min-h-[36px] rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                        targetActivity === act
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview */}
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
                <p className="text-[11px] font-semibold text-sky-300">Preview</p>
                <p className="mt-1 leading-relaxed">
                  &ldquo;Looking for{' '}
                  <strong className="text-white">
                    {targetCharacter.trim() || '[Character]'}
                  </strong>{' '}
                  at <strong className="text-white">{effectiveLocation}</strong> for{' '}
                  <strong className="text-white">{targetActivity}</strong>&rdquo;
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{submitting ? 'Posting...' : 'Post Meetup Request'}</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Right 7 Cols: Filterable Live Meetup Board */}
      <div className="space-y-4 lg:col-span-7">
        {/* Filters Bar */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <Filter className="h-3.5 w-3.5 text-sky-400" />
              Filter Meetups
            </span>
            {(characterFilter || locationFilter !== 'ALL' || activityFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setCharacterFilter('');
                  setLocationFilter('ALL');
                  setActivityFilter('ALL');
                }}
                className="text-xs font-semibold text-sky-400 hover:underline"
              >
                Reset
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={characterFilter}
                onChange={(e) => setCharacterFilter(e.target.value)}
                placeholder="Character..."
                className="min-h-[40px] w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-8 pr-8 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
              {characterFilter && (
                <button
                  type="button"
                  onClick={() => setCharacterFilter('')}
                  className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:text-white"
                  aria-label="Clear character filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="ALL">All Locations</option>
              {locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>

            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="ALL">All Activities</option>
              {ACTIVITY_TAGS.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Feed Messages */}
        <div className="space-y-3">
          {eventMessages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center text-xs text-slate-400">
              No matching meetup requests yet.
            </div>
          ) : (
            eventMessages.map((msg) => {
              const isAnnouncement = msg.message_type === 'admin_announcement';
              const isInterested = currentUser
                ? msg.interested_user_ids.includes(currentUser.id)
                : false;

              if (isAnnouncement) {
                return (
                  <article
                    key={msg.id}
                    className="rounded-2xl border border-amber-400/50 bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-900 p-4 shadow-lg"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-amber-300">
                        <Megaphone className="h-3.5 w-3.5" />
                        <span>Official Announcement</span>
                        {msg.is_pinned && (
                          <span className="inline-flex items-center gap-0.5 text-amber-200">
                            &middot; <Pin className="h-3 w-3" /> Pinned
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {msg.sender_username} &middot;{' '}
                        {new Date(msg.created_at).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <p className="mt-2.5 text-sm font-medium leading-relaxed text-amber-50">
                      {msg.announcement_text}
                    </p>

                    <div className="mt-3 flex items-center justify-end">
                      <button
                        type="button"
                        disabled={!canPostToEvent}
                        onClick={() => void handleToggleInterested(msg)}
                        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                          isInterested
                            ? 'border-amber-400 bg-amber-500/25 text-amber-200'
                            : 'border-slate-700 bg-slate-950/80 text-slate-300 hover:border-amber-400/50'
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>
                          {isInterested ? 'Interested ✓' : "I'm Interested"} (
                          {msg.interested_user_ids.length})
                        </span>
                      </button>
                    </div>
                  </article>
                );
              }

              const roleLabel =
                msg.sender_role === 'merchant'
                  ? 'Booth'
                  : msg.sender_role === 'organizer'
                    ? 'Organizer'
                    : 'Attendee';

              return (
                <article
                  key={msg.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/85 p-4 shadow-md transition hover:border-slate-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-sm font-bold text-white">
                        {msg.sender_username}
                      </span>
                      <span className="text-slate-500" aria-hidden="true">
                        &middot;
                      </span>
                      <span
                        className={`font-semibold ${
                          msg.sender_role === 'merchant'
                            ? 'text-emerald-300'
                            : msg.sender_role === 'organizer'
                              ? 'text-amber-300'
                              : 'text-indigo-300'
                        }`}
                      >
                        {roleLabel}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {new Date(msg.created_at).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <p className="mt-2.5 text-sm leading-relaxed text-slate-200">
                    Looking for{' '}
                    <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/15 px-2 py-0.5 font-bold text-sky-300">
                      <Sparkles className="h-3 w-3" />
                      {msg.target_character}
                    </span>{' '}
                    at{' '}
                    <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-200">
                      <MapPin className="h-3 w-3" />
                      {msg.target_location}
                    </span>{' '}
                    for{' '}
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                      <Tag className="h-3 w-3" />
                      {msg.target_activity}
                    </span>
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 tabular-nums">
                      <Users className="h-3.5 w-3.5" />
                      {msg.interested_user_ids.length} interested
                    </span>
                    <button
                      type="button"
                      disabled={!canPostToEvent}
                      onClick={() => void handleToggleInterested(msg)}
                      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                        isInterested
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-emerald-500/50 hover:text-white'
                      }`}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>{isInterested ? 'Interested ✓' : "I'm Interested"}</span>
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};