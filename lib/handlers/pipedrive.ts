// lib/handlers/pipedrive.ts
// Finn — Pipedrive supplier org queries
// Source of truth: Organizations with Supplier ID custom field set
// Pipeline 11 = "Brands" relationship funnel

const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN!;
const PIPEDRIVE_DOMAIN = process.env.PIPEDRIVE_DOMAIN || 'https://droppe.pipedrive.com';

// ========================================
// CUSTOM FIELD KEYS (hardcoded — these don't change)
// Source: Pipedrive API /organizationFields
// ========================================

const F = {
  // Identity
  SUPPLIER_ID:   'a2a8cca22ecff0711af66c684effb926b94a0927',
  PREFIX:        '93c886c3e094840a05cfc3a3b1e0cd59f9775c9a',
  BRAND_NAMES:   'd2e889c52b268afc2f5c88073d6750c74e85662f',

  // Commercial terms
  CATALOG_DISCOUNT:    '823eb9e0f50e18c58d90056f8548a167d3c7395b',
  PAYMENT_TERMS:       '93719b2287cbc271308ccb29bab377ff4552a1b0',
  MOV:                 '7038811719a510a09ab3d8faa680823a03f32fc6',
  FREE_SHIPPING_LIMIT: 'be47e0450554ee7ae2a0d62f6dc5d222d6ff5193',
  SHIPPING_FEE:        'e47158ad65dac4685ac6fffaf04989498c867400',
  SMALL_ORDER_FEES:    'bf40a66f97e03f2a113f72a62d43c8c0d6a46a9e',
  KICKBACKS:           'd8ec2687cbf3ad2388c9a15b499731231812888a',
  CASH_DISCOUNTS:      '6a3499b98c5339cb060b02de2cdccefb248381df',
  RETURN_POLICY:       '18fb84b9e77cddbfad3e84e9848b9351717ab651',
  AGREED_MARKETS:      '3fbeb5320077243a8743dc6bd234ff672546042b',

  // Operations
  ORDER_PROCESS:           '037b4c232bc1e08d14724ecf3e81fa9a06097c3e',
  ORDER_EMAIL:             '3d18d7a0405773a0b514cbe78b20c099fe19e16f',
  ORDER_EMAIL_CC:          '48dfcedc6e0d0b88556e02cf7b77892da0f1f00c',
  WEBSTORE_LOGINS:         '07c3e50d6ff2e700fc6bc112034503b06123485c',
  WEBSTORE:                '913448a7e05c5cc19999c1ef3ea7d892bdfde8c1',
  TRACKING_FORMAT:         '4eeafe08d63a602488af5bebb9316fc6237997d0',
  WAREHOUSE_COUNTRY:       '25576d006e4537ab8aabacc5c8c1b216acf999c8',
  DELIVERY_RESPONSIBILITY: '2566f5c90f3b4712a2cee18197d370eb8ffcf4a7',
  DELIVERY_OPTIONS:        '33ef46248f76682d1342b65e25dd54b3175a3fd5',
  INTEGRATION_CAPABILITY:  '8b4422a3ee167167093d2d3139af6f51fb07ea27',
  CATALOG_UPDATES:         'f8ccb55260746b4709d4b53847de5168d1d61b59',

  // Invoicing
  INVOICING_EMAIL:    'b0ccceb01268ffde050b076b30990bc0255d6c02',
  INVOICING_ADDRESS:  'df109f5ce430f7c308ede754349c20fa1c490c41',  // OVT e-invoice
  INVOICING_OPERATOR: '8fdc1585674378bb3afccc58a1ada975456bf7aa',
  INVOICING_LANGUAGE: 'a5d2766c9b8f5289783450294156a78a01618711',  // Netvisor

  // Returns
  RETURN_INSTRUCTIONS: 'a80bf7056fc7512ff38c7d44b445361edaedfddb',

  // Relationship
  LATEST_VISIT:          '163472929eee80d6945ef1998f79dc60efdb5571',
  LATEST_DEAL:           '65dbdaea69a4edf8dd899321f8084bfb725675cc',
  ORG_NOTES_MARKETING:   '308edea7335d808a3308306844f03db1e1307ef9',
  DESCRIPTION:           'dabb116494253f4ac73370705b6a721f3f453fae',
  SEQUENCE_CAMPAIGNS:    '366fdea53494a990b778a136788cbc3d9ad30ebd',
} as const;

