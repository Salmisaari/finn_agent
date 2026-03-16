# Finn Agent — Architecture & Build Plan

## What Finn Is

Finn is Droppe's internal supplier intelligence AI. It maintains a deep knowledge graph
of every brand/supplier relationship and helps the commercial team manage those relationships
through the full lifecycle — from discovery to active renegotiation.

Finn is NOT a support agent. It is a commercial intelligence layer.

Core jobs:
1. Know the full history of each supplier: terms, performance, contacts, open topics
2. Surface what is actionable: "price list is 8 months old", "shipping fee kills conversion",
   "ROAS is ready for co-ad push", "3 emails unanswered"
3. Progress suppliers through the Brands pipeline (Pipeline 11)
4. Draft supplier communications informed by relationship history
5. Monitor for signals across email, deals, and performance data

---

## Droppe's Positioning (what Finn uses when writing to/about suppliers)

Source: Droppe_Brand_Partner_Deck.pptx (Finn has read full content)

**Core pitch:** "We're not a webshop. We're your distribution operations layer —
plug in your catalog, we handle content, ads, ops, returns, support across 7 European markets."

**Revenue formula:** Traffic × Conversion × Price × Availability

**Brand tiers:**
- LAUNCH: New to online / entering a market. Droppe builds pages, first customers within days.
- GROW: Online but underleveraged. Expand markets, optimize conversion, build recurring buyers.
- SCALE: Proven online sellers. Maximize ROAS, full automation, co-invested ad budgets.

**Co-advertising model:**
- Droppe co-invests 12% of generated revenue back into ad budget
- Higher ROAS = lower effective cost for brand
- Example: ROAS 4.5x on €10k budget → Droppe covers €5,400; brand pays €4,600

**Six failure modes to diagnose per supplier:**
1. Pricing not competitive (wholesale pricing, MOV, above market)
2. B2B logistics in D2C world (€20 B2B shipping vs €6 e-commerce benchmark)
3. Weak product content (1 image, no sizing charts)
4. Slow delivery times (5+ days vs next-day expectation)
5. Missing integrations (manual order processing = humans in the middle)
6. No demand generation (no ads, no traffic)

**Six integration requirements (readiness checklist per supplier):**
- Warehouse integration (real-time stock)
- Stock integration (live inventory across channels)
- Tracking code integration (automated shipment tracking)
- Order handling integration (seamless order processing)
- Invoice integration (automated billing)
- Real-time pricing (granular, item-level)

**Email/meeting tone:** Warm, growth-oriented, partnership framing. Not transactional.
"Grow together", "build traction". Always offer Johannes's booking link for meetings.
Push for no MOV. Shipping cost is the #1 margin risk (benchmark ~€7/delivery).

---

## Data Sources

### 1. Pipedrive (primary — source of truth for supplier relationships)

**Pipeline 11 — "Brands"** — the supplier relationship funnel:

| Stage ID | Stage Name     | What it means |
|----------|---------------|---------------|
| 203      | Discovery      | Found a brand, researching |
| 373      | NBM Gate       | First meeting qualified |
| 60       | Onboarding     | Process started |
| 163      | Masterdata     | Getting product catalog |
| 204      | Go-Live Gate   | Launch readiness check |
| 244      | Content        | Building product pages |
| 381      | MOV            | Negotiating minimum order value |
| 374      | Pricing        | Negotiating discount % |
| 379      | New Markets    | Expanding geographies |
| 375      | Integrations   | Automating order flow |
| 382      | Logos          | Brand assets |
| 376      | Paid Ads Gate  | Ads readiness check |
| 377      | Growth Roadmap | Strategic planning |
| 378      | Negotiate      | Renegotiation cycle |

**Org custom field keys** (hash keys on Pipedrive Organization records):

