// lib/handlers/slack.ts
// Finn — Slack posting helpers

const URGENCY_COLORS = {
  normal: '#a0a0a0',
  high: '#d4943a',
  critical: '#c94c4c',
} as const;

export async function postToSlackChannel(
  channel: string,
  message: string,
  urgency: 'normal' | 'high' | 'critical' = 'normal'
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    return { ok: false, error: 'SLACK_BOT_TOKEN not configured' };
  }

  const color = URGENCY_COLORS[urgency];

  const payload = {
    channel,
    text: ' ',
    attachments: [
      {
        color,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: message } }],
        fallback: message.slice(0, 100),
      },
    ],
    unfurl_links: false,
  };

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!result.ok) {
      console.error('[slack] postMessage error:', result.error);
      return { ok: false, error: result.error };
    }

    return { ok: true, ts: result.ts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[slack] postMessage failed:', msg);
    return { ok: false, error: msg };
  }
}

export async function sendSlackMessage(
  channel: string,
  text: string,
  thread_ts?: string,
  color?: '#5ba97b' | '#a0a0a0' | '#d4943a' | '#c94c4c'
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    return { ok: false, error: 'SLACK_BOT_TOKEN not configured' };
  }

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
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!result.ok) {
      console.error('[slack] sendMessage error:', result.error);
      return { ok: false, error: result.error };
    }

    return { ok: true, ts: result.ts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}
