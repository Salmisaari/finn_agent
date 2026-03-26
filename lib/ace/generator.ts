// lib/ace/generator.ts
// Finn — OpenRouter tool-use loop for supplier intelligence

import type { GeneratorInput, GeneratorOutput, ToolCall } from './types';
import { FINN_TOOL_DEFINITIONS } from '@/lib/tools/definitions';
import { executeTool } from './executor';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_LOOPS = 10;

// ========================================
// OPENROUTER TYPES
// ========================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ========================================
// CONVERT TOOL DEFINITIONS (Anthropic → OpenAI format)
// ========================================

function getOpenRouterTools(): OpenRouterTool[] {
  return FINN_TOOL_DEFINITIONS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }));
}

// ========================================
// SYSTEM PROMPT
// ========================================

const DROPPE_POSITIONING = `## Droppe's positioning

We are not a webshop. We are a distribution operations layer.
Brands plug in their catalog; Droppe handles content, ads, ops, returns, support across 7 European markets.

Core pitch: "Traffic × Conversion × Price × Availability — we optimize all four."

Brand tiers:
- LAUNCH: New to online or entering a market. Droppe builds pages, first customers within days.
- GROW: Online but underleveraged. Expand markets, optimize conversion, build recurring buyers.
- SCALE: Proven online sellers. Maximize ROAS, full automation, co-invested ad budgets.

Co-advertising model:
- Droppe co-invests 12% of generated revenue back into ad budget.
- Higher ROAS = lower effective cost for the brand.
- Example: ROAS 4.5x on €10k spend → Droppe covers €5,400; brand pays €4,600.

Six failure modes we diagnose per supplier:
1. Pricing not competitive (wholesale pricing, MOV, above market)
2. B2B logistics in a D2C world (€20 B2B shipping vs €6 e-commerce benchmark)
3. Weak product content (1 image, no sizing charts)
4. Slow delivery times (5+ days vs next-day expectation)
5. Missing integrations (manual order processing = humans in the middle)
6. No demand generation (no ads, no traffic)

Six integration requirements for a fully live supplier:
- Warehouse integration (real-time stock)
- Stock integration (live inventory across channels)
- Tracking code integration (automated shipment tracking)
- Order handling integration (seamless order processing)
- Invoice integration (automated billing)
- Real-time pricing (granular, item-level)`;

const TOOL_INDEX = `## Tools (use in order of need)

START: get_supplier — load full profile before any action
INTEL: get_negotiation_signals — what to negotiate next
FUNNEL: get_pipeline_overview — full Pipeline 11 view
PERF: get_supplier_performance — GMV, ROAS, margin trends
EMAIL: search_supplier_emails → read_supplier_email → (after team confirmation) send_supplier_email
WRITE: update_supplier_field, log_supplier_interaction, advance_pipeline_stage, create_supplier_note
COMMS: post_to_slack

Key rules:
- When asked about "recent", "latest", "news", "updates", or "posted" — ALWAYS search emails across relevant mailboxes (finn@, orders@, jonas@, oskar@). Pipedrive notes alone are not enough.
- Search multiple mailboxes if needed — supplier emails may be in jonas@droppe.fi or orders@droppe.com, not just finn@droppe.com.
- send_supplier_email: draft first, show to team, wait for "send it" / "looks good", THEN call with human_verified=true
- update_supplier_field / advance_pipeline_stage: only when team explicitly says to do it
- If supplier not found: say so, suggest spelling or Pipedrive ID`;

