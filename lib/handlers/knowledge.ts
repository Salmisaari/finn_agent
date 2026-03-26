// lib/handlers/knowledge.ts
// Finn — Supplier knowledge graph
// Profile hydration: Pipedrive is the single source of truth
// Org fields + deal + contacts + activities + notes → SupplierProfile
// Vercel KV = 24h read cache

import {
  getSupplierOrg,
  searchSupplierOrgs,
  getPipeline11Deal,
  getOrgPersons,
  getOrgActivities,
  getOrgNotes,
  createOrgNote,
  updateOrgFields,
  type SupplierOrgData,
  type Pipeline11Deal,
  type SupplierContact,
  type SupplierActivity,
  type SupplierNote,
} from './pipedrive';
import {
  getMastertabRow,
  getOKRBrandsRow,
  getTransitionRow,
  getBrandAnalytics,
  type MastertabRow,
  type OKRBrandsRow,
  type TransitionRow,
} from './sheets';

export type { SupplierContact, SupplierActivity, SupplierNote };

// KV is optional — if not configured, reads go direct to Pipedrive
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kv: any | null = null;

async function getKV() {
  if (kv) return kv;
  if (!process.env.KV_REST_API_URL) return null;
  try {
    const { kv: vercelKv } = await import('@vercel/kv');
    kv = vercelKv;
    return kv;
  } catch {
    return null;
  }
}

const KV_TTL_PROFILE = 60 * 60 * 24;  // 24h
const KV_TTL_PERF    = 60 * 60 * 6;   // 6h

// ========================================
// SUPPLIER PROFILE SCHEMA
// ========================================

export interface SupplierPerformance {
  months_loaded: number;
  gmv_last_3m: number;
  orders_last_month: number;
  margin_per_order: number;
  aov: number;
  ad_spend_last_month: number;
  roas: number;
  co_advertising_pct: number;
  as_of: string;
}

export interface NegotiationSignals {
  signals: string[];
  opportunities: string[];
  last_computed: string;
}

export interface SupplierProfile {
  // Identity
  prefix: string;
  supplier_id?: string;
  pipedrive_org_id: number;
  name: string;
  brand_names?: string;
  country?: string;
  warehouse_country?: string;
  agreed_markets?: string;

  // Pipeline position
  pipeline_stage?: string;
  pipeline_stage_id?: number;
  pipeline_stage_order?: number;
  next_stage?: string;
  days_in_stage?: number;
  owner?: string;

  // Commercial terms
  catalog_discount_pct?: number;
  payment_terms?: string;
  mov?: number;
  shipping_fee?: string;
  free_shipping_limit?: string;
  small_order_fees?: string;
  kickbacks?: string;
  cash_discounts?: string;
  return_policy?: string;

  // Operations
  order_email?: string;
  order_email_cc?: string;
  webstore?: string;
  webstore_logins?: string;
  order_process?: string;
  tracking_format?: string;
  integration_capability?: string;
  delivery_responsibility?: string;
  catalog_updates?: string;
  delivery_options?: string;
  return_instructions?: string;

  // Invoicing
  invoicing_email?: string;
  invoicing_address?: string;   // OVT e-invoice address
  invoicing_operator?: string;
  invoicing_language?: string;

  // Contacts
  contacts?: SupplierContact[];

  // Activities
  open_activities?: SupplierActivity[];
  next_activity?: SupplierActivity;
  recent_done_activities?: SupplierActivity[];

  // Notes (free-text relationship history)
  notes?: SupplierNote[];

  // Performance (loaded on demand, separate TTL)
  performance?: SupplierPerformance;

  // Negotiation intelligence (computed)
  negotiation?: NegotiationSignals;

  // Ads status (from OKR Brands tab)
  ads_status?: string;
  strategic_notes?: string;
  priority?: number;
  okr_owner?: string;
  latest_action?: string;

  // Price update history (from 2026 Transition tab)
  price_update_status?: string;
  price_list_link?: string;
  ops_stop_date?: string;
  ops_resume_date?: string;

  // Mastertab operational data
  catalog_type?: string;
  available_skus?: number;
  source_language?: string;
  source_currency?: string;
  raw_data_folder?: string;
  dynamic_shipping?: boolean;
  fixed_take_rate?: number;