// ========================================
// OPTION LABEL LOOKUP
// Set/enum fields return numeric IDs — this maps them to readable labels
// Source: GET /organizationFields (stable; only changes if options are edited in Pipedrive)
// ========================================

const OPTION_LABELS: Record<number, string> = {
  // PAYMENT_TERMS
  3029: 'Pre-payment', 3058: 'Net 8', 3059: 'Net 10', 3030: 'Net 14', 3031: 'Net 30',
  3060: 'Net 60', 3069: 'Net 20', 3070: 'Net 21', 3262: 'Credit limit 50k€',
  3165: 'no agreed policy', 3263: 'Net 30 EOM', 3264: 'Net 14 EOM',

  // AGREED_MARKETS
  3224: 'Finland', 3225: 'Sweden', 3226: 'Germany', 3227: 'Austria',
  3228: 'Netherlands', 3229: 'Belgium', 3230: 'Italy', 3231: 'EU region', 3232: 'Global',

  // ORDER_PROCESS
  3037: 'API', 3038: 'Email', 3039: 'Webstore', 3233: 'XML',

  // TRACKING_FORMAT
  3206: 'PDF Sales Invoice', 3207: 'PDF Delivery Note', 3208: 'Manual Email',
  3209: 'Via Webshop', 3210: 'DHL Email', 3211: 'GLS Email', 3212: 'Other Carrier Email',

  // DELIVERY_RESPONSIBILITY
  3166: 'Dropshipping by supplier', 3167: 'Dropshipping by Droppe',
  3168: 'Dropshipping by supplier – own warehouse', 3169: 'Dropshipping by supplier – distributor',
  3170: 'Dropshipping by supplier – 3PL', 3171: 'Dropshipping by Droppe – 3PL',
  3172: 'Buyer-arranged pickup', 3173: 'Freight forwarder required', 3174: 'No agreed policy',

  // DELIVERY_OPTIONS
  3137: 'No agreed policy', 3138: 'Only through warehouse', 3139: 'Backorders allowed',
  3140: 'Backorders not allowed', 3141: 'Partial shipments allowed',
  3142: 'Partial shipments not allowed', 3143: 'Preordered shipments allowed',
  3144: 'Preordered shipments not allowed', 3145: 'Supplier determines shipment method',
  3146: 'Buyer chooses shipment method', 3147: 'Dropshipping available',
  3148: 'Fixed shipment schedule',

  // RETURN_POLICY
  3091: 'No returns', 3096: 'Returns within 8 days', 3092: 'Returns within 14 days',
  3093: 'Returns within 30 days', 3094: 'Returns within 60 days',
  3095: 'Defective/damaged items only', 3097: 'Returns with restocking fee',
  3098: "Returns at buyer's expense", 3099: 'Supplier pre-approval required',
  3100: 'Exchange only – no refunds', 3101: 'Partial refund (-20%) damaged packaging',
  3102: 'No returns if used or missing packaging', 3192: 'No returns for custom-made products',
  3203: 'No general stock cleansing or returns without cause',

  // CATALOG_UPDATES
  3149: 'No agreed policy', 3150: 'Frequency not specified', 3151: 'Annual (calendar year)',
  3152: 'Half-year', 3153: 'Quarterly', 3154: 'Monthly', 3155: 'Real-time',
  3156: 'On request', 3157: 'Automated (API)', 3158: 'Email notifications',
  3159: 'Platform notifications', 3160: 'Manual updates required',
  3189: '10 days notice if costs increased',

  // KICKBACKS
  3193: '0%', 3194: '1%', 3195: '2%', 3196: '3%', 3197: '4%',
  3198: '5%', 3199: '6%', 3200: '7%', 3201: '8%', 3202: '8% growth',

  // CASH_DISCOUNTS
  3176: 'No agreed policy', 3177: '2% within 10 days', 3178: '2% within 14 days',
  3179: '3% within 10 days', 3180: '3% within 14 days', 3181: '4% within 10 days',
  3182: '4% within 14 days', 3183: '5% within 7 days', 3184: '2% immediate',
  3185: '3% immediate', 3186: '4% immediate',
};