```
Identity:
  a2a8cca22ecff0711af66c684effb926b94a0927  Supplier ID
  93c886c3e094840a05cfc3a3b1e0cd59f9775c9a  Prefix (3-letter SKU code)
  d2e889c52b268afc2f5c88073d6750c74e85662f  Brand names

Commercial terms:
  823eb9e0f50e18c58d90056f8548a167d3c7395b  Catalog discount %
  93719b2287cbc271308ccb29bab377ff4552a1b0  Payment terms
  7038811719a510a09ab3d8faa680823a03f32fc6  Minimum order value (MOV)
  be47e0450554ee7ae2a0d62f6dc5d222d6ff5193  Free shipping limit (FSL)
  e47158ad65dac4685ac6fffaf04989498c867400  Shipping fee
  bf40a66f97e03f2a113f72a62d43c8c0d6a46a9e  Small order fees
  d8ec2687cbf3ad2388c9a15b499731231812888a  Kickbacks
  6a3499b98c5339cb060b02de2cdccefb248381df  Cash discounts
  18fb84b9e77cddbfad3e84e9848b9351717ab651  Return policy
  3fbeb5320077243a8743dc6bd234ff672546042b  Agreed markets

Operations:
  037b4c232bc1e08d14724ecf3e81fa9a06097c3e  Order process
  3d18d7a0405773a0b514cbe78b20c099fe19e16f  Order email
  48dfcedc6e0d0b88556e02cf7b77892da0f1f00c  Order email cc
  07c3e50d6ff2e700fc6bc112034503b06123485c  Webstore logins
  913448a7e05c5cc19999c1ef3ea7d892bdfde8c1  Webstore
  4eeafe08d63a602488af5bebb9316fc6237997d0  Tracking Format
  25576d006e4537ab8aabacc5c8c1b216acf999c8  Warehouse country
  2566f5c90f3b4712a2cee18197d370eb8ffcf4a7  Delivery responsibility
  33ef46248f76682d1342b65e25dd54b3175a3fd5  Delivery options
  8b4422a3ee167167093d2d3139af6f51fb07ea27  Integration capability
  f8ccb55260746b4709d4b53847de5168d1d61b59  Catalog updates

Relationship:
  163472929eee80d6945ef1998f79dc60efdb5571  Latest visit (date)
  65dbdaea69a4edf8dd899321f8084bfb725675cc  Latest deal (date)
  308edea7335d808a3308306844f03db1e1307ef9  Org notes for marketing
  dabb116494253f4ac73370705b6a721f3f453fae  Description
  366fdea53494a990b778a136788cbc3d9ad30ebd  All sequence campaigns
```

All supplier orgs in Pipedrive: filter 12757 = orgs where Supplier ID is not empty.
API token: same as Pepe agent (shared Pipedrive instance, no conflict —
Finn reads Orgs/Pipeline 11, Pepe reads Deals/Pipeline 13).

### 2. Supplier Mastertab (Google Sheets)
Spreadsheet: `1Z7fXRDviUWgtjIQLL-MWNhfy4IMziAkeiHH827XTEns`
Tab: `Supplier Mastertab` (~290 rows)

Key fields beyond what Pipedrive has:
- Catalog type (Spreadsheet / API / FTP)
- Source file language, currency
- Raw data folder link (Google Drive)
- Available SKUs count
- Order credentials (username/password for supplier portals)
- Dynamic shipping flag, SEK pricing flag
- Fixed take rate, exemption reason
- Brand image link

Also useful tabs:
- `2026 Transition` — price update tracking: which suppliers sent new price lists,
  ops pause/resume dates, price list links. This is the temporal price history layer.
- `Supplier Prio` — task backlog: catalog updates, new launches, pending work
- `Supplier DB Data` — short/code/siteid mapping

### 3. OKR Brands Tab (Google Sheets)
Spreadsheet: `1ev1kuYO9dRrlyquSkAznzvk858nnX8IryvOHJfhUTEc`
Tab: `Brands`

Fields:
- Priority (1/2/3), Owner (Jo/Ja), Supplier name, Prefix (SKU code)
- Ads status: Scale / For terms / For data / No ads
- Strategic notes (what's blocking, what's the intent)
- Weekly action columns (W4, W5, W6...) — rolling action log per supplier

This is the **commercial relationship status tracker** — who owns what and what's
the current action needed. Currently maintained manually; Finn should read AND write here.

### 4. Brand Analytics (Google Sheets)
Spreadsheet: `12mVb9CuIyzicjtpsb6HZuiJVgbqKLwefqtENQiLYi8Y`

Key tabs:
- `suppliers` — overall GMV/margin trends by month (Nov 2024 → present):
  orders_total, value_total, cost_product, cost_shipping, sku_margin, total_margin,
  brand_ads, paid_per_order, co_advertising, aov_per_order, margin_per_order
- `brands` — per-brand list (brand_name column)
- `google_ads_daily_by_brand` — ads performance per brand

This is the **performance intelligence layer** — enables detecting:
- Margin per order declining → pricing/take rate conversation
- ROAS >4 with no co-ad → propose co-advertising
- Shipping cost eating margin → renegotiate logistics terms
- GMV stagnant → new markets or content push