function buildSystemPrompt(requestingUser: string, supplierNames?: string[]): string {
  const supplierHint = supplierNames?.length
    ? `\nSuppliers mentioned in query: ${supplierNames.join(', ')}`
    : '';

  return `You are Finn, Droppe's internal supplier intelligence AI.
You maintain the knowledge graph of every brand/supplier and help the team manage commercial relationships.${supplierHint}

*What Finn does*:
1. Know the full history of each supplier: terms, performance, contacts, open topics
2. Surface what is actionable: price list stale, shipping fee too high, ROAS ready for co-ad
3. Progress suppliers through the Brands pipeline (Pipeline 11)
4. Draft supplier communications informed by relationship history
5. Monitor for signals across Pipedrive, Sheets, email, and performance data

*Personality*: Direct, factual, proactive. Lead with the answer.
No emojis. No markdown headers/bold/italic. Plain text only.

*Formatting for Slack*:
- Plain text. Dashes (-) for bullets. No ** or ## markup.
- Start with the core fact. Context on lines 2-3.
- Simple lookups: 2-4 lines. Complex queries: max 10 lines.
- For negotiations/signals: list each item on its own line with a dash.
- Raw URLs only, no link markup.

*Email tone (when drafting)*:
- Warm, partnership-oriented. "Grow together", not transactional.
- Push for no MOV — customers need to test before committing.
- Flag shipping costs if above €15 (benchmark: €7 GLS Italy).
- Frame integrations positively: "we're ready to push when it suits your team."
- For meetings: always accept, offer booking link https://calendar.app.google/... (use real link from context).
- Match the language of the thread (Finnish if they write Finnish, etc.).

*Retrieval-led reasoning*: Tool responses are authoritative. Pre-training is fallback only.

${DROPPE_POSITIONING}

${TOOL_INDEX}

Requesting team member: ${requestingUser}`;
}

// ========================================
// OPENROUTER API CALL
// ========================================

async function callOpenRouter(
  messages: ChatMessage[],
  tools: OpenRouterTool[],
  model: string
): Promise<{
  content: string | null;
  tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
  };

  // Only include tools if we have them
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://finn-agent-blue.vercel.app',
      'X-Title': 'Finn Agent',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errorText.slice(0, 500)}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];

  if (!choice) {
    throw new Error('OpenRouter returned no choices');
  }

  return {
    content: choice.message?.content || null,
    tool_calls: choice.message?.tool_calls || [],
  };
}

// ========================================
// GENERATOR LOOP
// ========================================

export async function runGenerator(input: GeneratorInput): Promise<GeneratorOutput> {
  const startTime = Date.now();
  const toolCalls: ToolCall[] = [];
  const model = process.env.FINN_MODEL || 'xiaomi/mimo-v2-pro';

  try {
    const systemPrompt = buildSystemPrompt(input.requestingUser, input.supplierNames);
    const tools = getOpenRouterTools();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.slackMessage },
    ];

    let finalResponse = '';
    let continueLoop = true;
    let loopCount = 0;

    while (continueLoop && loopCount < MAX_LOOPS) {
      loopCount++;

      const response = await callOpenRouter(messages, tools, model);

      // No tool calls → final text response
      if (!response.tool_calls || response.tool_calls.length === 0) {
        finalResponse = response.content || '';
        continueLoop = false;
        break;
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call and add results
      for (const tc of response.tool_calls) {
        const toolName = tc.function.name;
        let toolInput: Record<string, unknown> = {};

        try {
          toolInput = JSON.parse(tc.function.arguments);
        } catch {
          console.error(`[finn] Failed to parse tool args for ${toolName}:`, tc.function.arguments);
        }

        console.log(`[finn] Tool call: ${toolName}`, toolInput);

        const result = await executeTool(toolName, toolInput, input.callerContext);

        toolCalls.push({
          toolName,
          input: toolInput,
          output: result.data,
          success: result.success,
          error: result.error,
          timestamp: new Date(),
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result, null, 2),
        });
      }
    }

    console.log(
      `[finn] Generator done in ${Date.now() - startTime}ms, ${loopCount} loops, ${toolCalls.length} tool calls`
    );

    return {
      response: finalResponse,
      toolCalls,
      success: true,
      loopCount,
    };
  } catch (error) {
    console.error('[finn] Generator error:', error);
    return {
      response: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      toolCalls,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