// Resolve comma-separated option IDs → human-readable labels
function resolveOptions(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const ids = String(raw).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  if (ids.length === 0) return undefined;
  const labels = ids.map((id) => OPTION_LABELS[id] || String(id));
  return labels.join(', ');
}

// Pipeline 11 ("Brands") stage order — used for advancement logic
export const PIPELINE_11_STAGES = [
  { id: 203, name: 'Discovery' },
  { id: 373, name: 'NBM Gate' },
  { id: 60,  name: 'Onboarding' },
  { id: 163, name: 'Masterdata' },
  { id: 204, name: 'Go-Live Gate' },
  { id: 244, name: 'Content' },
  { id: 381, name: 'MOV' },
  { id: 374, name: 'Pricing' },
  { id: 379, name: 'New Markets' },
  { id: 375, name: 'Integrations' },
  { id: 382, name: 'Logos' },
  { id: 376, name: 'Paid Ads Gate' },
  { id: 377, name: 'Growth Roadmap' },
  { id: 378, name: 'Negotiate' },
];

const STAGE_ID_TO_ORDER = new Map(PIPELINE_11_STAGES.map((s, i) => [s.id, i]));
const STAGE_ID_TO_NAME  = new Map(PIPELINE_11_STAGES.map((s) => [s.id, s.name]));

// Pipedrive filter 12757 = all orgs where Supplier ID is not empty
const SUPPLIER_FILTER_ID = 12757;

// ========================================
// PIPEDRIVE API CLIENT
// ========================================

async function pipedriveGet(path: string): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PIPEDRIVE_DOMAIN}/api/v1${path}${sep}api_token=${PIPEDRIVE_API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pipedrive GET ${path} failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`Pipedrive API error on ${path}: ${JSON.stringify(json.error || json)}`);
  return json.data;
}

async function pipedrivePost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${PIPEDRIVE_DOMAIN}/api/v1${path}?api_token=${PIPEDRIVE_API_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pipedrive POST ${path} failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`Pipedrive API error: ${JSON.stringify(json.error || json)}`);
  return json.data;
}

async function pipedrivePut(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${PIPEDRIVE_DOMAIN}/api/v1${path}?api_token=${PIPEDRIVE_API_TOKEN}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pipedrive PUT ${path} failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`Pipedrive API error: ${JSON.stringify(json.error || json)}`);
  return json.data;
}

// ========================================
// DATA TYPES
// ========================================

export interface SupplierOrgData {
  id: number;
  name: string;
  country_code?: string;
  owner_name?: string;
  open_deals_count?: number;
  won_deals_count?: number;

  // Identity
  supplier_id?: string;
  prefix?: string;
  brand_names?: string;

  // Commercial terms
  catalog_discount_pct?: number;
  payment_terms?: string;
  mov?: number;
  free_shipping_limit?: string;
  shipping_fee?: string;
  small_order_fees?: string;
  kickbacks?: string;
  cash_discounts?: string;
  return_policy?: string;
  agreed_markets?: string;

  // Operations
  order_process?: string;
  order_email?: string;
  order_email_cc?: string;
  webstore?: string;
  webstore_logins?: string;
  tracking_format?: string;
  warehouse_country?: string;
  delivery_responsibility?: string;
  delivery_options?: string;
  integration_capability?: string;
  catalog_updates?: string;