### 5. Email (Gmail)
- `finn@droppe.com` — Finn's dedicated outbound/inbound for supplier comms
  OAuth2 refresh token needs to be generated and stored in env
- `orders@droppe.com` — operational (order confirmations, shipping notices) —
  read access for tracking context when investigating supplier order issues
- `johannes@droppe.com` — Johannes's personal; Finn does NOT access this

---

## Supplier Knowledge Graph — Schema

One profile per supplier, keyed by SKU prefix (e.g. `BLK`, `ARB`, `NMN`).
Stored in Vercel KV with 24h TTL. Pipedrive org = source of truth for most fields.

```typescript
interface SupplierProfile {
  // Identity
  prefix: string            // 3-letter code (BLK, ARB, NMN)
  supplier_id: string       // Pipedrive supplier ID custom field
  pipedrive_org_id: number  // Pipedrive org record ID
  name: string
  brand_names: string[]     // all represented brands
  country: string
  warehouse_country: string
  agreed_markets: string[]  // FIN, SWE, GER, etc.

  // Pipeline position
  pipeline_stage: string    // current stage name in Pipeline 11
  pipeline_stage_id: number
  days_in_stage: number
  next_stage: string        // what comes after current stage
  owner: string             // who owns this relationship (Jo/Ja/etc.)

  // Commercial terms (from Pipedrive org custom fields)
  catalog_discount_pct: number | null    // e.g. 40
  payment_terms: string | null           // Net 30, Prepay, etc.
  mov: number | null                     // minimum order value (0 = none)
  shipping_fee: string | null            // agreed shipping cost per delivery
  free_shipping_limit: string | null     // e.g. "€150"
  small_order_fees: string | null
  kickbacks: string | null
  cash_discounts: string | null
  return_policy: string | null

  // Contact
  order_email: string | null
  order_email_cc: string | null
  webstore: string | null
  webstore_logins: string | null

  // Operations
  order_process: string | null           // Droppe Auto-Email, Portal, API, etc.
  tracking_format: string | null
  integration_capability: string | null  // free text on what integrations exist
  delivery_responsibility: string | null // Supplier / Droppe
  catalog_updates: string | null

  // Performance (from analytics sheet, refreshed on demand)
  performance?: {
    gmv_last_3m: number
    orders_last_month: number
    margin_per_order: number
    aov: number
    ad_spend_last_month: number
    roas: number
    co_advertising_pct: number
    as_of: string   // ISO date of last refresh
  }

  // Ads status (from OKR Brands tab)
  ads_status: 'Scale' | 'For terms' | 'For data' | 'No ads' | null
  strategic_notes: string | null        // from OKR Brands tab Notes column

  // Price update history (from 2026 Transition tab)
  price_update_status: 'Received' | 'Ask' | 'Pending' | null
  price_list_link: string | null
  ops_stop_date: string | null
  ops_resume_date: string | null

  // Mastertab operational data
  catalog_type: string | null           // Spreadsheet / API / FTP
  available_skus: number | null
  source_language: string | null
  raw_data_folder: string | null

  // Negotiation intelligence (computed by Finn, stored in KV)
  negotiation?: {
    next_opportunity: string    // e.g. "Price list >8 months old — request update"
    signals: string[]           // detected signals from performance data
    last_updated: string
  }

  // Meta
  last_contact_date: string | null  // from Pipedrive latest_visit field
  latest_deal_date: string | null
  profile_updated_at: string
}
```

---

## Architecture — Profile Hydration (NOT ACE)

### Why not ACE

ACE (Classify → Generate → Execute) was designed for high-variance unknown inbound queries —
any customer asking anything about any order. Finn has a fundamentally different problem:
- Domain is bounded: ~200 suppliers, all named, all knowable
- Every query starts from a supplier context
- Writes matter as much as reads — new learnings should update the profile
- Proactive monitoring is as important as reactive Q&A

The classifier step adds no value. The right pattern is profile hydration.

### Finn's Query Flow (reactive — Slack mention)

```
@finn mention in Slack
  ↓
Extract supplier name(s) from query text
  ↓
Load supplier profile(s) from KV (cache hit) or rebuild from sources
  [Pipedrive org fields + pipeline stage + analytics + OKR tab + 2026 Transition]
  ↓
Inject full profile(s) as context into Claude prompt
  ↓
Claude reasons with profile as ground truth + optional tool calls
  [search emails, read thread, check analytics, look up Pipedrive notes]
  ↓
Generate response
  ↓
If new information was discovered → write back to profile (delta-write)
  [update Pipedrive custom field + bust KV cache]
  ↓
Post to Slack thread
```

