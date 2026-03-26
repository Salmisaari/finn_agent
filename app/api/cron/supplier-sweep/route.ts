// app/api/cron/supplier-sweep/route.ts
// Finn — Scheduled supplier sweep: scan Pipeline 11 for stuck brands
// Runs twice daily (7:00 and 16:00 UTC) via Vercel Cron
// Phase 4: full signal detection. Current: pipeline stuck detection.

import { NextRequest, NextResponse } from 'next/server';
import { getAllPipeline11Deals, PIPELINE_11_STAGES } from '@/lib/handlers/pipedrive';
import { postToSlackChannel } from '@/lib/handlers/slack';

// Days threshold per stage — how long before we consider it "stuck"
const STAGE_THRESHOLDS: Record<string, number> = {
  'Discovery':       30,
  'NBM Gate':        14,
  'Onboarding':      21,
  'Masterdata':      21,
  'Pending Answer':   3,
  'Pending Meeting':  7,
  'Pending Action':   2,
  'Go-Live Gate':    14,
  'Content':         30,
  'MOV':             21,
  'Pricing':         21,
  'New Markets':     60,
  'Integrations':    60,
  'Logos':           30,
  'Paid Ads Gate':   14,
  'Growth Roadmap':  60,
  'Negotiate':       30,
};

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  console.log('[finn-sweep] Starting supplier sweep');

  try {
    const deals = await getAllPipeline11Deals();

    // Identify stuck deals
    const stuck = deals.filter((d) => {
      const threshold = STAGE_THRESHOLDS[d.stage_name] ?? 30;
      return d.days_in_stage > threshold;
    });

    if (stuck.length === 0) {
      console.log('[finn-sweep] No stuck brands found');
      return NextResponse.json({ ok: true, stuck: 0, total: deals.length, duration_ms: Date.now() - startTime });
    }

    // Group by stage for cleaner digest
    const byStage: Record<string, typeof stuck> = {};
    for (const deal of stuck) {
      if (!byStage[deal.stage_name]) byStage[deal.stage_name] = [];
      byStage[deal.stage_name].push(deal);
    }

    // Build digest
    const stageOrder = PIPELINE_11_STAGES.map((s) => s.name);
    const lines: string[] = [
      `Finn sweep — ${stuck.length} stuck brand${stuck.length !== 1 ? 's' : ''} in Pipeline 11`,
      '',
    ];

    for (const stageName of stageOrder) {
      const stageDeals = byStage[stageName];
      if (!stageDeals?.length) continue;
      lines.push(`${stageName} (threshold: ${STAGE_THRESHOLDS[stageName]}d):`);
      for (const deal of stageDeals) {
        lines.push(`  - ${deal.org_name} — ${deal.days_in_stage}d in stage`);
      }
    }

    lines.push('');
    lines.push(`@finn pipeline overview — which of these need action?`);

    const message = lines.join('\n');

    const finnChannel = process.env.FINN_SLACK_CHANNEL;
    if (finnChannel) {
      await postToSlackChannel(finnChannel, message, 'high');
    } else {
      console.warn('[finn-sweep] FINN_SLACK_CHANNEL not configured');
    }

    console.log(`[finn-sweep] Done in ${Date.now() - startTime}ms. Total: ${deals.length}, Stuck: ${stuck.length}`);

    return NextResponse.json({
      ok: true,
      total: deals.length,
      stuck: stuck.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[finn-sweep] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