  // Invoicing
  invoicing_email?: string;
  invoicing_address?: string;
  invoicing_operator?: string;
  invoicing_language?: string;

  // Returns
  return_instructions?: string;

  // Relationship
  latest_visit?: string;
  latest_deal?: string;
  org_notes_marketing?: string;
  description?: string;
  sequence_campaigns?: string;
}

export interface Pipeline11Deal {
  id: number;
  title: string;
  stage_id: number;
  stage_name: string;
  stage_order: number;     // 0-based position in PIPELINE_11_STAGES
  next_stage_id: number | null;
  next_stage_name: string | null;
  days_in_stage: number;
  status: string;
  update_time: string;
  add_time: string;
}

// ========================================
// ORG EXTRACTION
// ========================================

function extractOrg(raw: Record<string, unknown>): SupplierOrgData {
  const str = (key: string): string | undefined => {
    const v = raw[key];
    return v != null && v !== '' ? String(v) : undefined;
  };
  const num = (key: string): number | undefined => {
    const v = raw[key];
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  };
  const owner = raw.owner_id as Record<string, unknown> | undefined;

  return {
    id: raw.id as number,
    name: raw.name as string,
    country_code: str('country_code'),
    owner_name: owner?.name as string | undefined,
    open_deals_count: raw.open_deals_count as number | undefined,
    won_deals_count: raw.won_deals_count as number | undefined,

    // Identity
    supplier_id: str(F.SUPPLIER_ID),
    prefix: str(F.PREFIX),
    brand_names: str(F.BRAND_NAMES),

    // Commercial
    catalog_discount_pct: num(F.CATALOG_DISCOUNT),
    payment_terms: resolveOptions(raw[F.PAYMENT_TERMS]),
    mov: num(F.MOV),
    free_shipping_limit: str(F.FREE_SHIPPING_LIMIT),
    shipping_fee: str(F.SHIPPING_FEE),
    small_order_fees: str(F.SMALL_ORDER_FEES),
    kickbacks: resolveOptions(raw[F.KICKBACKS]),
    cash_discounts: resolveOptions(raw[F.CASH_DISCOUNTS]),
    return_policy: resolveOptions(raw[F.RETURN_POLICY]),
    agreed_markets: resolveOptions(raw[F.AGREED_MARKETS]),

    // Operations
    order_process: resolveOptions(raw[F.ORDER_PROCESS]),
    order_email: str(F.ORDER_EMAIL),
    order_email_cc: str(F.ORDER_EMAIL_CC),
    webstore: str(F.WEBSTORE),
    webstore_logins: str(F.WEBSTORE_LOGINS),
    tracking_format: resolveOptions(raw[F.TRACKING_FORMAT]),
    warehouse_country: str(F.WAREHOUSE_COUNTRY),
    delivery_responsibility: resolveOptions(raw[F.DELIVERY_RESPONSIBILITY]),
    delivery_options: resolveOptions(raw[F.DELIVERY_OPTIONS]),
    integration_capability: str(F.INTEGRATION_CAPABILITY),
    catalog_updates: resolveOptions(raw[F.CATALOG_UPDATES]),

    // Invoicing
    invoicing_email: str(F.INVOICING_EMAIL),
    invoicing_address: str(F.INVOICING_ADDRESS),
    invoicing_operator: str(F.INVOICING_OPERATOR),
    invoicing_language: str(F.INVOICING_LANGUAGE),

    // Returns
    return_instructions: str(F.RETURN_INSTRUCTIONS),

    // Relationship
    latest_visit: str(F.LATEST_VISIT),
    latest_deal: str(F.LATEST_DEAL),
    org_notes_marketing: str(F.ORG_NOTES_MARKETING),
    description: str(F.DESCRIPTION),
    sequence_campaigns: str(F.SEQUENCE_CAMPAIGNS),
  };
}

