// lib/handlers/gmail.ts
// Finn — Gmail integration for supplier email inbox
// Uses OAuth2 with a stored refresh token (single mailbox)

import { google } from 'googleapis';

// ========================================
// AUTH — Service account with domain-wide delegation
// ========================================

// Hard-coded allowlist: Finn can ONLY access these mailboxes.
// Add/remove here to change access. This is the security boundary.
const ALLOWED_MAILBOXES = [
  'finn@droppe.com',
  'orders@droppe.com',
  'oskar@droppe.fi',
  'jonas@droppe.fi',
  'jonas.wagner@droppe-group.de',
] as const;

type AllowedMailbox = typeof ALLOWED_MAILBOXES[number];

const FINN_MAILBOX = 'finn@droppe.com';

function assertAllowedMailbox(email: string): asserts email is AllowedMailbox {
  if (!ALLOWED_MAILBOXES.includes(email as AllowedMailbox)) {
    throw new Error(
      `Access denied: "${email}" is not in Finn's allowed mailbox list. ` +
      `Allowed: ${ALLOWED_MAILBOXES.join(', ')}`
    );
  }
}

function getGmailClient(impersonateUser: string = FINN_MAILBOX) {
  assertAllowedMailbox(impersonateUser);

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    // Service account with domain-wide delegation (production)
    const key = JSON.parse(serviceAccountKey);
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
      ],
      subject: impersonateUser,
    });
    return google.gmail({ version: 'v1', auth });
  }

  // Fallback: OAuth2 refresh token (dev / single-mailbox)
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY (production) ' +
      'or GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN (dev).'
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

function decodeBase64(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

// ========================================
// SEARCH THREADS
// ========================================

export interface EmailThreadSummary {
  thread_id: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  message_count: number;
}

export async function gmail_searchThreads(opts: {
  query: string;
  supplier_name?: string;
  days_back?: number;
  mailbox?: string;
}): Promise<EmailThreadSummary[]> {
  const gmail = getGmailClient(opts.mailbox || FINN_MAILBOX);

  let q = opts.query;
  if (opts.supplier_name) {
    q = `${q} ${opts.supplier_name}`;
  }
  if (opts.days_back) {
    const after = Math.floor((Date.now() - opts.days_back * 24 * 60 * 60 * 1000) / 1000);
    q = `${q} after:${after}`;
  }

  const threadsRes = await gmail.users.threads.list({
    userId: 'me',
    q,
    maxResults: 15,
  });

  const threads = threadsRes.data.threads || [];
  if (!threads.length) return [];

  // Fetch summaries in parallel
  const summaries = await Promise.all(
    threads.map(async (t) => {
      try {
        const threadRes = await gmail.users.threads.get({
          userId: 'me',
          id: t.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const messages = threadRes.data.messages || [];
        const firstMsg = messages[0];
        const headers = firstMsg?.payload?.headers || [];

        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        return {
          thread_id: t.id!,
          subject: getHeader('Subject') || '(no subject)',
          snippet: threadRes.data.snippet || '',
          from: getHeader('From'),
          date: getHeader('Date'),
          message_count: messages.length,
        };
      } catch {
        return null;
      }
    })
  );

  return summaries.filter(Boolean) as EmailThreadSummary[];
}

// ========================================
// READ THREAD
// ========================================

export interface EmailMessage {
  message_id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  body: string;
}

export interface EmailThread {
  thread_id: string;
  messages: EmailMessage[];
}

export async function gmail_getThread(threadId: string, mailbox?: string): Promise<EmailThread> {
  const gmail = getGmailClient(mailbox || FINN_MAILBOX);

  const threadRes = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = threadRes.data.messages || [];

  const parsed: EmailMessage[] = messages.map((msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    // Extract plain text body
    let body = '';
    const parts = msg.payload?.parts || [];

    if (parts.length > 0) {
      // Multipart: find text/plain
      const textPart = parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = decodeBase64(textPart.body.data);
      }
    } else if (msg.payload?.body?.data) {
      // Single part
      body = decodeBase64(msg.payload.body.data);
    }

    // Truncate very long bodies
    if (body.length > 3000) {
      body = body.slice(0, 3000) + '\n[truncated]';
    }

    return {
      message_id: msg.id!,
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      subject: getHeader('Subject'),
      body: body.trim(),
    };
  });

  return { thread_id: threadId, messages: parsed };
}

// ========================================
// SEND / REPLY
// ========================================

export interface SendEmailResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

export async function gmail_sendMessage(opts: {
  to: string;
  subject?: string;
  body: string;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
}): Promise<SendEmailResult> {
  // Finn always sends as finn@droppe.com — no other mailbox allowed for sending
  const gmail = getGmailClient(FINN_MAILBOX);
  const from = FINN_MAILBOX;

  // Build MIME email
  const subject = opts.subject || '(no subject)';
  const headers = [
    `From: ${from}`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];

  if (opts.in_reply_to) headers.push(`In-Reply-To: ${opts.in_reply_to}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  const raw = Buffer.from(
    `${headers.join('\r\n')}\r\n\r\n${opts.body}`
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody: { raw: string; threadId?: string } = { raw };
  if (opts.thread_id) {
    requestBody.threadId = opts.thread_id;
  }

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody,
    });
    return { success: true, message_id: res.data.id || undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
