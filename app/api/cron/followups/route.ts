// app/api/cron/followups/route.ts
// Finn — Check for supplier replies to emails we sent
// Runs twice daily (8:00 and 14:00 UTC) via Vercel Cron

import { NextRequest, NextResponse } from 'next/server';
import { processFollowUps } from '@/lib/handlers/followups';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  console.log('[finn-followups] Starting follow-up check');

  try {
    const result = await processFollowUps();

    console.log(`[finn-followups] Done in ${Date.now() - startTime}ms`);

    return NextResponse.json({
      ok: true,
      ...result,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[finn-followups] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