  // Relationship metadata
  last_contact_date?: string;
  org_notes?: string;
  description?: string;
  sequence_campaigns?: string;

  // Meta
  profile_updated_at: string;
}

// ========================================
// NEGOTIATION SIGNAL DETECTION
// ========================================

function computeNegotiationSignals(profile: Omit<SupplierProfile, 'negotiation'>): NegotiationSignals {
  const signals: string[] = [];
  const opportunities: string[] = [];

  // --- PRICING SIGNALS ---

  if (profile.price_update_status) {
    const status = profile.price_update_status.toLowerCase();
    if (status === 'ask' || status === 'pending') {
      signals.push('price_update_pending');
      opportunities.push(`Price list status is "${profile.price_update_status}" — request updated price list for current year`);
    }
  }

  if (profile.ops_stop_date && !profile.ops_resume_date) {
    signals.push('ops_paused');
    opportunities.push(`Operations paused since ${profile.ops_stop_date} — check if price list received and resume`);
  }

  if (profile.catalog_discount_pct != null && profile.catalog_discount_pct < 40) {
    signals.push('discount_below_40pct');
    opportunities.push(`Catalog discount is ${profile.catalog_discount_pct}% — Droppe baseline is 40%; negotiate up`);
  }

  // --- LOGISTICS SIGNALS ---

  if (profile.shipping_fee) {
    const fee = parseFloat(profile.shipping_fee.replace(/[^0-9.]/g, ''));
    if (!isNaN(fee) && fee > 15) {
      signals.push('shipping_fee_high');
      opportunities.push(`Shipping fee is ${profile.shipping_fee} (benchmark €7 GLS) — renegotiate logistics terms`);
    }
  }

  if (profile.mov != null && profile.mov > 0) {
    signals.push('mov_exists');
    opportunities.push(`MOV is ${profile.mov} — push to remove; D2C customers need to test before committing`);
  }

  if (profile.small_order_fees) {
    signals.push('small_order_fee');
    opportunities.push(`Small order fees present (${profile.small_order_fees}) — negotiate away; adds friction`);
  }

  // --- INTEGRATION SIGNALS ---

  if (!profile.integration_capability || profile.integration_capability.toLowerCase().includes('manual')) {
    signals.push('integration_gap');
    opportunities.push(`No/manual integration — propose order flow automation (Droppe is ready to push when it suits them)`);
  }

  if (!profile.tracking_format || profile.tracking_format.toLowerCase().includes('no')) {
    signals.push('tracking_missing');
    opportunities.push(`No tracking format configured — customers expect delivery tracking; escalate`);
  }

  // --- RELATIONSHIP SIGNALS ---

  if (profile.last_contact_date) {
    const lastContact = new Date(profile.last_contact_date);
    const daysSince = Math.floor((Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > 60) {
      signals.push('contact_dormant');
      opportunities.push(`Last contact ${daysSince} days ago — relationship going cold, re-engage`);
    }
  }

  if (profile.pipeline_stage && profile.days_in_stage != null) {
    const stageThresholds: Record<string, number> = {
      'Discovery': 30, 'NBM Gate': 14, 'Onboarding': 21, 'Masterdata': 21,
      'Go-Live Gate': 14, 'Content': 30, 'MOV': 21, 'Pricing': 21,
      'Integrations': 60, 'Logos': 30, 'Paid Ads Gate': 14,
      'Growth Roadmap': 60, 'Negotiate': 30,
    };
    const threshold = stageThresholds[profile.pipeline_stage];
    if (threshold && profile.days_in_stage > threshold) {
      signals.push('pipeline_stuck');
      opportunities.push(`Stuck in ${profile.pipeline_stage} for ${profile.days_in_stage} days (threshold: ${threshold}) — push to next stage`);
    }
  }

  // --- ACTIVITY SIGNALS ---

  if (profile.next_activity?.due_date) {
    const daysOverdue = Math.floor(
      (Date.now() - new Date(profile.next_activity.due_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysOverdue > 1) {
      signals.push('activity_overdue');
      opportunities.push(
        `"${profile.next_activity.subject}" was due ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} ago — follow up or reschedule`
      );
    }
  }

  // --- CONTENT SIGNALS ---

  if (profile.available_skus != null && profile.available_skus < 5) {
    signals.push('content_weak');
    opportunities.push(`Only ${profile.available_skus} SKUs available — thin catalog, push for more products`);
  }

  // --- GROWTH SIGNALS (need performance data) ---

  if (profile.performance) {
    const { roas, co_advertising_pct } = profile.performance;

    if (roas > 4 && co_advertising_pct === 0) {
      signals.push('roas_ready_for_coad');
      opportunities.push(`ROAS ${roas.toFixed(1)}x with no co-advertising — propose co-ad model`);
    }

    if (roas > 5 && co_advertising_pct > 0) {
      signals.push('coad_budget_expandable');
      opportunities.push(`ROAS ${roas.toFixed(1)}x with co-ad active — propose increasing ad budget share`);
    }
  }

  if (opportunities.length === 0) {
    opportunities.push('No immediate action items — relationship in good standing');
  }

  return { signals, opportunities, last_computed: new Date().toISOString() };
}

// ========================================
// PROFILE REBUILD
// ========================================

function rebuildSupplierProfile(
  org: SupplierOrgData,
  deal: Pipeline11Deal | null,
  contacts: SupplierContact[],
  openActivities: SupplierActivity[],
  recentDoneActivities: SupplierActivity[],
  notes: SupplierNote[],
  mastertab: MastertabRow | null,
  okr: OKRBrandsRow | null,
  transition: TransitionRow | null,
): SupplierProfile {
  const profile: Omit<SupplierProfile, 'negotiation'> = {
    // Identity
    prefix: org.prefix || '',
    supplier_id: org.supplier_id,
    pipedrive_org_id: org.id,
    name: org.name,
    brand_names: org.brand_names,
    country: org.country_code,
    warehouse_country: org.warehouse_country,
    agreed_markets: org.agreed_markets,

    // Pipeline
    pipeline_stage: deal?.stage_name,
    pipeline_stage_id: deal?.stage_id,
    pipeline_stage_order: deal?.stage_order,
    next_stage: deal?.next_stage_name || undefined,
    days_in_stage: deal?.days_in_stage,
    owner: okr?.owner || org.owner_name,

    // Commercial terms
    catalog_discount_pct: org.catalog_discount_pct,
    payment_terms: org.payment_terms,
    mov: org.mov,
    shipping_fee: org.shipping_fee,
    free_shipping_limit: org.free_shipping_limit,
    small_order_fees: org.small_order_fees,
    kickbacks: org.kickbacks,
    cash_discounts: org.cash_discounts,
    return_policy: org.return_policy,

    // Operations
    order_email: org.order_email,
    order_email_cc: org.order_email_cc,
    webstore: org.webstore,
    webstore_logins: org.webstore_logins,
    order_process: org.order_process,
    tracking_format: org.tracking_format,
    integration_capability: org.integration_capability,
    delivery_responsibility: org.delivery_responsibility,
    catalog_updates: org.catalog_updates,
    delivery_options: org.delivery_options,
    return_instructions: org.return_instructions,

    // Invoicing
    invoicing_email: org.invoicing_email,
    invoicing_address: org.invoicing_address,
    invoicing_operator: org.invoicing_operator,
    invoicing_language: org.invoicing_language,

    // Contacts & activities
    contacts: contacts.length ? contacts : undefined,
    open_activities: openActivities.length ? openActivities : undefined,
    next_activity: openActivities.find((a) => a.due_date) || openActivities[0] || undefined,
    recent_done_activities: recentDoneActivities.length ? recentDoneActivities.slice(0, 3) : undefined,

    // Notes
    notes: notes.length ? notes : undefined,

    // OKR Brands data
    ads_status: okr?.ads_status,
    strategic_notes: okr?.strategic_notes,
    priority: okr?.priority,
    okr_owner: okr?.owner,
    latest_action: okr?.latest_action,

    // 2026 Transition data
    price_update_status: transition?.price_update_status,
    price_list_link: transition?.price_list_link,
    ops_stop_date: transition?.ops_stop_date,
    ops_resume_date: transition?.ops_resume_date,

    // Mastertab operational data
    catalog_type: mastertab?.catalog_type,
    available_skus: mastertab?.available_skus,
    source_language: mastertab?.source_language,
    source_currency: mastertab?.source_currency,
    raw_data_folder: mastertab?.raw_data_folder,
    dynamic_shipping: mastertab?.dynamic_shipping,
    fixed_take_rate: mastertab?.fixed_take_rate,

    // Relationship
    last_contact_date: org.latest_visit,
    org_notes: org.org_notes_marketing,
    description: org.description,
    sequence_campaigns: org.sequence_campaigns,

    profile_updated_at: new Date().toISOString(),
  };

  const negotiation = computeNegotiationSignals(profile);
  return { ...profile, negotiation };
}

// ========================================
// GET SUPPLIER PROFILE
// ========================================

export async function getSupplierProfile(opts: {
  name?: string;
  prefix?: string;
  org_id?: number;
}): Promise<{ profile: SupplierProfile | null; found: boolean; candidates?: string[] }> {

  const store = await getKV();
  if (opts.org_id && store) {
    const cached = await store.get(`finn:supplier:${opts.org_id}`);
    if (cached) {
      console.log(`[knowledge] Cache hit for org ${opts.org_id}`);
      return { profile: cached as SupplierProfile, found: true };
    }
  }

  // Resolve org from Pipedrive
  let org: SupplierOrgData | null = null;

  if (opts.org_id) {
    org = await getSupplierOrg(opts.org_id);
  } else if (opts.name || opts.prefix) {
    const query = opts.name || opts.prefix!;
    const results = await searchSupplierOrgs(query);

    if (results.length === 0) return { profile: null, found: false };

    if (results.length === 1) {
      org = results[0];
    } else {
      const exact = results.find(
        (r) =>
          r.name.toLowerCase() === query.toLowerCase() ||
          r.prefix?.toLowerCase() === query.toLowerCase()
      );
      if (exact) {
        org = exact;
      } else {
        return {
          profile: null,
          found: false,
          candidates: results.map((r) => `${r.name} (prefix: ${r.prefix || '?'}, id: ${r.id})`),
        };
      }
    }
  }

  if (!org) return { profile: null, found: false };

  const prefix = org.prefix || '';

  // Fetch all sources in parallel: Pipedrive + Sheets
  const [deal, contacts, openActivities, recentDoneActivities, notes, mastertab, okr, transition] = await Promise.all([
    getPipeline11Deal(org.id).catch(() => null),
    getOrgPersons(org.id).catch(() => [] as SupplierContact[]),
    getOrgActivities(org.id, { done: false, limit: 20 }).catch(() => [] as SupplierActivity[]),
    getOrgActivities(org.id, { done: true, limit: 5 }).catch(() => [] as SupplierActivity[]),
    getOrgNotes(org.id, 10).catch(() => [] as SupplierNote[]),
    prefix ? getMastertabRow(prefix).catch(() => null) : Promise.resolve(null),
    prefix ? getOKRBrandsRow(prefix).catch(() => null) : Promise.resolve(null),
    prefix ? getTransitionRow(prefix, org.name).catch(() => null) : Promise.resolve(null),
  ]);

  const profile = rebuildSupplierProfile(org, deal, contacts, openActivities, recentDoneActivities, notes, mastertab, okr, transition);

  // Cache in KV
  if (store) {
    await store.set(`finn:supplier:${org.id}`, profile, { ex: KV_TTL_PROFILE });
    if (org.prefix) {
      await store.set(`finn:supplier:prefix:${org.prefix.toUpperCase()}`, org.id, { ex: KV_TTL_PROFILE });
    }
  }

  return { profile, found: true };
}

// ========================================
// CONSOLIDATED SUPPLIER CONTEXT
// One call to rule them all — profile + emails from ALL mailboxes
// ========================================

import {
  gmail_searchAllMailboxes,
  type MultiMailboxResult,
} from './gmail';

export interface SupplierContext {
  profile: SupplierProfile;
  recent_emails: MultiMailboxResult[];
  email_summary: string;
}

export async function getSupplierContext(opts: {
  name?: string;
  prefix?: string;
  org_id?: number;
  days_back?: number;
}): Promise<{ context: SupplierContext | null; found: boolean; candidates?: string[] }> {
  // Load profile and search emails in parallel
  const profilePromise = getSupplierProfile(opts);
  const emailPromise = gmail_searchAllMailboxes({
    query: '',
    supplier_name: opts.name || opts.prefix,
    days_back: opts.days_back || 30,
  }).catch(() => [] as MultiMailboxResult[]);

  const [profileResult, emailResults] = await Promise.all([profilePromise, emailPromise]);

  if (!profileResult.found || !profileResult.profile) {
    return { context: null, found: false, candidates: profileResult.candidates };
  }

  // Build email summary
  const totalThreads = emailResults.reduce((sum, r) => sum + r.threads.length, 0);
  const summaryParts: string[] = [];
  for (const r of emailResults) {
    summaryParts.push(`${r.mailbox}: ${r.threads.length} thread(s)`);
    for (const t of r.threads.slice(0, 3)) {
      summaryParts.push(`  - "${t.subject}" (${t.date}) from ${t.from}`);
    }
  }

  const emailSummary = totalThreads === 0
    ? 'No recent emails found across any mailbox in the last 30 days.'
    : `${totalThreads} email thread(s) found:\n${summaryParts.join('\n')}`;

  return {
    context: {
      profile: profileResult.profile,
      recent_emails: emailResults,
      email_summary: emailSummary,
    },
    found: true,
  };
}

// ========================================
// GET SUPPLIER WITH PERFORMANCE DATA
// ========================================

export async function getSupplierWithPerformance(
  orgId: number,
  brandName: string,
  months = 3
): Promise<SupplierPerformance | null> {
  const store = await getKV();
  if (store) {
    const cached = await store.get(`finn:perf:${orgId}`);
    if (cached) return cached as SupplierPerformance;
  }

  if (!brandName) return null;

  const monthlyData = await getBrandAnalytics(brandName, months).catch(() => []);
  if (monthlyData.length === 0) return null;

  const latest = monthlyData[monthlyData.length - 1];
  const totalGmv = monthlyData.reduce((sum, m) => sum + m.gmv, 0);

  const perf: SupplierPerformance = {
    months_loaded: monthlyData.length,
    gmv_last_3m: totalGmv,
    orders_last_month: latest.orders,
    margin_per_order: latest.margin_per_order,
    aov: latest.aov,
    ad_spend_last_month: latest.ad_spend,
    roas: latest.roas,
    co_advertising_pct: latest.co_advertising_pct,
    as_of: new Date().toISOString(),
  };

  // Cache with 6h TTL
  if (store) {
    await store.set(`finn:perf:${orgId}`, perf, { ex: KV_TTL_PERF });
  }

  return perf;
}

// ========================================
// CACHE INVALIDATION
// ========================================

export async function bustSupplierCache(orgId: number, prefix?: string): Promise<void> {
  const store = await getKV();
  if (!store) return;
  await store.del(`finn:supplier:${orgId}`);
  if (prefix) await store.del(`finn:supplier:prefix:${prefix.toUpperCase()}`);
}

// ========================================
// LOG INTERACTION
// ========================================

export async function logSupplierInteraction(
  orgId: number,
  interactionType: string,
  summary: string,
  outcome?: string
): Promise<{ success: boolean; note_id?: number; error?: string }> {
  try {
    const content = [
      `[Finn] ${interactionType}`,
      `Summary: ${summary}`,
      outcome ? `Outcome: ${outcome}` : '',
      `Time: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');

    const { note_id } = await createOrgNote(orgId, content, false);
    await bustSupplierCache(orgId);
    return { success: true, note_id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ========================================
// UPDATE SUPPLIER FIELD
// ========================================

export async function updateSupplierField(
  orgId: number,
  fieldName: string,
  value: unknown,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateOrgFields(orgId, { [fieldName]: value });
    await createOrgNote(
      orgId,
      `[Finn] Field updated: ${fieldName} = ${value}\nReason: ${reason}\nTime: ${new Date().toISOString()}`,
      false
    );
    await bustSupplierCache(orgId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export { KV_TTL_PERF };