### Finn's Proactive Flow (cron — twice daily)

```
Scan all supplier orgs (filter 12757 — ~200 orgs)
  ↓
For each supplier:
  - Check pipeline stage + days in stage → flag if stuck
  - Check price_update_status → flag if "Ask" or stale
  - Check shipping_fee → flag if >€15
  - Check mov → flag if >0 (push to remove)
  - Check performance.roas → flag if >4 with no co-advertising
  - Check margin_per_order trend → flag if declining >20% MoM
  - Check last_contact_date → flag if >60 days (dormant)
  ↓
Generate digest grouped by urgency
  ↓
Post to #supplier-ops Slack channel
```

### What to Keep from Current Scaffold

- `app/api/slack/route.ts` — keep structure, remove ACE classifier call
- `lib/ace/generator.ts` — keep Claude loop, update system prompt
- `lib/ace/executor.ts` — keep tool routing pattern, replace all tools
- `lib/ace/types.ts` — simplify: drop Domain type, add SupplierProfile
- `lib/handlers/gmail.ts` — keep, update to use finn@droppe.com
- `lib/handlers/slack.ts` — keep as-is
- `lib/handlers/pipedrive.ts` — major rewrite: focus on Org reads with known field keys
- `lib/handlers/knowledge.ts` — keep KV caching pattern, update schema

### What to Remove

- `lib/ace/classifier.ts` — drop entirely
- ACE domain classification logic throughout
- WhatsApp sandboxing (irrelevant for Finn)

---

## Tools (Finn v1)

Replacing current placeholder tools with these, informed by actual data sources:

### Core (always available)

**`get_supplier(prefix | name | org_id)`**
Load full SupplierProfile. Tries KV first, rebuilds from Pipedrive + sheets on miss.
Returns profile + negotiation signals computed on the fly.

**`search_supplier_emails(query, supplier_name?, days_back?)`**
Search finn@droppe.com Gmail inbox for supplier threads.

**`read_supplier_email(thread_id)`**
Read full thread content from Gmail.

**`send_supplier_email(to, body, subject?, thread_id?, human_verified)`**
Send/reply via finn@droppe.com. Hard gate: human_verified must be true.
Finn always drafts first, shows to team, sends only after explicit confirmation.

### Intelligence

**`get_supplier_performance(prefix | org_id, months?)`**
Pull from analytics sheet: GMV trend, margin/order, ROAS, ad spend by month.
Compute signals: declining margin, co-ad opportunity, stagnant GMV.

**`get_negotiation_signals(prefix | org_id)`**
Run the full negotiation intelligence check:
- Price list age (from 2026 Transition)
- Shipping fee vs benchmark
- MOV status
- ROAS vs co-ad threshold
- Pipeline stage readiness
- Days since last contact
Returns ranked list of opportunities with context.

**`get_pipeline_overview(stage?, owner?)`**
Scan Pipeline 11 deals. Optional filter by stage or owner.
Returns suppliers per stage, days in stage, stuck flags.

### Write (require explicit instruction)

**`update_supplier_field(org_id, field_name, value, reason)`**
Write a specific field back to Pipedrive org. Requires reason.
Busts KV cache. Creates audit note.

**`log_supplier_interaction(org_id, type, summary, outcome?)`**
Create a timestamped note on Pipedrive org.
Types: email_sent, email_received, call, meeting, terms_agreed, price_update, other.

**`advance_pipeline_stage(org_id, reason)`**
Move supplier deal to next stage in Pipeline 11.
Requires explicit instruction. Logs the advancement.

**`create_supplier_note(org_id, note, pin?)`**
Add internal note to Pipedrive org. Optionally pin.

### Team

**`post_to_slack(channel, message, urgency?)`**
Post to Slack channel. Used for escalations and alerts.

---

## Profile Rebuild Logic

When KV cache misses, Finn rebuilds the profile from all sources in parallel:

```typescript
async function rebuildSupplierProfile(orgId: number): Promise<SupplierProfile> {
  const [org, deal, masterdataRow, okrRow, transitionRow] = await Promise.all([
    pipedrive.getOrg(orgId),                    // Pipedrive org + all custom fields
    pipedrive.getPipeline11Deal(orgId),          // current stage in Brands pipeline
    sheets.getMastertabRow(prefix),             // operational data
    sheets.getOKRBrandsRow(prefix),             // commercial status + actions
    sheets.getTransitionRow(prefix),            // price update status
  ])

  // Performance data NOT loaded on every rebuild (expensive)
  // Loaded on demand via get_supplier_performance tool
  // Cached separately with 6h TTL

  return mergeIntoProfile(org, deal, masterdataRow, okrRow, transitionRow)
}
```

Profile TTL in KV: 24 hours.
Performance data TTL: 6 hours (separate KV key).

---

## Negotiation Intelligence — Signal Detection

These signals are computed on every `get_supplier()` call and returned as
`negotiation.signals[]`. Finn surfaces the top ones proactively.

```
PRICING SIGNALS:
- price_list_stale         Price list not updated in >6 months (from 2026 Transition)
- price_update_pending     Status is "Ask" — not yet received for current year
- discount_below_40pct     Catalog discount < 40% (Droppe's baseline ask)
- pricing_not_competitive  ROAS <2 despite ad spend → pricing may be the root cause

LOGISTICS SIGNALS:
- shipping_fee_high        Shipping fee >€15/delivery (benchmark: €7)
- mov_exists               MOV > 0 → push to remove for D2C testing
- small_order_fee          Small order fees present → friction, negotiate away
- b2b_logistics            Delivery responsibility = Supplier + no e-commerce logistics

GROWTH SIGNALS:
- roas_ready_for_coad      ROAS >4 but co_advertising not active → propose co-ad model
- coad_budget_expandable   Co-ad active + ROAS >5 → propose increasing budget share
- new_market_candidate     Strong performance in current market → ready to expand
- gmv_stagnant             <5% GMV growth MoM for 3+ months → intervention needed

RELATIONSHIP SIGNALS:
- contact_dormant          last_contact_date >60 days ago
- pipeline_stuck           days_in_stage > threshold for current stage
- integration_gap          Integration capability field shows missing items
- content_weak             <5 SKUs or no product images (from available_skus + catalog data)
```

---

## Email Approach (finn@droppe.com)

Finn uses finn@droppe.com for all supplier outbound.

**Tone rules** (from CLAUDE.md + brand deck):
- Warm, partnership framing — "grow together", not transactional
- Always push for no MOV — customers need to test before committing
- Flag shipping costs explicitly if above benchmark
- Frame integrations positively: "we're ready to push when it suits your team"
- For meeting requests: always accept, offer booking link
  https://calendar.google.com/calendar/u/0/appointments/AcZssZ3MWCBceBbM9EtKNFjHGusXmNCLqy37W_10UeY=
- Brief acknowledgement of any reply delay, then move forward
- Match language of the thread — do not default to English if thread is in Finnish/Swedish/German

**Human gate (non-negotiable):**
Finn NEVER sends an email autonomously. Flow:
1. Finn drafts the email and shows it to the team in Slack
2. Team member replies with confirmation ("send it" / "looks good")
3. Finn calls send_supplier_email with human_verified=true

---

## Implementation Phases

### Phase 1 — Core Profile Hydration (build this first)
Goal: `@finn what do we know about Blaklader?` works end-to-end.

- [ ] Rewrite `lib/handlers/pipedrive.ts` with all org field keys hardcoded
- [ ] Add sheets reader: `lib/handlers/sheets.ts` (Mastertab, OKR Brands, 2026 Transition)
- [ ] Rewrite `lib/handlers/knowledge.ts` with full SupplierProfile schema + rebuild logic
- [ ] Replace classifier with simple supplier name extractor in route.ts
- [ ] Rewrite system prompt in generator.ts (Finn personality + Droppe positioning)
- [ ] Implement `get_supplier` + `get_negotiation_signals` tools
- [ ] Set up Gmail OAuth2 for finn@droppe.com
- [ ] Deploy + test

### Phase 2 — Email Intelligence
Goal: `@finn find recent emails from Nitras and summarize open topics` works.

- [ ] Wire finn@droppe.com Gmail to `search_supplier_emails` + `read_supplier_email`
- [ ] Implement email thread parsing (extract commercial info: prices mentioned, terms discussed)
- [ ] Implement `send_supplier_email` with human gate
- [ ] Add `log_supplier_interaction` to record email exchanges in Pipedrive notes
- [ ] Test full draft → confirm → send flow

### Phase 3 — Performance Intelligence
Goal: `@finn which suppliers are ready for co-advertising?` works.

