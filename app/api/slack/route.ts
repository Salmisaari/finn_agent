// app/api/slack/route.ts
// Finn — Slack webhook handler
//
// ARCHITECTURE: Return 200 immediately, process in background using waitUntil
// Slack requires acknowledgment within 3s; ACE loop takes 20-60s.

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import crypto from 'crypto';
import { runGenerator } from '@/lib/ace/generator';
import type { CallerContext } from '@/lib/ace/types';

// ========================================
// SUPPLIER NAME EXTRACTION (inline — no classifier needed)
// Finn always knows what suppliers are being discussed.
// Simple heuristics: capitalize words, known prefixes, quoted names.
// ========================================

function extractSupplierNames(text: string): string[] {
  const names: string[] = [];

  // Extract quoted names: "Blaklader", 'Nitras', etc.
  const quoted = text.match(/["']([A-Za-zÀ-ÿ\s\-&.]+)["']/g);
  if (quoted) {
    names.push(...quoted.map((s) => s.replace(/["']/g, '').trim()));
  }

  // Extract capitalized multi-word names after common trigger words
  const triggers = /\b(?:about|for|from|supplier|brand|contact|email|check|update|advance|ping|follow\s+up(?:\s+with)?|negotiate\s+with?)\s+([A-Z][A-Za-zÀ-ÿ\s\-&.]{2,30})/g;
  let match;
  while ((match = triggers.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (candidate && !['The', 'A', 'An', 'Our', 'Their'].includes(candidate)) {
      names.push(candidate);
    }
  }

  // 3-letter uppercase codes (SKU prefixes)
  const prefixes = text.match(/\b[A-Z]{3}\b/g);
  if (prefixes) {
    const excluded = new Set(['API', 'MOV', 'GMV', 'URL', 'FAQ', 'FTP', 'CEO', 'CTO', 'OKR', 'KPI']);
    names.push(...prefixes.filter((p) => !excluded.has(p)));
  }

  return [...new Set(names)].filter((n) => n.length > 2);
}

// ========================================
// DE-DUPLICATION (in-memory for simple cases)
// Use Vercel KV for production-grade dedup
// ========================================

const processedEvents = new Set<string>();

function isDuplicate(eventId: string): boolean {
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  // Clean up after 5 minutes to prevent memory leak
  setTimeout(() => processedEvents.delete(eventId), 5 * 60 * 1000);
  return false;
}

// ========================================
// SLACK SIGNATURE VERIFICATION
// ========================================

function verifySlackSignature(body: string, timestamp: string, signature: string): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[finn] SLACK_SIGNING_SECRET not configured');
    return false;
  }

  const requestTimestamp = parseInt(timestamp, 10);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - requestTimestamp) > 300) {
    console.error('[finn] Slack timestamp too old');
    return false;
  }

  const sigBase = `v0:${timestamp}:${body}`;
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex')}`;

  if (expected.length !== signature.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ========================================
// SLACK API HELPERS
// ========================================

async function sendSlackMessage(
  channel: string,
  text: string,
  thread_ts?: string,
  color?: '#5ba97b' | '#a0a0a0' | '#d4943a' | '#c94c4c'
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;

  const payload: Record<string, unknown> = color
    ? {
        channel,
        text: ' ',
        attachments: [
          {
            color,
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
            fallback: text.slice(0, 100),
          },
        ],
        thread_ts,
        unfurl_links: false,
      }
    : {
        channel,
        text,
        thread_ts,
        unfurl_links: false,
        unfurl_media: false,
      };

  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[finn] sendSlackMessage failed:', err);
  }
}

async function deleteMessage(channel: string, ts: string): Promise<boolean> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const res = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, ts }),
    });
    const result = await res.json();
    return result.ok;
  } catch {
    return false;
  }
}

