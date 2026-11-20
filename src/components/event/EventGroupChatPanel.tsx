import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { getSupabaseClient, useApp } from '../../context/AppContext';
import { soundFeedback } from '../../lib/soundFeedback';
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

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const EventGroupChatPanel: React.FC<EventGroupChatPanelProps> = ({
  event,
  dataset,
  onDatasetChange,
}) => {
  const { currentUser, activeViewMode } = useApp();

  // Structured "Looking For" Builder State
  const [targetCharacter, setTargetCharacter] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [targetActivity, setTargetActivity] = useState<string>(ACTIVITY_TAGS[0]);

  // Organizer Free-Text Official Announcement State
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

  const isOrganizer = Boolean(currentUser?.is_admin);
  const isEventArchived = event.status === 'archived';

  const eventBooths = useMemo(
    () =>
      dataset.tenants
        .filter((t) => t.event_id === event.id)
        .sort((a, b) => a.booth_number.localeCompare(b.booth_number)),
    [dataset.tenants, event.id]
  );

  // Auto-populated Location Dropdown (Venue Zones + Active Booths)
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

    // Pinned announcements stay on top, followed by newest messages
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

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !isOrganizer) return;
    const cleanText = announcementText.trim();
    if (!cleanText) {
      setPostingError('Please enter an announcement message.');
      return;
    }

    setPostingError(null);
    setSubmitting(true);
    try {
      const newMsg: EventChatMessage = {
        id: createUuid(),
        event_id: event.id,
        sender_user_id: currentUser.id,
        sender_username: currentUser.username,
        sender_role: 'organizer',
        message_type: 'admin_announcement',
        announcement_text: cleanText,
        target_character: null,
        target_location: null,
        target_activity: null,
        interested_user_ids: [],
        is_pinned: pinAnnouncement,
        created_at: new Date().toISOString(),
      };

      const supabase = getSupabaseClient();
      if (supabase) {
        const { data, error } = await supabase
          .from('event_chat_messages')
          .insert({
            event_id: event.id,
            sender_user_id: currentUser.id,
            sender_username: currentUser.username,
            sender_role: 'organizer',
            message_type: 'admin_announcement',
            announcement_text: cleanText,
            is_pinned: pinAnnouncement,
          })
          .select('*')
          .single();

        if (error) throw new Error(error.message);
        if (data) newMsg.id = (data as EventChatMessage).id;
      }

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
      setPostingError('Select or enter a Cosplayer / Character name.');
      return;
    }

    setPostingError(null);
    setSubmitting(true);
    try {
      const newMsg: EventChatMessage = {
        id: createUuid(),
        event_id: event.id,
        sender_user_id: currentUser.id,
        sender_username: currentUser.username,
        sender_role: senderRole,
        message_type: 'looking_for',
        announcement_text: null,
        target_character: cleanChar,
        target_location: effectiveLocation,
        target_activity: targetActivity,
        interested_user_ids: [],
        is_pinned: false,
        created_at: new Date().toISOString(),
      };

      const supabase = getSupabaseClient();
      if (supabase) {
        const { data, error } = await supabase
          .from('event_chat_messages')
          .insert({
            event_id: event.id,
            sender_user_id: currentUser.id,
            sender_username: currentUser.username,
            sender_role: senderRole,
            message_type: 'looking_for',
            target_character: cleanChar,
            target_location: effectiveLocation,
            target_activity: targetActivity,
          })
          .select('*')
          .single();

        if (error) throw new Error(error.message);
        if (data) newMsg.id = (data as EventChatMessage).id;
      }

      onDatasetChange((prev) => ({
        ...prev,
        event_chat_messages: [newMsg, ...prev.event_chat_messages],
      }));
      setTargetCharacter('');
      await soundFeedback.playTapTick();
    } catch (err) {
      setPostingError(
        err instanceof Error ? err.message : 'Unable to post Looking For card.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleInterested = async (msg: EventChatMessage) => {
    if (!currentUser || !canPostToEvent) return;
    await soundFeedback.playTapTick();

    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.rpc('toggle_chat_interest', { p_message_id: msg.id });
    }

    onDatasetChange((prev) => ({
      ...prev,
      event_chat_messages: prev.event_chat_messages.map((m) => {
        if (m.id !== msg.id) return m;
        const exists = m.interested_user_ids.includes(currentUser.id);
        return {
          ...m,
          interested_user_ids: exists
            ? m.interested_user_ids.filter((id) => id !== currentUser.id)
            : [...m.interested_user_ids, currentUser.id],
        };
      }),
    }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left 5 Cols: Role-Enforced Composer */}
      <div className="lg:col-span-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-sky-400" />
              <h2 className="text-base font-bold text-white">
                {isOrganizer ? 'Event Chat Composer' : 'Structured "Looking For" Builder'}
              </h2>
            </div>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Anti-Spam Active
            </span>
          </div>

          {isOrganizer && (
            <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              <button
                type="button"
                onClick={() => setComposerMode('announcement')}
                className={`rounded-lg py-1.5 font-semibold transition ${
                  composerMode === 'announcement'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Official Announcement
              </button>
              <button
                type="button"
                onClick={() => setComposerMode('looking_for')}
                className={`rounded-lg py-1.5 font-semibold transition ${
                  composerMode === 'looking_for'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Looking For Post
              </button>
            </div>
          )}

          {postingError && (
            <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
              {postingError}
            </div>
          )}

          {!canPostToEvent ? (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400">
              {isEventArchived
                ? 'This event is archived. Group chat is read-only.'
                : 'Join this event with a Ticket UID to post or ping in Group Chat.'}
            </div>
          ) : isOrganizer && composerMode === 'announcement' ? (
            <form onSubmit={handlePostAnnouncement} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="admin-announcement-text"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-amber-300"
                >
                  Official Organizer Announcement
                </label>
                <textarea
                  id="admin-announcement-text"
                  rows={4}
                  required
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                  placeholder="Share stage schedules, Cold-Booth Bounty alerts, or closing reminders..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={pinAnnouncement}
                  onChange={(e) => setPinAnnouncement(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-amber-500"
                />
                <span>Pin announcement to top of Event Chat</span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
              >
                <Megaphone className="h-4 w-4" />
                <span>{submitting ? 'Publishing...' : 'Broadcast Official Announcement'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handlePostLookingFor} className="mt-4 space-y-4">
              <p className="text-xs text-slate-400">
                Free-text chat is disabled to keep the board spam-free. Build a structured meetup
                card below:
              </p>

              {/* [Cosplayer / Character] */}
              <div>
                <label
                  htmlFor="chat-character"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  1. Cosplayer / Character
                </label>
                <input
                  id="chat-character"
                  type="text"
                  required
                  value={targetCharacter}
                  onChange={(e) => setTargetCharacter(e.target.value)}
                  placeholder="Type custom character or tap chip..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {POPULAR_CHARACTER_CHIPS.map((char) => (
                    <button
                      key={char}
                      type="button"
                      onClick={() => setTargetCharacter(char)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        targetCharacter === char
                          ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* [Location / Booth] */}
              <div>
                <label
                  htmlFor="chat-location"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  2. Location / Booth
                </label>
                <select
                  id="chat-location"
                  value={effectiveLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none"
                >
                  {locationOptions.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              {/* [Activity] */}
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  3. Activity
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_TAGS.map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setTargetActivity(act)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
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

              {/* Live Sentence Preview */}
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                  Preview
                </span>
                <p className="mt-1 leading-relaxed">
                  &ldquo;Looking for{' '}
                  <strong className="text-white">
                    {targetCharacter.trim() || '[Cosplayer / Character]'}
                  </strong>{' '}
                  at <strong className="text-white">{effectiveLocation}</strong> for{' '}
                  <strong className="text-white">{targetActivity}</strong>&rdquo;
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{submitting ? 'Posting...' : 'Post Looking For Card'}</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Right 7 Cols: Filterable Live Event Chat Feed */}
      <div className="space-y-4 lg:col-span-7">
        {/* Filters Bar */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
              <Filter className="h-3.5 w-3.5 text-sky-400" />
              Filter Group Board
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
                Reset Filters
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={characterFilter}
                onChange={(e) => setCharacterFilter(e.target.value)}
                placeholder="Character..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-8 pr-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="ALL">All Locations / Booths</option>
              {locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>

            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
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
              No matching posts in this event chat yet.
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
                          <Megaphone className="h-3 w-3" />
                          Official Announcement
                        </span>
                        {msg.is_pinned && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-200">
                            <Pin className="h-3 w-3" />
                            Pinned
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">
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
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                          isInterested
                            ? 'border-amber-400 bg-amber-500/25 text-amber-200'
                            : 'border-slate-700 bg-slate-950/80 text-slate-300 hover:border-amber-400/50'
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>
                          {isInterested ? 'Interested' : "I'm Here / Interested"} (
                          {msg.interested_user_ids.length})
                        </span>
                      </button>
                    </div>
                  </article>
                );
              }

              return (
                <article
                  key={msg.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/85 p-4 shadow-md transition hover:border-slate-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {msg.sender_username}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          msg.sender_role === 'merchant'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : msg.sender_role === 'organizer'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-indigo-500/20 text-indigo-300'
                        }`}
                      >
                        {msg.sender_role}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
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
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Users className="h-3.5 w-3.5" />
                      {msg.interested_user_ids.length} interested
                    </span>
                    <button
                      type="button"
                      disabled={!canPostToEvent}
                      onClick={() => void handleToggleInterested(msg)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                        isInterested
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-emerald-500/50 hover:text-white'
                      }`}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>
                        {isInterested ? "Pinged (I'm Here!)" : "I'm Here / Interested"}
                      </span>
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