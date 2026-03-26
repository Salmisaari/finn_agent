// lib/tools/definitions.ts
// Finn's tool definitions — format matches Anthropic Tool schema
// but used via OpenRouter (converted to OpenAI format in generator.ts)

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const FINN_TOOL_DEFINITIONS: ToolDefinition[] = [
  // ========================================
  // CORE: SUPPLIER KNOWLEDGE GRAPH
  // ========================================

  {
    name: 'get_supplier',
    description:
      'Load the full supplier profile: commercial terms, pipeline stage, contact info, negotiation signals. ' +
      'ALWAYS call this first before any other action on a supplier. ' +
      'Tries name search if org_id is unknown. Returns profile + actionable signals.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Supplier or brand name (partial match ok)',
        },
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID if known',
        },
        prefix: {
          type: 'string',
          description: '3-letter SKU prefix (BLK, ARB, NMN...)',
        },
      },
    },
  },

  {
    name: 'get_negotiation_signals',
    description:
      'Run a full negotiation intelligence check for a supplier. ' +
      'Returns ranked opportunities: price list staleness, shipping fees, MOV, ROAS vs co-ad readiness, ' +
      'pipeline stage, days since contact. Use this when asked what to negotiate or prioritize.',
    input_schema: {
      type: 'object',
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        prefix: {
          type: 'string',
          description: '3-letter SKU prefix',
        },
        include_performance: {
          type: 'boolean',
          description: 'Whether to load performance data (GMV, ROAS) — slower but richer signals',
        },
      },
    },
  },

  {
    name: 'get_pipeline_overview',
    description:
      'Get a summary of Pipeline 11 (Brands funnel). ' +
      'Shows suppliers per stage, how long they have been there, and which are stuck. ' +
      'Optionally filter by stage name or owner.',
    input_schema: {
      type: 'object',
      properties: {
        stage_name: {
          type: 'string',
          description: 'Filter by stage name (e.g. "Pricing", "Onboarding")',
        },
        owner: {
          type: 'string',
          description: 'Filter by owner (Jo, Ja, etc.)',
        },
      },
    },
  },

  // ========================================
  // PERFORMANCE INTELLIGENCE
  // ========================================

  {
    name: 'get_supplier_performance',
    description:
      'Load brand performance data: GMV trend, margin per order, ROAS, ad spend. ' +
      'Use when asked about revenue, ads performance, or growth readiness.',
    input_schema: {
      type: 'object',
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        brand_name: {
          type: 'string',
          description: 'Brand name as it appears in the analytics sheet',
        },
        months: {
          type: 'number',
          description: 'How many months of data to load (default 3)',
        },
      },
    },
  },

  // ========================================
  // EMAIL
  // ========================================

  {
    name: 'search_supplier_emails',
    description:
      'Search Gmail for supplier email threads. Defaults to finn@droppe.com. ' +
      'Can also search orders@droppe.com (for order/shipping context) or oskar@droppe.fi.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query (e.g. "from:supplier@example.com" or "subject:price list")',
        },
        supplier_name: {
          type: 'string',
          description: 'Supplier name to append to query',
        },
        days_back: {
          type: 'number',
          description: 'Only show emails from the last N days',
        },
        mailbox: {
          type: 'string',
          enum: ['finn@droppe.com', 'orders@droppe.com', 'oskar@droppe.fi', 'jonas@droppe.fi', 'jonas.wagner@droppe-group.de'],
          description: 'Which mailbox to search (default: finn@droppe.com)',
        },
      },
    },
  },

  {
    name: 'read_supplier_email',
    description: 'Read the full content of an email thread from Gmail.',
    input_schema: {
      type: 'object',
      required: ['thread_id'],
      properties: {
        thread_id: {
          type: 'string',
          description: 'Gmail thread ID from search results',
        },
        mailbox: {
          type: 'string',
          enum: ['finn@droppe.com', 'orders@droppe.com', 'oskar@droppe.fi', 'jonas@droppe.fi', 'jonas.wagner@droppe-group.de'],
          description: 'Which mailbox this thread belongs to (default: finn@droppe.com)',
        },
      },
    },
  },

  {
    name: 'send_supplier_email',
    description:
      'Send an email via finn@droppe.com. ' +
      'STRICT RULE: NEVER call with human_verified=true unless the team member has explicitly confirmed the draft. ' +
      'Always draft first, show to team, wait for "send it" or "looks good", then call with human_verified=true.',
    input_schema: {
      type: 'object',
      required: ['to', 'body', 'human_verified'],
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address',
        },
        subject: {
          type: 'string',
          description: 'Email subject (omit for replies)',
        },
        body: {
          type: 'string',
          description: 'Email body text (plain text, no HTML)',
        },
        thread_id: {
          type: 'string',
          description: 'Gmail thread ID to reply in',
        },
        in_reply_to: {
          type: 'string',
          description: 'Message-ID header of the message being replied to',
        },
        human_verified: {
          type: 'boolean',
          description: 'Must be true — only set after explicit team confirmation',
        },
      },
    },
  },

  // ========================================
  // WRITE (require explicit instruction)
  // ========================================

  {
    name: 'update_supplier_field',
    description:
      'Write a field update to the Pipedrive org. Requires a reason. ' +
      'Creates an audit note. Only call when team explicitly asks to save/update something.',
    input_schema: {
      type: 'object',
      required: ['org_id', 'field_name', 'value', 'reason'],
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        field_name: {
          type: 'string',
          description:
            'Field to update. Valid: catalog_discount_pct, payment_terms, mov, shipping_fee, ' +
            'free_shipping_limit, small_order_fees, return_policy, order_email, order_email_cc, ' +
            'webstore, order_process, tracking_format, integration_capability, ' +
            'delivery_responsibility, catalog_updates, org_notes_marketing, description',
        },
        value: {
          description: 'New value for the field',
        },
        reason: {
          type: 'string',
          description: 'Why this update is being made (for audit trail)',
        },
      },
    },
  },

  {
    name: 'log_supplier_interaction',
    description:
      'Log an interaction (email, call, meeting, etc.) as a timestamped note on the Pipedrive org. ' +
      'Call after emails are sent or after calls/meetings.',
    input_schema: {
      type: 'object',
      required: ['org_id', 'interaction_type', 'summary'],
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        interaction_type: {
          type: 'string',
          description: 'Type: email_sent, email_received, call, meeting, terms_agreed, price_update, other',
        },
        summary: {
          type: 'string',
          description: 'What happened',
        },
        outcome: {
          type: 'string',
          description: 'Result or next step',
        },
      },
    },
  },

  {
    name: 'advance_pipeline_stage',
    description:
      'Move a supplier to the next stage in Pipeline 11 (Brands funnel). ' +
      'Only call when explicitly instructed by the team.',
    input_schema: {
      type: 'object',
      required: ['org_id', 'reason'],
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        reason: {
          type: 'string',
          description: 'Why this advancement is happening',
        },
      },
    },
  },

  {
    name: 'create_supplier_note',
    description: 'Add an internal note to the Pipedrive org. Optionally pin it.',
    input_schema: {
      type: 'object',
      required: ['org_id', 'note'],
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        note: {
          type: 'string',
          description: 'Note content',
        },
        pin: {
          type: 'boolean',
          description: 'Whether to pin the note',
        },
      },
    },
  },

  // ========================================
  // TEAM COMMUNICATION
  // ========================================

  {
    name: 'post_to_slack',
    description: 'Post a message to a Slack channel. Use for escalations and alerts.',
    input_schema: {
      type: 'object',
      required: ['channel', 'message'],
      properties: {
        channel: {
          type: 'string',
          description: 'Slack channel ID or name',
        },
        message: {
          type: 'string',
          description: 'Message text',
        },
        urgency: {
          type: 'string',
          enum: ['normal', 'high', 'critical'],
          description: 'Message urgency (affects color)',
        },
      },
    },
  },
];