- [ ] Implement `get_supplier_performance` pulling from analytics sheet
- [ ] Wire performance data into profile (separate KV key, 6h TTL)
- [ ] Implement ROAS-based co-ad signal detection
- [ ] Implement margin decline detection
- [ ] Test `@finn which suppliers should we negotiate shipping with?`

### Phase 4 — Pipeline Management
Goal: `@finn advance Portwest to Content stage` and sweep cron work.

- [ ] Implement `advance_pipeline_stage` + `update_supplier_field`
- [ ] Implement `get_pipeline_overview` for funnel-level view
- [ ] Rewrite supplier sweep cron with full signal detection
- [ ] Cron posts actionable digest to #supplier-ops twice daily

### Phase 5 — Knowledge Enrichment (ongoing)
- [ ] Finn automatically logs interactions after emails are sent
- [ ] After each Slack session, Finn writes back what it learned to Pipedrive notes
- [ ] Slide comments from brand deck incorporated into positioning layer
- [ ] Temporal price history tracking (price changes over time, not just latest)

---

## Open Decisions

1. **Pipedrive API token** — share Pepe's or create separate for Finn?
   Recommendation: separate token for clean audit trails. Low effort.

2. **Pipeline 11 deal per org** — some orgs may have multiple deals in Pipeline 11
   (e.g. separate deals per market). Need to decide: use latest deal, or aggregate.
   Recommendation: use the deal closest to most advanced stage.

3. **OKR Brands tab writes** — Finn should eventually update the weekly action columns.
   Phase 1: read only. Phase 3+: write back.

4. **Analytics sheet auth** — currently uses johannes@droppe.fi gcloud credentials.
   Finn needs its own service account or OAuth2 for finn@droppe.com.
   Recommendation: share the same credentials for now, revisit at scale.

5. **Slide comments** — brand deck has comments with positioning feedback.
   Deferred to Phase 5 per Johannes's instruction.

---

## Environment Variables Needed

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-finn-...
SLACK_SIGNING_SECRET=...
FINN_SLACK_CHANNEL=...          # #supplier-ops channel ID

# LLM
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=...          # remove once classifier is dropped

# Pipedrive
PIPEDRIVE_API_TOKEN=...         # Finn's own token (or shared with Pepe for now)
PIPEDRIVE_DOMAIN=https://droppe.pipedrive.com

# Gmail (finn@droppe.com)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...         # OAuth2 refresh token for finn@droppe.com
GMAIL_SUPPLIER_INBOX=finn@droppe.com

# Google Sheets (for Mastertab, OKR, Analytics)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...        # OAuth2 for sheets access (johannes@droppe.fi creds)

# Sheet IDs
SHEET_MASTERTAB_ID=1Z7fXRDviUWgtjIQLL-MWNhfy4IMziAkeiHH827XTEns
SHEET_OKR_ID=1ev1kuYO9dRrlyquSkAznzvk858nnX8IryvOHJfhUTEc
SHEET_ANALYTICS_ID=12mVb9CuIyzicjtpsb6HZuiJVgbqKLwefqtENQiLYi8Y

# Vercel KV (knowledge graph cache)
KV_REST_API_URL=...
KV_REST_API_TOKEN=...

# Cron security
CRON_SECRET=...
```

---

## Files To Build / Rewrite (from current scaffold)

| File | Action | Notes |
|------|--------|-------|
| `lib/ace/types.ts` | Rewrite | Drop Domain, add SupplierProfile |
| `lib/ace/classifier.ts` | Delete | Replaced by name extractor inline |
| `lib/ace/generator.ts` | Rewrite | New system prompt, profile hydration |
| `lib/ace/executor.ts` | Rewrite | All new tools |
| `lib/tools/definitions.ts` | Rewrite | New tool schemas |
| `lib/handlers/pipedrive.ts` | Rewrite | Org-focused, all field keys |
| `lib/handlers/knowledge.ts` | Rewrite | Full SupplierProfile schema |
| `lib/handlers/gmail.ts` | Keep + update | finn@droppe.com credentials |
| `lib/handlers/slack.ts` | Keep | No changes needed |
| `lib/handlers/sheets.ts` | Create new | Read Mastertab, OKR, Analytics |
| `app/api/slack/route.ts` | Update | Remove classifier, add name extractor |
| `app/api/cron/supplier-sweep/route.ts` | Rewrite | Full signal detection |
| `PLAN.md` | This file | Reference throughout build |
