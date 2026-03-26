// lib/ace/executor.ts
// Tool executor for Finn — routes tool names to handler functions

import type { ToolCallResult, CallerContext } from './types';
import {
  getPipeline11Deal,
  getAllPipeline11Deals,
  advancePipelineDeal,
  setDealStage,
  createOrgNote,
  PIPELINE_11_STAGES,
} from '@/lib/handlers/pipedrive';
import { createCalendarEvent } from '@/lib/handlers/calendar';
import {
  getSupplierProfile,
  getSupplierContext,
  getSupplierWithPerformance,
  updateSupplierField,
  logSupplierInteraction,
  bustSupplierCache,
} from '@/lib/handlers/knowledge';
import {
  gmail_searchThreads,
  gmail_getThread,
  gmail_sendMessage,
  gmail_fetchAttachments,
  gmail_downloadAttachment,
} from '@/lib/handlers/gmail';
import { updateTransitionField, updateMastertabField, scanSheet } from '@/lib/handlers/sheets';
import { postToSlackChannel } from '@/lib/handlers/slack';

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  _callerContext?: CallerContext
): Promise<ToolCallResult> {
  console.log(`[finn] executeTool: ${toolName}`, input);

  try {
    switch (toolName) {

      // ========================================
      // CORE: SUPPLIER KNOWLEDGE GRAPH
      // ========================================

      case 'get_supplier': {
        const result = await getSupplierProfile({
          name: input.name as string | undefined,
          org_id: input.org_id as number | undefined,
          prefix: input.prefix as string | undefined,
        });

        if (!result.found || !result.profile) {
          if (result.candidates?.length) {
            return {
              success: false,
              error: `Multiple matches found. Specify one: ${result.candidates.join(' | ')}`,
            };
          }
          return {
            success: false,
            error: `No supplier found for: ${JSON.stringify(input)}. Try a different name or check Pipedrive.`,
          };
        }

        return { success: true, data: result.profile };
      }

      case 'gather_supplier_context': {
        const ctxResult = await getSupplierContext({
          name: input.name as string | undefined,
          org_id: input.org_id as number | undefined,
          prefix: input.prefix as string | undefined,
          days_back: input.days_back as number | undefined,
        });

        if (!ctxResult.found || !ctxResult.context) {
          if (ctxResult.candidates?.length) {
            return {
              success: false,
              error: `Multiple matches found. Specify one: ${ctxResult.candidates.join(' | ')}`,
            };
          }
          return {
            success: false,
            error: `No supplier found for: ${JSON.stringify(input)}. Try a different name or check Pipedrive.`,
          };
        }

        const ctx = ctxResult.context;
        return {
          success: true,
          data: {
            profile: ctx.profile,
            email_summary: ctx.email_summary,
            recent_emails: ctx.recent_emails.map((r) => ({
              mailbox: r.mailbox,
              threads: r.threads.map((t) => ({
                thread_id: t.thread_id,
                subject: t.subject,
                from: t.from,
                date: t.date,
                snippet: t.snippet,
              })),
            })),
          },
        };
      }

      case 'get_negotiation_signals': {
        // Load profile (which already computes signals)
        const result = await getSupplierProfile({
          org_id: input.org_id as number | undefined,
          prefix: input.prefix as string | undefined,
        });

        if (!result.profile) {
          return { success: false, error: 'Supplier not found' };
        }

        const profile = result.profile;
        let enrichedProfile = profile;

        // Optionally load performance data for richer signals
        if (input.include_performance && profile.name) {
          const perf = await getSupplierWithPerformance(
            profile.pipedrive_org_id,
            profile.name,
            3
          );
          if (perf) {
            // Re-compute signals with performance data
            enrichedProfile = { ...profile, performance: perf };
          }
        }

        return {
          success: true,
          data: {
            supplier: enrichedProfile.name,
            prefix: enrichedProfile.prefix,
            pipeline_stage: enrichedProfile.pipeline_stage,
            negotiation: enrichedProfile.negotiation,
            key_terms: {
              discount: enrichedProfile.catalog_discount_pct,
              shipping_fee: enrichedProfile.shipping_fee,
              mov: enrichedProfile.mov,
              payment_terms: enrichedProfile.payment_terms,
            },
            performance: enrichedProfile.performance ? {
              roas: enrichedProfile.performance.roas,
              co_advertising_pct: enrichedProfile.performance.co_advertising_pct,
              gmv_last_3m: enrichedProfile.performance.gmv_last_3m,
            } : null,
          },
        };
      }

      case 'get_pipeline_overview': {
        const stageFilter = input.stage_name as string | undefined;
        const ownerFilter = input.owner as string | undefined;

        // Find stage ID if filtering by name
        let stageId: number | undefined;
        if (stageFilter) {
          const match = PIPELINE_11_STAGES.find(
            (s) => s.name.toLowerCase() === stageFilter.toLowerCase()
          );
          stageId = match?.id;
          if (!match) {
            return {
              success: false,
              error: `Unknown stage: ${stageFilter}. Valid stages: ${PIPELINE_11_STAGES.map((s) => s.name).join(', ')}`,
            };
          }
        }

        const deals = await getAllPipeline11Deals(stageId);

        // Filter by owner if requested
        const filtered = ownerFilter
          ? deals.filter((d) => d.org_name.toLowerCase().includes(ownerFilter.toLowerCase()))
          : deals;

        // Group by stage
        const byStage: Record<string, typeof deals> = {};
        for (const deal of filtered) {
          if (!byStage[deal.stage_name]) byStage[deal.stage_name] = [];
          byStage[deal.stage_name].push(deal);
        }

        // Build summary
        const summary = PIPELINE_11_STAGES
          .filter((s) => byStage[s.name]?.length)
          .map((s) => {
            const stageDeals = byStage[s.name];
            const stuck = stageDeals.filter((d) => {
              const thresholds: Record<string, number> = {
                Discovery: 30, 'NBM Gate': 14, Onboarding: 21, Masterdata: 21,
                'Go-Live Gate': 14, Content: 30, MOV: 21, Pricing: 21,
                'New Markets': 60, Integrations: 60, Logos: 30,
                'Paid Ads Gate': 14, 'Growth Roadmap': 60, Negotiate: 30,
              };
              return d.days_in_stage > (thresholds[d.stage_name] ?? 30);
            });
            return {
              stage: s.name,
              count: stageDeals.length,
              stuck: stuck.length,
              suppliers: stageDeals.map((d) => ({
                org_id: d.org_id,
                name: d.org_name,
                days_in_stage: d.days_in_stage,
                is_stuck: stuck.includes(d),
              })),
            };
          });

        return {
          success: true,
          data: {
            total_open: filtered.length,
            stages: summary,
          },
        };
      }

      // ========================================
      // PERFORMANCE INTELLIGENCE
      // ========================================

      case 'get_supplier_performance': {
        const orgId = input.org_id as number;
        const brandName = input.brand_name as string;
        const months = (input.months as number) || 3;

        if (!orgId && !brandName) {
          return { success: false, error: 'org_id or brand_name required' };
        }

        // If only brand name given, we still need org_id for cache key
        // Use a placeholder 0 if not given
        const perf = await getSupplierWithPerformance(orgId || 0, brandName, months);

        if (!perf) {
          return {
            success: false,
            error: `No performance data found for ${brandName || `org ${orgId}`}. Check if the brand name matches the analytics sheet.`,
          };
        }

        return { success: true, data: perf };
      }

      // ========================================
      // EMAIL (GMAIL)
      // ========================================

      case 'search_supplier_emails': {
        const threads = await gmail_searchThreads({
          query: input.query as string,
          supplier_name: input.supplier_name as string | undefined,
          days_back: input.days_back as number | undefined,
          mailbox: input.mailbox as string | undefined,
        });

        return {
          success: true,
          data: {
            threads,
            total: threads.length,
            message: threads.length === 0 ? 'No email threads found' : undefined,
          },
        };
      }

      case 'read_supplier_email': {
        const thread = await gmail_getThread(input.thread_id as string, input.mailbox as string | undefined);
        return { success: true, data: thread };
      }

      case 'get_email_attachments': {
        const { attachments, error } = await gmail_fetchAttachments(
          input.thread_id as string,
          input.mailbox as string | undefined,
          input.filename_filter as string | undefined
        );

        if (error) return { success: false, error };
        if (attachments.length === 0) {
          return {
            success: true,
            data: { attachments: [], message: 'No attachments found in this thread' },
          };
        }

        // If share_to_slack requested, download and upload the first matching file
        if (input.share_to_slack && input.filename_filter && _callerContext?.slackChannel) {
          const downloaded = await gmail_downloadAttachment(
            input.thread_id as string,
            input.filename_filter as string,
            input.mailbox as string | undefined
          );

          if (downloaded) {
            try {
              const botToken = process.env.SLACK_BOT_TOKEN;
              if (botToken) {
                // Step 1: Get upload URL
                const getUrlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${botToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: `filename=${encodeURIComponent(downloaded.filename)}&length=${downloaded.buffer.length}`,
                });
                const urlData = await getUrlRes.json();

                if (urlData.ok) {
                  // Step 2: Upload file (convert Buffer to Uint8Array for fetch)
                  await fetch(urlData.upload_url, {
                    method: 'POST',
                    headers: { 'Content-Type': downloaded.mimeType },
                    body: new Uint8Array(downloaded.buffer),
                  });

                  // Step 3: Complete upload
                  await fetch('https://slack.com/api/files.completeUploadExternal', {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${botToken}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      files: [{ id: urlData.file_id, title: downloaded.filename }],
                      channel_id: _callerContext.slackChannel,
                      thread_ts: _callerContext.slackThreadTs,
                    }),
                  });
                }
              }
            } catch (uploadErr) {
              console.error('[finn] Slack file upload error:', uploadErr);
            }
          }
        }

        return {
          success: true,
          data: {
            attachments,
            total: attachments.length,
            total_size_kb: Math.round(attachments.reduce((s, a) => s + a.size, 0) / 1024),
          },
        };
      }

      case 'send_supplier_email': {
        // Human gate: must be explicitly verified by team member
        if (!input.human_verified) {
          return {
            success: false,
            error:
              'Email not sent. Show the draft to the team member and only call this with human_verified=true after explicit confirmation.',
          };
        }

        const result = await gmail_sendMessage({
          to: input.to as string,
          subject: input.subject as string | undefined,
          body: input.body as string,
          cc: input.cc as string[] | undefined,
          thread_id: input.thread_id as string | undefined,
          in_reply_to: input.in_reply_to as string | undefined,
        });

        return result.success
          ? { success: true, data: { message_id: result.message_id, sent: true } }
          : { success: false, error: result.error };
      }

      // ========================================
      // WRITE OPERATIONS
      // ========================================

      case 'update_supplier_field': {
        const orgId = input.org_id as number;
        const fieldName = input.field_name as string;
        const value = input.value;
        const reason = input.reason as string;

        if (!orgId || !fieldName || value === undefined || !reason) {
          return { success: false, error: 'org_id, field_name, value, and reason are all required' };
        }

        const result = await updateSupplierField(orgId, fieldName, value, reason);
        return result;
      }

      case 'log_supplier_interaction': {
        const result = await logSupplierInteraction(
          input.org_id as number,
          input.interaction_type as string,
          input.summary as string,
          input.outcome as string | undefined
        );
        return result;
      }

      case 'advance_pipeline_stage': {
        const orgId = input.org_id as number;
        const reason = input.reason as string;

        // Find the current Pipeline 11 deal for this org
        const deal = await getPipeline11Deal(orgId);
        if (!deal) {
          return { success: false, error: 'No open Pipeline 11 deal found for this org' };
        }

        const result = await advancePipelineDeal(deal.id);

        if (result.success) {
          // Log the advancement
          await logSupplierInteraction(
            orgId,
            'pipeline_advancement',
            `Advanced from ${deal.stage_name} to ${result.new_stage_name}. Reason: ${reason}`,
          ).catch(() => {}); // non-critical
          await bustSupplierCache(orgId);
        }

        return result.success
          ? { success: true, data: { from_stage: deal.stage_name, to_stage: result.new_stage_name } }
          : { success: false, error: result.error };
      }

      case 'create_supplier_note': {
        const { note_id } = await createOrgNote(
          input.org_id as number,
          input.note as string,
          (input.pin as boolean) || false
        );
        return { success: true, data: { note_id } };
      }

      case 'move_to_stage': {
        const orgId = input.org_id as number;
        const stageName = input.stage_name as string;
        const reason = input.reason as string;

        // Find stage ID by name
        const targetStage = PIPELINE_11_STAGES.find(
          (s) => s.name.toLowerCase() === stageName.toLowerCase()
        );
        if (!targetStage) {
          return {
            success: false,
            error: `Unknown stage: "${stageName}". Valid: ${PIPELINE_11_STAGES.map((s) => s.name).join(', ')}`,
          };
        }

        // Find the deal for this org
        const deal = await getPipeline11Deal(orgId);
        if (!deal) {
          return { success: false, error: 'No open Pipeline 11 deal found for this org' };
        }

        await setDealStage(deal.id, targetStage.id);

        // Log the move
        await logSupplierInteraction(
          orgId,
          'pipeline_move',
          `Moved from ${deal.stage_name} to ${targetStage.name}. Reason: ${reason}`,
        ).catch(() => {});
        await bustSupplierCache(orgId);

        return {
          success: true,
          data: { from_stage: deal.stage_name, to_stage: targetStage.name },
        };
      }

      case 'create_calendar_event': {
        const result = await createCalendarEvent({
          summary: input.summary as string,
          description: input.description as string | undefined,
          start_time: input.start_time as string,
          duration_minutes: (input.duration_minutes as number) || 30,
          attendees: input.attendees as string[] | undefined,
          location: input.location as string | undefined,
        });

        return result.success
          ? { success: true, data: result }
          : { success: false, error: result.error };
      }

      // ========================================
      case 'scan_sheet': {
        try {
          const result = await scanSheet(
            input.sheet as 'transition' | 'mastertab' | 'okr' | 'analytics',
            input.filter_column as string | undefined,
            input.filter_value as string | undefined
          );

          // Truncate if too many rows to fit in context
          const maxRows = 50;
          const truncated = result.rows.length > maxRows;
          const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;

          return {
            success: true,
            data: {
              total: result.total,
              showing: rows.length,
              truncated,
              headers: result.headers,
              rows,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
      }

      case 'update_sheet': {
        const prefix = input.prefix as string;
        const tab = input.tab as string;
        const field = input.field as string;
        const value = input.value as string;
        const supplierName = input.supplier_name as string | undefined;

        let result;
        if (tab === 'transition') {
          result = await updateTransitionField(prefix, field, value, supplierName);
        } else if (tab === 'mastertab') {
          result = await updateMastertabField(prefix, field, value);
        } else {
          return { success: false, error: `Unknown tab: ${tab}. Use "transition" or "mastertab".` };
        }

        return result.success
          ? { success: true, data: { updated: result.cell, tab, field, value } }
          : { success: false, error: result.error };
      }

      // ========================================
      // TEAM COMMUNICATION
      // ========================================

      case 'post_to_slack': {
        const result = await postToSlackChannel(
          input.channel as string,
          input.message as string,
          (input.urgency as 'normal' | 'high' | 'critical') || 'normal'
        );

        return result.ok
          ? { success: true, data: { ts: result.ts } }
          : { success: false, error: result.error };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[finn] Tool ${toolName} failed:`, message);
    return { success: false, error: message };
  }
}
