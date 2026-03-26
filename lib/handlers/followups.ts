// lib/handlers/followups.ts
// Finn — Supplier email follow-up automation
// After Finn sends an email, a follow-up is scheduled.
// Cron checks if the supplier replied within 2 business days.
// If not, posts reminder to Slack. After 3 rounds, escalates.

import { gmail_hasReply } from './gmail';
import { postToSlackChannel } from './slack';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kv: any | null = null;

async function getKV() {
  if (kv) return kv;
  if (!process.env.KV_REST_API_URL) return null;
  try {
    const { kv: vercelKv } = await import('@vercel/kv');
    kv = vercelKv;
    return kv;
  } catch {
    return null;
  }
}

const KV_KEY = 'finn:followups';
const MAX_ROUNDS = 3;

// ========================================
// DATA TYPES
// ========================================

export interface FollowUp {
  id: string;
  supplier_name: string;
  supplier_email: string;
  org_id?: number;
  subject: string;
  sent_at: string;          // ISO date
  due_at: string;           // ISO date — when to check for reply
  status: 'pending' | 'replied' | 'escalated' | 'resolved';
  check_count: number;
  slack_thread_ts?: string; // thread to post updates in
  last_checked?: string;
}

// ========================================
// BUSINESS DAY HELPERS
// ========================================

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

// ========================================
// CRUD
// ========================================

async function getFollowUps(): Promise<FollowUp[]> {
  const store = await getKV();
  if (!store) return [];
  const data = await store.get(KV_KEY);
  return (data as FollowUp[]) || [];
}

async function saveFollowUps(followups: FollowUp[]): Promise<void> {
  const store = await getKV();
  if (!store) return;
  await store.set(KV_KEY, followups);
}

export async function createFollowUp(opts: {
  supplier_name: string;
  supplier_email: string;
  org_id?: number;
  subject: string;
}): Promise<FollowUp | null> {
  const store = await getKV();
  if (!store) {
    console.log('[followups] KV not configured, skipping follow-up creation');
    return null;
  }

  const now = new Date();
  const followup: FollowUp = {
    id: `fu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    supplier_name: opts.supplier_name,
    supplier_email: opts.supplier_email,
    org_id: opts.org_id,
    subject: opts.subject,
    sent_at: now.toISOString(),
    due_at: addBusinessDays(now, 2).toISOString(),
    status: 'pending',
    check_count: 0,
  };

  const existing = await getFollowUps();
  existing.push(followup);
  await saveFollowUps(existing);

  console.log(`[followups] Created follow-up for ${opts.supplier_name} (${opts.supplier_email}), due ${followup.due_at}`);
  return followup;
}

// ========================================
// PROCESS FOLLOW-UPS (called by cron)
// ========================================

export async function processFollowUps(): Promise<{
  checked: number;
  replied: number;
  escalated: number;
  still_pending: number;
}> {
  const followups = await getFollowUps();
  const now = new Date();
  const finnChannel = process.env.FINN_SLACK_CHANNEL;

  let checked = 0;
  let replied = 0;
  let escalated = 0;
  let still_pending = 0;

  const pending = followups.filter(
    (f) => f.status === 'pending' && new Date(f.due_at) <= now
  );

  for (const fu of pending) {
    checked++;
    fu.check_count++;
    fu.last_checked = now.toISOString();

    // Check if supplier replied
    const reply = await gmail_hasReply(fu.supplier_email, new Date(fu.sent_at));

    if (reply.hasReply) {
      fu.status = 'replied';
      replied++;

      if (finnChannel) {
        await postToSlackChannel(
          finnChannel,
          `${fu.supplier_name} replied to "${fu.subject}" — ${reply.snippet?.slice(0, 100) || 'see inbox'}`,
          'normal'
        );
      }
      continue;
    }

    // No reply
    if (fu.check_count >= MAX_ROUNDS) {
      // Escalate after 3 rounds (6+ business days)
      fu.status = 'escalated';
      escalated++;

      if (finnChannel) {
        await postToSlackChannel(
          finnChannel,
          `No reply from ${fu.supplier_name} after ${fu.check_count} checks (sent ${fu.sent_at.split('T')[0]}). Subject: "${fu.subject}". Manual follow-up needed.`,
          'high'
        );
      }
    } else {
      // Reschedule for 2 more business days
      fu.due_at = addBusinessDays(now, 2).toISOString();
      still_pending++;

      if (finnChannel) {
        await postToSlackChannel(
          finnChannel,
          `Still waiting on ${fu.supplier_name} — "${fu.subject}" (check ${fu.check_count}/${MAX_ROUNDS}, sent ${fu.sent_at.split('T')[0]}). Will check again ${fu.due_at.split('T')[0]}.`,
          'normal'
        );
      }
    }
  }

  // Save updated state
  // Clean up: remove resolved/replied older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cleaned = followups.filter(
    (f) =>
      f.status === 'pending' ||
      f.status === 'escalated' ||
      new Date(f.sent_at) > thirtyDaysAgo
  );

  await saveFollowUps(cleaned);

  console.log(
    `[followups] Processed: checked=${checked} replied=${replied} escalated=${escalated} pending=${still_pending}`
  );

  return { checked, replied, escalated, still_pending };
}
