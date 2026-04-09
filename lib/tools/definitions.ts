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
    name: 'gather_supplier_context',
    description:
      'THE PRIMARY TOOL for answering questions about suppliers. Loads EVERYTHING in one call: ' +
      'full Pipedrive profile + recent emails from ALL mailboxes (finn@, oskar@, jonas@, orders@) + negotiation signals. ' +
      'ALWAYS use this instead of get_supplier when the question is about recent activity, latest news, updates, or general "what do we know". ' +
      'Use get_supplier only for quick field lookups where email context is unnecessary.',
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
        days_back: {
          type: 'number',
          description: 'How many days of email history to search (default 30)',
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
    name: 'get_email_attachments',
    description:
      'List attachments in an email thread AND optionally share one to the current Slack thread. ' +
      'Returns filename, type, size, and which message they came from. ' +
      'Set share_to_slack=true and specify a filename to upload the file to the Slack conversation.',
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
          description: 'Which mailbox (default: finn@droppe.com)',
        },
        filename_filter: {
          type: 'string',
          description: 'Only return attachments whose filename contains this string (case-insensitive)',
        },
        share_to_slack: {
          type: 'boolean',
          description: 'If true, download the matching attachment and upload it to the current Slack thread',
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
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'CC recipients (must be @droppe.fi, @droppe.com, or @droppe-group.de)',
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
    name: 'move_to_stage',
    description:
      'Move a supplier deal to a specific stage in Pipeline 11. ' +
      'Use "Pending Answer" after sending a supplier email and waiting for reply. ' +
      'Use "Pending Meeting" after scheduling/proposing a meeting. ' +
      'Use "Pending Action" when the supplier replied and the team needs to act. ' +
      'For other stages, use advance_pipeline_stage instead.',
    input_schema: {
      type: 'object',
      required: ['org_id', 'stage_name', 'reason'],
      properties: {
        org_id: {
          type: 'number',
          description: 'Pipedrive org ID',
        },
        stage_name: {
          type: 'string',
          enum: [
            'Discovery', 'NBM Gate', 'Onboarding', 'Masterdata',
            'Pending Answer', 'Pending Meeting', 'Pending Action',
            'Go-Live Gate', 'Content', 'MOV', 'Pricing',
            'New Markets', 'Integrations', 'Logos',
            'Paid Ads Gate', 'Growth Roadmap', 'Negotiate',
          ],
          description: 'Target stage name',
        },
        reason: {
          type: 'string',
          description: 'Why this move is happening',
        },
      },
    },
  },

  {
    name: 'create_calendar_event',
    description:
      'Create a meeting on Johannes\'s Google Calendar. Use when scheduling supplier meetings. ' +
      'Also include the booking link in emails: https://calendar.google.com/calendar/u/0/appointments/AcZssZ3MWCBceBbM9EtKNFjHGusXmNCLqy37W_10UeY=',
    input_schema: {
      type: 'object',
      required: ['summary', 'start_time', 'duration_minutes'],
      properties: {
        summary: {
          type: 'string',
          description: 'Meeting title (e.g. "Droppe x Blaklader — Q2 planning")',
        },
        description: {
          type: 'string',
          description: 'Meeting description / agenda',
        },
        start_time: {
          type: 'string',
          description: 'ISO 8601 datetime (e.g. "2026-04-02T14:00:00+03:00")',
        },
        duration_minutes: {
          type: 'number',
          description: 'Meeting duration in minutes (default 30)',
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Email addresses of attendees',
        },
        location: {
          type: 'string',
          description: 'Meeting location or video call link',
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
  // QUOTES
  // ========================================

  {
    name: 'generate_quote',
    description:
      'Generate a structured customer quote email. Builds a professional quote from deal parameters. ' +
      'Language is auto-detected from customer_country (FI→Finnish, DE→German, SE→Swedish, else English). ' +
      'You can override with language param. Always look up the customer in Pipedrive first to get their country. ' +
      'After generating, post the full draft to Slack. Team can either: ' +
      '(a) approve for Finn to send via send_supplier_email, or ' +
      '(b) copy-paste the draft to send from their own email. ' +
      'Both workflows are valid — ask which they prefer.',
    input_schema: {
      type: 'object',
      required: ['customer_name', 'line_items', 'payment', 'delivery'],
      properties: {
        customer_name: {
          type: 'string',
          description: 'Customer/organization name',
        },
        contact_name: {
          type: 'string',
          description: 'Contact person name (for greeting)',
        },
        contact_email: {
          type: 'string',
          description: 'Contact email (for sending after approval)',
        },
        customer_country: {
          type: 'string',
          description: 'Customer country (ISO code or name, e.g. "FI", "DE", "SE", "Finland"). Auto-detects quote language. Always look this up from Pipedrive org data.',
        },
        customer_context: {
          type: 'string',
          description: 'What the customer needs this for (e.g. "reserve stock for healthcare contracts"). Used in opening paragraph.',
        },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['product', 'quantity', 'unit_price', 'currency', 'unit'],
            properties: {
              product: {
                type: 'string',
                description: 'Product description (e.g. "Blue nitrile examination gloves, 4g")',
              },
              specs: {
                type: 'string',
                description: 'Certifications/specs (e.g. "EN 455, 37% formaldehyde tested")',
              },
              brand: {
                type: 'string',
                description: 'Brand/manufacturer (e.g. "Intco Medical (OEM)")',
              },
              quantity: {
                type: 'string',
                description: 'Order quantity (e.g. "10000 boxes")',
              },
              unit_price: {
                type: 'string',
                description: 'Price per unit (e.g. "3.60")',
              },
              currency: {
                type: 'string',
                description: 'Currency: EUR, USD, SEK, GBP',
              },
              unit: {
                type: 'string',
                description: 'Unit of measure (e.g. "box (100 pcs)", "pair", "carton")',
              },
              moq: {
                type: 'string',
                description: 'Minimum order quantity if applicable',
              },
            },
          },
          description: 'Products being quoted',
        },
        payment: {
          type: 'object',
          required: ['structure'],
          properties: {
            structure: {
              type: 'string',
              description: 'Payment structure label (e.g. "30/70", "net30", "100% prepay")',
            },
            prepay_pct: {
              type: 'number',
              description: 'Prepayment percentage (e.g. 30)',
            },
            on_delivery_pct: {
              type: 'number',
              description: 'On-delivery percentage (e.g. 70)',
            },
            net_days: {
              type: 'number',
              description: 'Net payment days (e.g. 30)',
            },
            notes: {
              type: 'string',
              description: 'Additional payment context (e.g. "Supplier requires prepayment for production run")',
            },
          },
          description: 'Payment terms',
        },
        delivery: {
          type: 'object',
          required: ['timeline'],
          properties: {
            timeline: {
              type: 'string',
              description: 'Delivery timeline (e.g. "2-3 weeks from order confirmation")',
            },
            incoterms: {
              type: 'string',
              description: 'Incoterms (e.g. "DDP", "EXW", "CIF")',
            },
            warehouse: {
              type: 'string',
              description: 'Ship-from location (e.g. "EU warehouse, Netherlands")',
            },
            shipping_notes: {
              type: 'string',
              description: 'Shipping details (e.g. "Freight included in unit price")',
            },
          },
          description: 'Delivery terms',
        },
        market_context: {
          type: 'object',
          properties: {
            situation: {
              type: 'string',
              description: 'Brief market situation (e.g. "Global nitrile supply constrained due to raw material shortages")',
            },
            price_justification: {
              type: 'string',
              description: 'Why this price is fair (e.g. "Current spot market at €4.20, this is pre-committed stock")',
            },
            urgency_driver: {
              type: 'string',
              description: 'Why act now (e.g. "Available EU stock is limited and allocated on first-come basis")',
            },
            recovery_timeline: {
              type: 'string',
              description: 'Expected price recovery (e.g. "6 months")',
            },
          },
          description: 'Market context for framing the price. Omit for standard quotes.',
        },
        validity_days: {
          type: 'number',
          description: 'How many days the quote is valid (default 7)',
        },
        language: {
          type: 'string',
          enum: ['en', 'fi', 'de', 'sv'],
          description: 'Override quote language. Usually omit this — language is auto-detected from customer_country.',
        },
        notes: {
          type: 'string',
          description: 'Additional notes or conditions to include',
        },
        sender_name: {
          type: 'string',
          description: 'Signature name. Default "Finn". Use team member name (e.g. "Johannes") when they send from own email.',
        },
        sender_title: {
          type: 'string',
          description: 'Signature title. Default "Export Manager, Droppe".',
        },
        sender_email: {
          type: 'string',
          description: 'Signature email. Default "finn@droppe.com". Use team member email when sending from own email.',
        },
      },
    },
  },

  {
    name: 'create_email_draft',
    description:
      'Create an email draft in a team member\'s Gmail. The draft appears in their Drafts folder, ready to review and send. ' +
      'Use this after generate_quote when the team wants to send from their own email instead of via Finn. ' +
      'Avoids copy-paste issues. Team member opens Gmail, reviews the draft, hits send.',
    input_schema: {
      type: 'object',
      required: ['mailbox', 'to', 'subject', 'body'],
      properties: {
        mailbox: {
          type: 'string',
          enum: ['johannes@droppe.fi', 'oskar@droppe.fi', 'jonas@droppe.fi', 'finn@droppe.com', 'jonas.wagner@droppe-group.de'],
          description: 'Which mailbox to create the draft in (team member\'s email)',
        },
        to: {
          type: 'string',
          description: 'Recipient email address',
        },
        subject: {
          type: 'string',
          description: 'Email subject',
        },
        body: {
          type: 'string',
          description: 'Email body (plain text)',
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'CC recipients',
        },
      },
    },
  },

  // ========================================
  // DATA / SHEETS
  // ========================================

  {
    name: 'scan_sheet',
    description:
      'Scan an entire spreadsheet tab to answer aggregate questions. ' +
      'Use this for: "how many suppliers sent price lists?", "which brands are frozen?", ' +
      '"who has no ads?", "list all priority 1 suppliers". ' +
      'Optionally filter by column/value to narrow results.',
    input_schema: {
      type: 'object',
      required: ['sheet'],
      properties: {
        sheet: {
          type: 'string',
          enum: ['transition', 'mastertab', 'okr', 'analytics'],
          description: 'Which sheet: transition (price updates), mastertab (supplier ops), okr (brand priorities), analytics (GMV/ROAS)',
        },
        filter_column: {
          type: 'string',
          description: 'Column name to filter by (partial match, case-insensitive)',
        },
        filter_value: {
          type: 'string',
          description: 'Value to filter for (partial match, case-insensitive)',
        },
      },
    },
  },

  {
    name: 'update_sheet',
    description:
      'Update a field in the Supplier Mastertab or 2026 Transition spreadsheet. ' +
      'Use for recording price list updates, changing ops status, updating SKU counts, etc. ' +
      'For Mastertab: catalog_type, available_skus, source_language, source_currency, raw_data_folder. ' +
      'For 2026 Transition: price_update_status, price_list_link, ops_stop_date, ops_resume_date.',
    input_schema: {
      type: 'object',
      required: ['prefix', 'tab', 'field', 'value'],
      properties: {
        prefix: {
          type: 'string',
          description: '3-letter SKU prefix (BLK, ARB, UNG...)',
        },
        tab: {
          type: 'string',
          enum: ['transition', 'mastertab'],
          description: 'Which sheet tab to update',
        },
        field: {
          type: 'string',
          description: 'Field name to update (e.g. price_update_status, price_list_link, available_skus)',
        },
        value: {
          type: 'string',
          description: 'New value',
        },
        supplier_name: {
          type: 'string',
          description: 'Supplier name (fallback if prefix lookup fails)',
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

  {
    name: 'post_progress',
    description:
      'Post a progress update to the CURRENT Slack thread while you work. ' +
      'Use this for progressive reporting: post each finding as you discover it, ' +
      'so the team sees live updates. Then finish with a final summary in your response. ' +
      'Example: researching 5 suppliers → post a finding for each one as you go.',
    input_schema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          description: 'Progress update text (use Slack mrkdwn: *bold*, _italic_, dashes for bullets)',
        },
      },
    },
  },

  // ========================================
  // PROJECTS (sales cases, market initiatives)
  // ========================================

  {
    name: 'manage_project',
    description:
      'Manage a sales project/case. Projects track market theses, supplier positions, ' +
      'intel signals, actions, and proposals. One tool handles all project operations. ' +
      'Use for: creating projects, adding intel, tracking supplier positions, managing actions, ' +
      'updating thesis, viewing dashboard. ' +
      'Example projects: "nitrile supply crisis", "DACH expansion", "co-ad rollout".',
    input_schema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: {
          type: 'string',
          enum: [
            'create', 'dashboard', 'list',
            'add_intel', 'update_thesis',
            'set_position', 'add_action', 'complete_action',
            'add_proposal',
          ],
          description: 'What to do with the project',
        },
        project_id: {
          type: 'string',
          description: 'Project ID (e.g. "nitrile-2026"). Required for all ops except "list" and "create".',
        },
        // For create
        name: {
          type: 'string',
          description: 'Project name (for create)',
        },
        category: {
          type: 'string',
          description: 'Category: disposables, workwear, safety, etc. (for create)',
        },
        thesis: {
          type: 'string',
          description: 'Project thesis / market context (for create and update_thesis)',
        },
        // For add_intel
        source: {
          type: 'string',
          description: 'Intel source — supplier name, market report, email, etc.',
        },
        signal: {
          type: 'string',
          description: 'What was learned (for add_intel)',
        },
        // For set_position
        supplier: {
          type: 'string',
          description: 'Supplier name (for set_position)',
        },
        prefix: {
          type: 'string',
          description: 'SKU prefix (for set_position)',
        },
        supplier_status: {
          type: 'string',
          enum: ['monitoring', 'contacted', 'negotiating', 'locked', 'blocked', 'lost'],
          description: 'Supplier status in this project (for set_position)',
        },
        price_offered: {
          type: 'string',
          description: 'Price offered/quoted (for set_position)',
        },
        notes: {
          type: 'string',
          description: 'Notes about this supplier position (for set_position)',
        },
        // For add_action
        action: {
          type: 'string',
          description: 'Action to take (for add_action)',
        },
        owner: {
          type: 'string',
          description: 'Who owns this action: Finn, Johannes, Oskar, Jarno (for add_action)',
        },
        due: {
          type: 'string',
          description: 'Due date YYYY-MM-DD (for add_action)',
        },
        // For complete_action
        action_id: {
          type: 'string',
          description: 'Action ID to complete (for complete_action)',
        },
        // For add_proposal
        proposal: {
          type: 'string',
          description: 'Proposal text — a pitch angle or offer to use with suppliers (for add_proposal)',
        },
      },
    },
  },
];