async function getThreadContext(channel: string, threadTs: string): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return null;

  try {
    const res = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=20`,
      {
        headers: { Authorization: `Bearer ${botToken}` },
      }
    );
    const result = await res.json();
    if (!result.ok || !result.messages?.length) return null;

    const parts: string[] = [];
    for (const msg of result.messages) {
      const isFinn = msg.bot_id && msg.username === 'Finn';
      const sender = isFinn ? 'Finn' : msg.username || 'user';
      let text = msg.text || '';

      // Extract from attachments if text is empty
      if (!text.trim() && msg.attachments) {
        for (const att of msg.attachments) {
          if (att.blocks) {
            for (const block of att.blocks) {
              if (block.type === 'section' && block.text?.text) {
                text += block.text.text + '\n';
              }
            }
          }
          if (!text && att.fallback) text = att.fallback;
        }
      }

      const clean = text
        .replace(/<@[A-Z0-9]+>/g, '')
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
        .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
        .replace(/<([^>]+)>/g, '$1')
        .trim();

      if (clean) parts.push(`[${sender}]: ${clean}`);
    }

    return parts.length > 0 ? `THREAD CONTEXT:\n${parts.join('\n')}\n---` : null;
  } catch {
    return null;
  }
}

let cachedBotUserId: string | null = null;

async function getBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return null;

  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    });
    const result = await res.json();
    if (result.ok) {
      cachedBotUserId = result.user_id;
      return cachedBotUserId;
    }
  } catch {}
  return null;
}

async function handleFinnZap(channel: string, messageTs: string): Promise<void> {
  const botUserId = await getBotUserId();
  if (!botUserId) return;

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;

  try {
    const res = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel}&latest=${messageTs}&inclusive=true&limit=1`,
      { headers: { Authorization: `Bearer ${botToken}` } }
    );
    const result = await res.json();
    if (!result.ok || !result.messages?.length) return;

    const message = result.messages[0];
    if (message.user === botUserId || message.bot_id) {
      await deleteMessage(channel, messageTs);
    }
  } catch {}
}

// ========================================
// BACKGROUND PROCESSING
// ========================================

async function processInBackground(params: {
  query: string;
  userId: string;
  channel: string;
  threadTs: string;
  ts: string;
}) {
  const { query, userId, channel, threadTs, ts } = params;
  const startTime = Date.now();

  console.log(`[finn] Processing query from ${userId}: ${query.slice(0, 100)}`);

  try {
    const callerContext: CallerContext = {
      channel: 'slack',
      requestingUserId: userId,
      slackChannel: channel,
      slackThreadTs: threadTs,
    };

    // Extract supplier names inline (no classifier needed)
    const supplierNames = extractSupplierNames(query);

    // Run Finn generator loop
    const result = await runGenerator({
      slackMessage: query,
      requestingUser: userId,
      callerContext,
      supplierNames,
    });

    await sendSlackMessage(channel, result.response, threadTs, '#a0a0a0');

    console.log(
      `[finn] Complete in ${Date.now() - startTime}ms | suppliers=${supplierNames.join(',')} | tools=${result.toolCalls.length} | ts=${ts}`
    );
  } catch (err) {
    console.error('[finn] Background processing error:', err);
    try {
      await sendSlackMessage(
        channel,
        `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        threadTs,
        '#c94c4c'
      );
    } catch {}
  }
}

// ========================================
// WEBHOOK HANDLER
// ========================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const timestamp = request.headers.get('x-slack-request-timestamp') || '';
    const signature = request.headers.get('x-slack-signature') || '';

    if (!verifySlackSignature(body, timestamp, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(body);

    // URL verification (Slack app setup)
    if (event.type === 'url_verification') {
      return NextResponse.json({ challenge: event.challenge });
    }

    if (event.type === 'event_callback') {
      const slackEvent = event.event;

      // Handle @finn mentions
      if (slackEvent.type === 'app_mention') {
        const { text, user, channel, thread_ts, ts, bot_id, event_ts } = slackEvent;

        // Ignore bot messages
        if (bot_id) return NextResponse.json({ ok: true });

        // De-duplicate
        const eventId = `${channel}-${ts}-${event_ts}`;
        if (isDuplicate(eventId)) {
          console.log('[finn] Duplicate event, skipping:', eventId);
          return NextResponse.json({ ok: true });
        }

        // Extract query (remove @finn mention)
        let query = text.replace(/<@[A-Z0-9]+>/g, '').trim();
        const threadTs = thread_ts || ts;

        // Fetch thread context for replies
        if (thread_ts && thread_ts !== ts) {
          const threadCtx = await getThreadContext(channel, thread_ts);
          if (threadCtx) {
            query = `${threadCtx}\nUSER REQUEST: ${query}`;
          }
        }

        // Process in background (Slack needs <3s response)
        waitUntil(
          processInBackground({ query, userId: user, channel, threadTs, ts }).catch((err) =>
            console.error('[finn] waitUntil error:', err)
          )
        );

        return NextResponse.json({ ok: true });
      }

      // :finn-zap: reaction → delete Finn's message
      if (slackEvent.type === 'reaction_added' && slackEvent.reaction === 'finn-zap') {
        const item = slackEvent.item;
        if (item?.type === 'message') {
          waitUntil(
            handleFinnZap(item.channel, item.ts).catch((err) =>
              console.error('[finn] finn-zap error:', err)
            )
          );
        }
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[finn] Webhook error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'finn-agent',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
}