// ========================================
// ORG QUERIES
// ========================================

export async function getSupplierOrg(orgId: number): Promise<SupplierOrgData | null> {
  try {
    const raw = (await pipedriveGet(`/organizations/${orgId}`)) as Record<string, unknown>;
    return raw ? extractOrg(raw) : null;
  } catch {
    return null;
  }
}

export async function searchSupplierOrgs(query: string): Promise<SupplierOrgData[]> {
  const data = (await pipedriveGet(
    `/organizations/search?term=${encodeURIComponent(query)}&fields=name&exact_match=false&limit=5`
  )) as { items: { item: Record<string, unknown> }[] } | null;

  if (!data?.items?.length) return [];

  // Search results are partial — fetch full details for each
  const orgs = await Promise.all(
    data.items.map((item) => getSupplierOrg(item.item.id as number))
  );

  return orgs.filter(Boolean) as SupplierOrgData[];
}

// All supplier orgs (filter 12757 = Supplier ID is not empty)
export async function getAllSupplierOrgs(limit = 200): Promise<SupplierOrgData[]> {
  const data = (await pipedriveGet(
    `/organizations?filter_id=${SUPPLIER_FILTER_ID}&limit=${limit}`
  )) as Record<string, unknown>[] | null;

  if (!data?.length) return [];
  return data.map(extractOrg);
}

// ========================================
// PIPELINE 11 DEALS
// ========================================

function extractPipeline11Deal(raw: Record<string, unknown>): Pipeline11Deal | null {
  // stage_id is returned as a number in deal list API
  const stageId = raw.stage_id as number;
  const stageOrder = STAGE_ID_TO_ORDER.get(stageId) ?? -1;

  // Skip deals not in Pipeline 11
  if (stageOrder < 0 && raw.pipeline_id !== 11) return null;

  const stageName = STAGE_ID_TO_NAME.get(stageId) || `Stage ${stageId}`;
  const nextStage = stageOrder >= 0 ? PIPELINE_11_STAGES[stageOrder + 1] : null;
  const updateTime = new Date(raw.update_time as string);
  const daysInStage = Math.floor((Date.now() - updateTime.getTime()) / (1000 * 60 * 60 * 24));

  return {
    id: raw.id as number,
    title: raw.title as string,
    stage_id: stageId,
    stage_name: stageName,
    stage_order: stageOrder,
    next_stage_id: nextStage?.id ?? null,
    next_stage_name: nextStage?.name ?? null,
    days_in_stage: daysInStage,
    status: raw.status as string,
    update_time: raw.update_time as string,
    add_time: raw.add_time as string,
  };
}

// Get the most advanced open deal for an org in Pipeline 11
export async function getPipeline11Deal(orgId: number): Promise<Pipeline11Deal | null> {
  const data = (await pipedriveGet(
    `/organizations/${orgId}/deals?pipeline_id=11&status=open&limit=50`
  )) as Record<string, unknown>[] | null;

  const deals = (data || [])
    .map(extractPipeline11Deal)
    .filter(Boolean) as Pipeline11Deal[];

  if (deals.length === 0) {
    // Try any status (might be won/lost but still relevant)
    const allData = (await pipedriveGet(
      `/organizations/${orgId}/deals?pipeline_id=11&status=all&limit=10`
    )) as Record<string, unknown>[] | null;

    const allDeals = (allData || [])
      .map(extractPipeline11Deal)
      .filter(Boolean) as Pipeline11Deal[];

    if (!allDeals.length) return null;
    return allDeals.sort((a, b) => b.stage_order - a.stage_order)[0];
  }

  // Most advanced stage wins
  return deals.sort((a, b) => b.stage_order - a.stage_order)[0];
}

