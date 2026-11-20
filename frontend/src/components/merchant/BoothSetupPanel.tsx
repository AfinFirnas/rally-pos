import React, { useMemo, useState } from 'react';
import {
  Check,
  ImagePlus,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { formatIdr, parseIdrInput } from '../../lib/ledgerEngine';
import { soundFeedback } from '../../lib/soundFeedback';
import { apiClient } from '../../services/apiClient';
import type { DemoSeedDataset, Event, Tenant, TenantItem } from '../../types/types';

interface BoothSetupPanelProps {
  event: Event;
  tenant: Tenant;
  dataset: DemoSeedDataset;
  onDatasetChange: (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => void;
}

function makePresetStampSvg(label: string, bg: string, accent: string, emoji: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="22" fill="${bg}"/><circle cx="60" cy="54" r="34" fill="${accent}" opacity="0.22"/><circle cx="60" cy="54" r="28" fill="none" stroke="${accent}" stroke-width="4" stroke-dasharray="6 4"/><text x="60" y="64" font-size="34" text-anchor="middle" dominant-baseline="middle">${emoji}</text><text x="60" y="103" font-family="system-ui,sans-serif" font-weight="800" font-size="11" fill="#ffffff" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PRESET_STAMP_ARTWORKS = [
  { id: 'kitsune', label: 'Kitsune', url: makePresetStampSvg('KITSUNE', '#7C3AED', '#FDE047', '🦊') },
  { id: 'neko', label: 'Neko', url: makePresetStampSvg('NEKO', '#0F766E', '#5EEAD4', '🐱') },
  { id: 'mecha', label: 'Mecha', url: makePresetStampSvg('MECHA', '#1E3A8A', '#60A5FA', '🤖') },
  { id: 'starlight', label: 'Starlight', url: makePresetStampSvg('STAR', '#BE185D', '#F9A8D4', '⚔️') },
  { id: 'matcha', label: 'Matcha', url: makePresetStampSvg('CAFE', '#15803D', '#BEF264', '🍵') },
  { id: 'arcade', label: 'Arcade', url: makePresetStampSvg('ARCADE', '#334155', '#38BDF8', '🕹️') },
];

/**
- Center-crops any uploaded image file into a crisp 256x256 (1:1) PNG data URL.
 */
async function cropImageToSquareDataUrl(file: File, targetSize = 256): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode uploaded image file.'));
      image.src = objectUrl;
    });

    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const offsetX = Math.floor((img.naturalWidth - side) / 2);
    const offsetY = Math.floor((img.naturalHeight - side) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }
    ctx.drawImage(img, offsetX, offsetY, side, side, 0, 0, targetSize, targetSize);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const BoothSetupPanel: React.FC<BoothSetupPanelProps> = ({
  event,
  tenant,
  dataset,
  onDatasetChange,
}) => {
  const [boothName, setBoothName] = useState(tenant.booth_name);
  const [boothNumber, setBoothNumber] = useState(tenant.booth_number);
  const [description, setDescription] = useState(tenant.description);
  const [stampImageUrl, setStampImageUrl] = useState(
    tenant.stamp_image_url || PRESET_STAMP_ARTWORKS[0].url
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Quick-Tap Item Creation / Editing State
  const [newItemName, setNewItemName] = useState('');
  const [newItemPriceRaw, setNewItemPriceRaw] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemPriceRaw, setEditItemPriceRaw] = useState('');
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemBusy, setItemBusy] = useState(false);

  const boothItems = useMemo(
    () =>
      dataset.tenant_items
        .filter((i) => i.tenant_id === tenant.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    [dataset.tenant_items, tenant.id]
  );

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileError(null);
    try {
      const squareDataUrl = await cropImageToSquareDataUrl(file, 256);
      setStampImageUrl(squareDataUrl);
      await soundFeedback.playTapTick();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to process image.');
    }
  };

  const handleSaveBoothProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = boothName.trim();
    const cleanNumber = boothNumber.trim().toUpperCase();
    if (cleanName.length < 2) {
      setProfileError('Booth Name must be at least 2 characters.');
      return;
    }
    if (!cleanNumber) {
      setProfileError('Booth Number is required (e.g. A-01).');
      return;
    }

    setSavingProfile(true);
    setProfileError(null);
    setProfileNotice(null);

    try {
      const { tenant: updatedTenant } = await apiClient.updateBoothProfile(tenant.id, {
        booth_name: cleanName,
        booth_number: cleanNumber,
        description: description.trim(),
        stamp_image_url: stampImageUrl,
      });

      onDatasetChange((prev) => ({
        ...prev,
        tenants: prev.tenants.map((t) =>
          t.id === updatedTenant.id ? updatedTenant : t
        ),
      }));

      await soundFeedback.playSuccessChime(false);
      setProfileNotice('Booth profile and 1:1 stamp badge saved!');
    } catch (err) {
      await soundFeedback.playErrorTone(false);
      setProfileError(err instanceof Error ? err.message : 'Could not save booth profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newItemName.trim();
    const priceIdr = parseIdrInput(newItemPriceRaw);
    if (!cleanName) {
      setItemError('Item name is required.');
      return;
    }
    if (priceIdr <= 0) {
      setItemError('Price must be greater than Rp 0.');
      return;
    }

    setItemBusy(true);
    setItemError(null);

    try {
      const nextSort =
        boothItems.reduce((max, i) => Math.max(max, i.sort_order), 0) + 1;
      const { item: newItem } = await apiClient.createBoothItem(tenant.id, {
        item_name: cleanName,
        price_idr: priceIdr,
        sort_order: nextSort,
        is_active: true,
      });

      onDatasetChange((prev) => ({
        ...prev,
        tenant_items: [...prev.tenant_items, newItem],
      }));

      setNewItemName('');
      setNewItemPriceRaw('');
      await soundFeedback.playTapTick();
    } catch (err) {
      setItemError(err instanceof Error ? err.message : 'Failed to add item.');
    } finally {
      setItemBusy(false);
    }
  };

  const startEditingItem = (item: TenantItem) => {
    setEditingItemId(item.id);
    setEditItemName(item.item_name);
    setEditItemPriceRaw(String(item.price_idr));
    setItemError(null);
  };

  const handleSaveEditItem = async (itemId: string) => {
    const cleanName = editItemName.trim();
    const priceIdr = parseIdrInput(editItemPriceRaw);
    if (!cleanName || priceIdr <= 0) {
      setItemError('Provide a valid item name and IDR price > 0.');
      return;
    }

    setItemBusy(true);
    try {
      const { item: updatedItem } = await apiClient.updateBoothItem(
        tenant.id,
        itemId,
        { item_name: cleanName, price_idr: priceIdr }
      );

      onDatasetChange((prev) => ({
        ...prev,
        tenant_items: prev.tenant_items.map((i) =>
          i.id === updatedItem.id ? updatedItem : i
        ),
      }));

      setEditingItemId(null);
      await soundFeedback.playTapTick();
    } catch (err) {
      setItemError(err instanceof Error ? err.message : 'Failed to update item.');
    } finally {
      setItemBusy(false);
    }
  };

  const handleToggleItemActive = async (item: TenantItem) => {
    const nextActive = !item.is_active;
    const { item: updatedItem } = await apiClient.updateBoothItem(
      tenant.id,
      item.id,
      { is_active: nextActive }
    );
    onDatasetChange((prev) => ({
      ...prev,
      tenant_items: prev.tenant_items.map((i) =>
        i.id === updatedItem.id ? updatedItem : i
      ),
    }));
  };

  const handleDeleteItem = async (itemId: string) => {
    await apiClient.deleteBoothItem(tenant.id, itemId);
    onDatasetChange((prev) => ({
      ...prev,
      tenant_items: prev.tenant_items.filter((i) => i.id !== itemId),
    }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left: Booth Info & 1:1 Stamp Badge */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 lg:col-span-6">
        <div className="flex items-center gap-2.5">
          <Store className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-lg font-bold text-white">Booth Profile &amp; 1:1 Stamp</h2>
            <p className="text-xs text-slate-400">
              Buyers spending &ge; {formatIdr(event.min_stamp_spend_idr)} unlock your square stamp
              artwork.
            </p>
          </div>
        </div>

        {profileError && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 text-xs text-rose-200">
            {profileError}
          </div>
        )}
        {profileNotice && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs text-emerald-200">
            {profileNotice}
          </div>
        )}

        <form onSubmit={handleSaveBoothProfile} className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="setup-booth-name"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Booth Name
              </label>
              <input
                id="setup-booth-name"
                type="text"
                required
                value={boothName}
                onChange={(e) => setBoothName(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="setup-booth-num"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Booth No.
              </label>
              <input
                id="setup-booth-num"
                type="text"
                required
                value={boothNumber}
                onChange={(e) => setBoothNumber(e.target.value.toUpperCase())}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-sm uppercase text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="setup-booth-desc"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              Description
            </label>
            <textarea
              id="setup-booth-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What merch or commissions does your booth offer?"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* 1:1 Square Stamp Artwork Cropper & Presets */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-2 border-emerald-400/70 bg-slate-900 shadow-lg">
                  <img
                    src={stampImageUrl}
                    alt="1:1 Stamp Preview"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-1 right-1 rounded bg-slate-950/80 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                    1:1
                  </span>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-white">
                    Custom 1:1 Stamp Mascot Artwork
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Any uploaded photo is auto-cropped to a 256&times;256 square stamp badge.
                  </p>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700">
                    <ImagePlus className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Or Pick a Fallback Preset Mascot
              </p>
              <div className="grid grid-cols-6 gap-2">
                {PRESET_STAMP_ARTWORKS.map((preset) => {
                  const selected = stampImageUrl === preset.url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setStampImageUrl(preset.url)}
                      className={`group overflow-hidden rounded-xl border p-0.5 transition ${
                        selected
                          ? 'border-emerald-400 ring-2 ring-emerald-400/40'
                          : 'border-slate-800 opacity-75 hover:opacity-100'
                      }`}
                      title={preset.label}
                    >
                      <img
                        src={preset.url}
                        alt={preset.label}
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            <span>{savingProfile ? 'Saving...' : 'Save Booth Settings'}</span>
          </button>
        </form>
      </section>

      {/* Right: Quick-Tap Merchandise Items CRUD */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 lg:col-span-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Tag className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-lg font-bold text-white">Quick-Tap POS Catalog</h2>
              <p className="text-xs text-slate-400">
                1-tap merchandise buttons displayed directly on your POS Terminal.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
            {boothItems.length} items
          </span>
        </div>

        {itemError && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 text-xs text-rose-200">
            {itemError}
          </div>
        )}

        {/* Add Item Form */}
        <form
          onSubmit={handleAddItem}
          className="mt-5 grid gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:grid-cols-12"
        >
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Item name (e.g. Sticker Pack)"
            className="sm:col-span-6 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            inputMode="numeric"
            value={
              newItemPriceRaw
                ? formatIdr(parseIdrInput(newItemPriceRaw))
                : ''
            }
            onChange={(e) => setNewItemPriceRaw(e.target.value)}
            placeholder="Rp 15.000"
            className="sm:col-span-4 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={itemBusy}
            className="sm:col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </form>

        {/* Catalog List */}
        <div className="mt-4 space-y-2">
          {boothItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-xs text-slate-400">
              <Sparkles className="mx-auto mb-2 h-5 w-5 text-slate-500" />
              Add your first quick-tap item above for faster checkout queues!
            </div>
          ) : (
            boothItems.map((item) => {
              const isEditing = editingItemId === item.id;
              return (
                <div
                  key={item.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 transition ${
                    item.is_active
                      ? 'border-slate-800 bg-slate-950/60'
                      : 'border-slate-800/60 bg-slate-950/30 opacity-60'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={editItemName}
                        onChange={(e) => setEditItemName(e.target.value)}
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatIdr(parseIdrInput(editItemPriceRaw))}
                        onChange={(e) => setEditItemPriceRaw(e.target.value)}
                        className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveEditItem(item.id)}
                        className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-500"
                        aria-label="Save item edit"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingItemId(null)}
                        className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:text-white"
                        aria-label="Cancel item edit"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {item.item_name}
                        </p>
                        <p className="font-mono text-xs font-bold text-emerald-300">
                          {formatIdr(item.price_idr)}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleItemActive(item)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                            item.is_active
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {item.is_active ? 'Active' : 'Hidden'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditingItem(item)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                          aria-label={`Edit ${item.item_name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                          aria-label={`Delete ${item.item_name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};