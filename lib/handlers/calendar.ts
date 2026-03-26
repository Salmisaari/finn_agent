// lib/handlers/calendar.ts
// Finn — Google Calendar integration for meeting scheduling
// Uses service account with domain-wide delegation to manage Johannes's calendar

import { google } from 'googleapis';

const JOHANNES_EMAIL = 'johannes@droppe.fi';

function getCalendarClient() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  }

  const key = JSON.parse(serviceAccountKey);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: JOHANNES_EMAIL,
  });

  return google.calendar({ version: 'v3', auth });
}

export interface CreateEventResult {
  success: boolean;
  event_id?: string;
  html_link?: string;
  start?: string;
  end?: string;
  error?: string;
}

export async function createCalendarEvent(opts: {
  summary: string;
  description?: string;
  start_time: string;
  duration_minutes: number;
  attendees?: string[];
  location?: string;
}): Promise<CreateEventResult> {
  try {
    const calendar = getCalendarClient();

    const startDate = new Date(opts.start_time);
    const endDate = new Date(startDate.getTime() + opts.duration_minutes * 60 * 1000);

    const event: {
      summary: string;
      description?: string;
      location?: string;
      start: { dateTime: string };
      end: { dateTime: string };
      attendees?: { email: string }[];
      reminders: { useDefault: boolean };
    } = {
      summary: opts.summary,
      description: opts.description,
      location: opts.location,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: endDate.toISOString() },
      reminders: { useDefault: true },
    };

    if (opts.attendees?.length) {
      event.attendees = opts.attendees.map((email) => ({ email }));
    }

    const res = await calendar.events.insert({
      calendarId: JOHANNES_EMAIL,
      requestBody: event,
      sendUpdates: opts.attendees?.length ? 'all' : 'none',
    });

    return {
      success: true,
      event_id: res.data.id || undefined,
      html_link: res.data.htmlLink || undefined,
      start: res.data.start?.dateTime || undefined,
      end: res.data.end?.dateTime || undefined,
    };
  } catch (err) {
    console.error('[calendar] Create event error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
