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

// All mailboxes to search for supplier context
export const ALL_SEARCH_MAILBOXES = [
  'finn@droppe.com',
  'oskar@droppe.fi',
  'jonas@droppe.fi',
  'orders@droppe.com',
] as const;

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

// CC validation: only internal Droppe addresses allowed
function validateCC(recipients: string[]): { valid: boolean; invalid: string[] } {
  const invalid = recipients.filter(
    (r) => !r.endsWith('@droppe.fi') && !r.endsWith('@droppe.com') && !r.endsWith('@droppe-group.de')
  );
  return { valid: invalid.length === 0, invalid };
}

export async function gmail_sendMessage(opts: {
  to: string;
  subject?: string;
  body: string;
  cc?: string[];
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
}): Promise<SendEmailResult> {
  // Finn always sends as finn@droppe.com — no other mailbox allowed for sending
  const gmail = getGmailClient(FINN_MAILBOX);
  const from = FINN_MAILBOX;

  // Validate CC recipients
  const cc = opts.cc || [];
  if (cc.length > 0) {
    const ccCheck = validateCC(cc);
    if (!ccCheck.valid) {
      return {
        success: false,
        error: `CC recipients must be @droppe.fi, @droppe.com, or @droppe-group.de. Invalid: ${ccCheck.invalid.join(', ')}`,
      };
    }
  }

  // Build MIME email with UTF-8 subject encoding
  const subject = opts.subject || '(no subject)';
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const headerLines = [
    `From: ${from}`,
    `To: ${opts.to}`,
  ];

  if (cc.length > 0) headerLines.push(`Cc: ${cc.join(', ')}`);

  headerLines.push(
    `Subject: ${utf8Subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  );

  if (opts.in_reply_to) headerLines.push(`In-Reply-To: ${opts.in_reply_to}`);
  if (opts.references) headerLines.push(`References: ${opts.references}`);

  const raw = Buffer.from(
    `${headerLines.join('\r\n')}\r\n\r\n${opts.body}`
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

// ========================================
// FETCH ATTACHMENTS
// ========================================

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  messageSubject: string;
  messageDate: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectParts(payload: any): any[] {
  if (!payload) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = [];
  if (payload.filename && payload.body?.attachmentId) {
    result.push(payload);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      result.push(...collectParts(part));
    }
  }
  return result;
}

export async function gmail_fetchAttachments(
  threadId: string,
  mailbox?: string,
  filenameFilter?: string
): Promise<{ attachments: AttachmentInfo[]; error?: string }> {
  try {
    const gmail = getGmailClient(mailbox || FINN_MAILBOX);

    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
    });

    const messages = threadRes.data.messages || [];
    if (messages.length === 0) {
      return { attachments: [], error: 'Thread not found or empty' };
    }

    const attachments: AttachmentInfo[] = [];

    for (const message of messages) {
      const headers = message.payload?.headers || [];
      const subjectHeader = headers.find((h) => h.name?.toLowerCase() === 'subject');
      const dateHeader = headers.find((h) => h.name?.toLowerCase() === 'date');
      const messageSubject = subjectHeader?.value || '(no subject)';
      const messageDate = dateHeader?.value
        ? new Date(dateHeader.value).toISOString()
        : '';

      const parts = collectParts(message.payload);
      for (const part of parts) {
        const filename = part.filename || '';
        const attachmentId = part.body?.attachmentId;
        if (!filename || !attachmentId) continue;

        // Apply filename filter if provided
        if (filenameFilter) {
          if (!filename.toLowerCase().includes(filenameFilter.toLowerCase())) continue;
        }

        try {
          const attRes = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: message.id!,
            id: attachmentId,
          });

          if (attRes.data.data) {
            const buffer = Buffer.from(attRes.data.data, 'base64url');
            attachments.push({
              filename,
              mimeType: part.mimeType || 'application/octet-stream',
              size: buffer.length,
              messageSubject,
              messageDate,
            });
          }
        } catch (e) {
          console.warn(`[gmail] Failed to fetch attachment ${filename}:`, e);
        }
      }
    }

    return { attachments };
  } catch (err) {
    return {
      attachments: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ========================================
// CHECK FOR REPLIES (used by follow-up automation)
// ========================================

// ========================================
// MULTI-MAILBOX SEARCH (consolidated context)
// ========================================

export interface MultiMailboxResult {
  mailbox: string;
  threads: EmailThreadSummary[];
  error?: string;
}

export async function gmail_searchAllMailboxes(opts: {
  query: string;
  supplier_name?: string;
  days_back?: number;
}): Promise<MultiMailboxResult[]> {
  const results = await Promise.all(
    ALL_SEARCH_MAILBOXES.map(async (mailbox) => {
      try {
        const threads = await gmail_searchThreads({
          ...opts,
          mailbox,
        });
        return { mailbox, threads };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[gmail] Search FAILED for ${mailbox}:`, errorMsg);
        return { mailbox, threads: [], error: `Failed to search ${mailbox}: ${errorMsg}` };
      }
    })
  );

  // Return ALL results including failures — so the model knows what it couldn't access
  return results;
}

// ========================================
// DOWNLOAD ATTACHMENT (returns Buffer for forwarding)
// ========================================

export async function gmail_downloadAttachment(
  threadId: string,
  filename: string,
  mailbox?: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  try {
    const gmail = getGmailClient(mailbox || FINN_MAILBOX);

    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
    });

    const messages = threadRes.data.messages || [];

    for (const message of messages) {
      const parts = collectParts(message.payload);
      for (const part of parts) {
        const partFilename = part.filename || '';
        if (!partFilename.toLowerCase().includes(filename.toLowerCase())) continue;

        const attachmentId = part.body?.attachmentId;
        if (!attachmentId) continue;

        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: message.id!,
          id: attachmentId,
        });

        if (attRes.data.data) {
          return {
            buffer: Buffer.from(attRes.data.data, 'base64url'),
            mimeType: part.mimeType || 'application/octet-stream',
            filename: partFilename,
          };
        }
      }
    }

    return null;
  } catch (err) {
    console.error('[gmail] Download attachment error:', err);
    return null;
  }
}

// ========================================
// CHECK FOR REPLIES (used by follow-up automation)
// ========================================

export async function gmail_hasReply(
  supplierEmail: string,
  afterDate: Date,
  mailbox?: string
): Promise<{ hasReply: boolean; snippet?: string; threadId?: string }> {
  try {
    const afterEpoch = Math.floor(afterDate.getTime() / 1000);
    const threads = await gmail_searchThreads({
      query: `from:${supplierEmail} after:${afterEpoch}`,
      mailbox: mailbox || FINN_MAILBOX,
    });

    if (threads.length > 0) {
      return { hasReply: true, snippet: threads[0].snippet, threadId: threads[0].thread_id };
    }
    return { hasReply: false };
  } catch {
    return { hasReply: false };
  }
}
