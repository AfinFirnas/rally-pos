import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDualIdrCheckout,
  formatIdr,
  generateCryptographicQrCode,
  isValidEventQrCode,
  parseIdrInput,
  validateAntiFraudAndCooldown,
} from '../lib/ledgerEngine';
import { DEMO_SEED_DATA, EVENT_IDS, TENANT_IDS, verifySeedIntegrity } from '../db/seed';
import { apiClient } from './apiClient';

test('seed integrity check passes with zero mismatches', () => {
  const report = verifySeedIntegrity();
  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
});

test('ledgerEngine formats and parses IDR cleanly', () => {
  assert.equal(formatIdr(125000), 'Rp 125.000');
  assert.equal(parseIdrInput('Rp 25.000'), 25000);
  const qr = generateCryptographicQrCode();
  assert.equal(isValidEventQrCode(qr, true), true);
});

test('ledgerEngine enforces 180s same-booth cooldown and dual-IDR math', () => {
  const event = DEMO_SEED_DATA.events.find((e) => e.id === EVENT_IDS.ACTIVE_COMIFURO)!;
  const participant = {
    ...DEMO_SEED_DATA.event_participants.find((p) => p.event_id === event.id)!,
    actual_spent_idr: 100_000,
    leaderboard_idr: 100_000,
    streak_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const tenant = {
    ...DEMO_SEED_DATA.tenants.find((t) => t.id === TENANT_IDS.T02)!,
    is_cold_bounty: true,
    cold_bounty_expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    cold_bounty_multiplier: 1.25,
    is_hidden_bounty: true,
    hidden_bounty_bonus_idr: 25_000,
  };

  const nowMs = Date.now();
  const calc = calculateDualIdrCheckout({
    actualAmountIdr: 50_000,
    event,
    participant,
    tenant,
    recentParticipantTransactions: [],
    recentTenantTransactions: [],
    existingBoothStamp: false,
    now: nowMs,
  });

  assert.equal(calc.allowed, true);
  assert.equal(calc.actualAmountIdr, 50_000);
  // Additive streak (1.25) + cold bounty (1.25) = 1.50x -> 50,000 * 1.50 = 75,000 + 25,000 hidden bounty = 100,000
  assert.equal(calc.multiplierApplied, 1.5);
  assert.equal(calc.leaderboardAmountIdr, 100_000);
  assert.equal(calc.newParticipantLeaderboardIdr, 200_000);
  assert.equal(calc.shouldUnlockBoothStamp, true);

  const cooldownBlocked = validateAntiFraudAndCooldown({
    participantId: participant.id,
    tenantId: tenant.id,
    actualAmountIdr: 50_000,
    recentParticipantTransactions: [
      {
        id: 'tx-recent',
        tenant_id: tenant.id,
        actual_amount_idr: 50_000,
        status: 'completed',
        created_at: new Date(nowMs - 30_000).toISOString(),
      },
    ],
    recentTenantTransactions: [],
    now: nowMs,
  });

  assert.equal(cooldownBlocked.allowed, false);
  assert.ok(cooldownBlocked.remainingCooldownSeconds > 140);
});

test('apiClient standalone fallback supports demo check-in, POS checkout, idempotency, void, and meetups', async () => {
  apiClient.resetLocalState();

  const auth = await apiClient.loginDemo('fresh_buyer');
  assert.equal(auth.user.username, 'DemoExplorer');

  const checkIn = await apiClient.checkInEvent(
    EVENT_IDS.ACTIVE_COMIFURO,
    { uid_code: 'TKT-DEMO-BYR' },
    auth.user.id
  );
  assert.equal(checkIn.role_type, 'buyer');
  assert.equal(checkIn.check_in_stamp.stamp_type, 'checkin');
  assert.ok(checkIn.participant.qr_code.startsWith('EV-'));

  const clientTxId = 'offline-test-tx-001';
  const checkout = await apiClient.processPosCheckout({
    client_tx_id: clientTxId,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    tenant_id: TENANT_IDS.T01,
    buyer_qr_code: checkIn.participant.qr_code,
    actual_amount_idr: 50_000,
    item_summary: [{ item_name: 'Artbook', quantity: 1, unit_price_idr: 50_000 }],
  });

  assert.equal(checkout.transaction.actual_amount_idr, 50_000);
  assert.equal(checkout.participant.actual_spent_idr, 50_000);
  assert.ok(checkout.unlocked_stamp);

  // Duplicate client_tx_id returns idempotent response without double-charging
  const duplicateCheckout = await apiClient.processPosCheckout({
    client_tx_id: clientTxId,
    event_id: EVENT_IDS.ACTIVE_COMIFURO,
    tenant_id: TENANT_IDS.T01,
    buyer_qr_code: checkIn.participant.qr_code,
    actual_amount_idr: 50_000,
    item_summary: [{ item_name: 'Artbook', quantity: 1, unit_price_idr: 50_000 }],
  });
  assert.equal(duplicateCheckout.transaction.id, checkout.transaction.id);
  assert.equal(duplicateCheckout.participant.actual_spent_idr, 50_000);

  // Reversal with Organizer PIN 123456 reverses spend and booth stamp
  const reversed = await apiClient.reversePosTransaction({
    transaction_id: checkout.transaction.id,
    admin_void_pin: '123456',
  });
  assert.equal(reversed.transaction.status, 'voided');
  assert.equal(reversed.participant.actual_spent_idr, 0);
  assert.equal(reversed.reversed_stamp_id, checkout.unlocked_stamp?.id);

  // Meetup post & interest toggle
  const posted = await apiClient.createMeetupMessage(
    EVENT_IDS.ACTIVE_COMIFURO,
    {
      message_type: 'looking_for',
      target_character: 'Gojo Satoru',
      target_location: 'Main Hall',
      target_activity: 'Group Photo',
    },
    auth.user
  );
  const toggled = await apiClient.toggleMeetupInterest(posted.message.id, auth.user.id);
  assert.equal(toggled.interested, true);
  assert.equal(toggled.message.interested_user_ids.includes(auth.user.id), true);
});