// All open Pipeline 11 deals (for pipeline overview)
export async function getAllPipeline11Deals(stageId?: number): Promise<(Pipeline11Deal & { org_id: number; org_name: string })[]> {
  const stageParam = stageId ? `&stage_id=${stageId}` : '';
  const data = (await pipedriveGet(
    `/deals?pipeline_id=11&status=open&limit=200${stageParam}`
  )) as Record<string, unknown>[] | null;

  if (!data?.length) return [];

  const results: (Pipeline11Deal & { org_id: number; org_name: string })[] = [];

  for (const raw of data) {
    const deal = extractPipeline11Deal(raw);
    if (!deal) continue;
    const orgData = raw.org_id as Record<string, unknown> | undefined;
    results.push({
      ...deal,
      org_id: (orgData?.value as number) || 0,
      org_name: (orgData?.name as string) || 'Unknown',
    });
  }

  return results;
}

// Advance deal to next stage in Pipeline 11
export async function advancePipelineDeal(dealId: number): Promise<{ success: boolean; new_stage_name?: string; error?: string }> {
  try {
    const raw = (await pipedriveGet(`/deals/${dealId}`)) as Record<string, unknown>;
    const deal = extractPipeline11Deal(raw);

    if (!deal) return { success: false, error: 'Deal not found or not in Pipeline 11' };
    if (!deal.next_stage_id) return { success: false, error: `Already at final stage: ${deal.stage_name}` };

    await pipedrivePut(`/deals/${dealId}`, { stage_id: deal.next_stage_id });

    return { success: true, new_stage_name: deal.next_stage_name || undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Move deal to a specific stage
export async function setDealStage(dealId: number, stageId: number): Promise<void> {
  await pipedrivePut(`/deals/${dealId}`, { stage_id: stageId });
}

// ========================================
// NOTES
// ========================================

export async function createOrgNote(
  orgId: number,
  content: string,
  pin = false
): Promise<{ note_id: number }> {
  const data = (await pipedrivePost('/notes', {
    content,
    org_id: orgId,
    pinned_to_organization_flag: pin ? 1 : 0,
  })) as Record<string, unknown>;

  return { note_id: data.id as number };
}

// ========================================
// FIELD UPDATES
// ========================================

// Map of friendly name → Pipedrive field key (for safe external use)
const UPDATABLE_FIELDS: Record<string, string> = {
  catalog_discount_pct:    F.CATALOG_DISCOUNT,
  payment_terms:           F.PAYMENT_TERMS,
  mov:                     F.MOV,
  free_shipping_limit:     F.FREE_SHIPPING_LIMIT,
  shipping_fee:            F.SHIPPING_FEE,
  small_order_fees:        F.SMALL_ORDER_FEES,
  kickbacks:               F.KICKBACKS,
  cash_discounts:          F.CASH_DISCOUNTS,
  return_policy:           F.RETURN_POLICY,
  agreed_markets:          F.AGREED_MARKETS,
  order_process:           F.ORDER_PROCESS,
  order_email:             F.ORDER_EMAIL,
  order_email_cc:          F.ORDER_EMAIL_CC,
  webstore:                F.WEBSTORE,
  tracking_format:         F.TRACKING_FORMAT,
  warehouse_country:       F.WAREHOUSE_COUNTRY,
  delivery_responsibility: F.DELIVERY_RESPONSIBILITY,
  integration_capability:  F.INTEGRATION_CAPABILITY,
  catalog_updates:         F.CATALOG_UPDATES,
  org_notes_marketing:     F.ORG_NOTES_MARKETING,
  description:             F.DESCRIPTION,
};

export async function updateOrgField(
  orgId: number,
  fieldName: string,
  value: unknown
): Promise<void> {
  const fieldKey = UPDATABLE_FIELDS[fieldName];
  if (!fieldKey) throw new Error(`Unknown field: ${fieldName}. Valid fields: ${Object.keys(UPDATABLE_FIELDS).join(', ')}`);
  await pipedrivePut(`/organizations/${orgId}`, { [fieldKey]: value });
}

// Bulk update (multiple fields at once)
export async function updateOrgFields(
  orgId: number,
  updates: Record<string, unknown>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    const fieldKey = UPDATABLE_FIELDS[key];
    if (fieldKey) {
      payload[fieldKey] = value;
    } else {
      console.warn(`[pipedrive] Unknown field skipped: ${key}`);
    }
  }
  if (Object.keys(payload).length === 0) throw new Error('No valid fields to update');
  await pipedrivePut(`/organizations/${orgId}`, payload);
}

// ========================================
// NOTES
// ========================================

export interface SupplierNote {
  id: number;
  content: string;
  add_time: string;
  pinned: boolean;
  user_name?: string;
}

export async function getOrgNotes(orgId: number, limit = 10): Promise<SupplierNote[]> {
  try {
    const data = (await pipedriveGet(
      `/notes?org_id=${orgId}&limit=${limit}&sort=add_time+DESC`
    )) as Record<string, unknown>[] | null;

    if (!data?.length) return [];

    return data.map((n) => ({
      id: n.id as number,
      content: (n.content as string) || '',
      add_time: (n.add_time as string) || '',
      pinned: Boolean(n.pinned_to_organization_flag),
      user_name: (n.user as Record<string, unknown> | undefined)?.name as string | undefined,
    }));
  } catch {
    return [];
  }
}

// ========================================
// CONTACTS (Persons linked to Org)
// ========================================

export interface SupplierContact {
  id: number;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
}

export async function getOrgPersons(orgId: number): Promise<SupplierContact[]> {
  try {
    const data = (await pipedriveGet(
      `/organizations/${orgId}/persons?limit=50`
    )) as Record<string, unknown>[] | null;

    if (!data?.length) return [];

    return data
      .map((p) => {
        const emails = (p.email as Array<{ value: string; primary: boolean }> | undefined) || [];
        const phones = (p.phone as Array<{ value: string; primary: boolean }> | undefined) || [];
        const primaryEmail = emails.find((e) => e.primary)?.value || emails[0]?.value;
        const primaryPhone = phones.find((ph) => ph.primary)?.value || phones[0]?.value;

        return {
          id: p.id as number,
          name: p.name as string,
          title: (p.job_title as string | undefined) || undefined,
          email: primaryEmail || undefined,
          phone: primaryPhone || undefined,
        };
      })
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

// ========================================
// ACTIVITIES (open + recent done)
// ========================================

export interface SupplierActivity {
  id: number;
  type: string;           // 'call', 'email', 'meeting', 'task', etc.
  subject: string;
  due_date?: string;      // YYYY-MM-DD
  due_time?: string;      // HH:MM
  note?: string;
  done: boolean;
  assigned_to?: string;
}

export async function getOrgActivities(
  orgId: number,
  opts: { done?: boolean; limit?: number } = {}
): Promise<SupplierActivity[]> {
  try {
    const doneParam = opts.done ? 1 : 0;
    const limit = opts.limit ?? 20;
    const data = (await pipedriveGet(
      `/organizations/${orgId}/activities?done=${doneParam}&limit=${limit}`
    )) as Record<string, unknown>[] | null;

    if (!data?.length) return [];

    return data.map((a) => {
      const user = a.assigned_to_user_id as Record<string, unknown> | undefined;
      return {
        id: a.id as number,
        type: (a.type as string) || 'task',
        subject: (a.subject as string) || '',
        due_date: (a.due_date as string | undefined) || undefined,
        due_time: (a.due_time as string | undefined) || undefined,
        note: (a.note as string | undefined) || undefined,
        done: Boolean(a.done),
        assigned_to: (user?.name as string | undefined) || undefined,
      };
    });
  } catch {
    return [];
  }
}

// ========================================
// LEGACY EXPORTS (kept for backwards compat)
// ========================================

export { createOrgNote as supplierOrg_createNote };
export type { SupplierOrgData as SupplierOrgBasic };
