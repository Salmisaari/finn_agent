// lib/ace/executor.ts
// Tool executor for Finn — routes tool names to handler functions

import type { ToolCallResult, CallerContext } from './types';
import {
  getPipeline11Deal,
  getAllPipeline11Deals,
  advancePipelineDeal,
  createOrgNote,
  PIPELINE_11_STAGES,
} from '@/lib/handlers/pipedrive';
import {
  getSupplierProfile,
  getSupplierWithPerformance,
  updateSupplierField,
  logSupplierInteraction,
  bustSupplierCache,
} from '@/lib/handlers/knowledge';
import {
  gmail_searchThreads,
  gmail_getThread,
  gmail_sendMessage,
} from '@/lib/handlers/gmail';
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
        const thread = await gmail_getThread(input.thread_id as string);
        return { success: true, data: thread };
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
