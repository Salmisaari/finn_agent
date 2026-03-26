// lib/handlers/sheets.ts
// Finn — Google Sheets integration for supplier data enrichment
// Reads: Supplier Mastertab, 2026 Transition, OKR Brands, Brand Analytics

import { google } from 'googleapis';

const SHEET_MASTERTAB_ID = process.env.SHEET_MASTERTAB_ID || '1Z7fXRDviUWgtjIQLL-MWNhfy4IMziAkeiHH827XTEns';
const SHEET_OKR_ID       = process.env.SHEET_OKR_ID       || '1ev1kuYO9dRrlyquSkAznzvk858nnX8IryvOHJfhUTEc';
const SHEET_ANALYTICS_ID = process.env.SHEET_ANALYTICS_ID || '12mVb9CuIyzicjtpsb6HZuiJVgbqKLwefqtENQiLYi8Y';

// Impersonate this user for Sheets access (must have access to the spreadsheets)
const SHEETS_IMPERSONATE_USER = 'finn@droppe.com';

function getSheetsClient() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    // Service account with domain-wide delegation (production)
    const key = JSON.parse(serviceAccountKey);
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      subject: SHEETS_IMPERSONATE_USER,
    });
    return google.sheets({ version: 'v4', auth });
  }

  // Fallback: OAuth2 refresh token (dev)
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Sheets not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY (production) ' +
      'or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN (dev).'
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: 'v4', auth });
}

// ========================================
// GENERIC SHEET HELPERS
// ========================================

type SheetRow = string[];

async function readSheet(spreadsheetId: string, tabName: string, maxRows = 500): Promise<{ headers: SheetRow; rows: SheetRow[] }> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:ZZ${maxRows}`,
  });

  const values = (res.data.values || []) as SheetRow[];
  if (values.length === 0) return { headers: [], rows: [] };

  const headers = values[0].map(String);
  const rows = values.slice(1).map((r) => r.map(String));
  return { headers, rows };
}

function findColumn(headers: SheetRow, candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.toLowerCase().trim() === candidate.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function rowToObject(headers: SheetRow, row: SheetRow): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i]?.trim();
    if (key) obj[key] = row[i] || '';
  }
  return obj;
}

// Find a row by matching a value in a given column
function findRow(
  headers: SheetRow,
  rows: SheetRow[],
  columnCandidates: string[],
  lookupValue: string
): Record<string, string> | null {
  const colIdx = findColumn(headers, columnCandidates);
  if (colIdx < 0) {
    console.warn(`[sheets] Could not find column ${JSON.stringify(columnCandidates)} in headers: ${headers.join(', ')}`);
    return null;
  }

  const target = lookupValue.toLowerCase().trim();
  const row = rows.find((r) => (r[colIdx] || '').toLowerCase().trim() === target);
  if (!row) return null;

  return rowToObject(headers, row);
}

// ========================================
// DATA TYPES
// ========================================

export interface MastertabRow {
  supplier_name?: string;
  prefix?: string;
  catalog_type?: string;       // Spreadsheet / API / FTP
  available_skus?: number;
  source_language?: string;
  source_currency?: string;
  raw_data_folder?: string;
  order_credentials?: string;
  dynamic_shipping?: boolean;
  sek_pricing?: boolean;
  fixed_take_rate?: number;
  exemption_reason?: string;
  brand_image_link?: string;
}

export interface OKRBrandsRow {
  priority?: number;           // 1/2/3
  owner?: string;              // Jo / Ja
  supplier_name?: string;
  prefix?: string;
  ads_status?: string;         // Scale / For terms / For data / No ads
  strategic_notes?: string;
  latest_action?: string;      // most recent weekly action column
}

export interface TransitionRow {
  supplier_name?: string;
  prefix?: string;
  price_update_status?: string;  // Received / Ask / Pending
  ops_stop_date?: string;
  ops_resume_date?: string;
  price_list_link?: string;
}

export interface AnalyticsMonthRow {
  month: string;
  orders: number;
  gmv: number;
  margin_eur: number;
  margin_pct: number;
  ad_spend: number;
  roas: number;
  co_advertising_pct: number;
  aov: number;
  margin_per_order: number;
}

// ========================================
// MASTERTAB
// ========================================

export async function getMastertabRow(prefix: string): Promise<MastertabRow | null> {
  try {
    const { headers, rows } = await readSheet(SHEET_MASTERTAB_ID, 'Supplier Mastertab');

    // Try to find by prefix first, then by name
    const prefixCandidates = ['prefix', 'code', 'sku', 'short', 'id'];
    const raw = findRow(headers, rows, prefixCandidates, prefix);
    if (!raw) {
      console.log(`[sheets] Mastertab: no row found for prefix "${prefix}"`);
      return null;
    }

    const numField = (key: string): number | undefined => {
      const v = findFieldValue(raw, [key]);
      if (!v) return undefined;
      const n = parseFloat(v.replace(',', '.'));
      return isNaN(n) ? undefined : n;
    };

    const strField = (...keys: string[]): string | undefined => {
      const v = findFieldValue(raw, keys);
      return v && v.trim() ? v.trim() : undefined;
    };

    const boolField = (...keys: string[]): boolean | undefined => {
      const v = findFieldValue(raw, keys);
      if (!v) return undefined;
      return ['yes', 'true', '1', 'x', '✓'].includes(v.toLowerCase().trim());
    };

    return {
      supplier_name: strField('supplier', 'supplier name', 'name'),
      prefix: strField('prefix', 'code', 'sku'),
      catalog_type: strField('catalog type', 'type', 'catalog'),
      available_skus: numField('available skus') || numField('skus') || numField('sku count'),
      source_language: strField('language', 'source language', 'lang'),
      source_currency: strField('currency', 'source currency'),
      raw_data_folder: strField('folder', 'raw data folder', 'data folder'),
      order_credentials: strField('order credentials', 'credentials', 'login'),
      dynamic_shipping: boolField('dynamic shipping', 'dynamic'),
      sek_pricing: boolField('sek pricing', 'sek'),
      fixed_take_rate: numField('take rate') || numField('fixed take rate'),
      exemption_reason: strField('exemption reason', 'exemption'),
      brand_image_link: strField('brand image', 'image link', 'logo'),
    };
  } catch (err) {
    console.error('[sheets] getMastertabRow error:', err);
    return null;
  }
}

// ========================================
// OKR BRANDS TAB
// ========================================

export async function getOKRBrandsRow(prefix: string): Promise<OKRBrandsRow | null> {
  try {
    const { headers, rows } = await readSheet(SHEET_OKR_ID, 'Brands');

    const prefixCandidates = ['prefix', 'code', 'sku', 'short'];
    const raw = findRow(headers, rows, prefixCandidates, prefix);
    if (!raw) return null;

    const strField = (...keys: string[]): string | undefined => {
      const v = findFieldValue(raw, keys);
      return v && v.trim() ? v.trim() : undefined;
    };

    // Find the most recent weekly action column (e.g. W4, W5, W6...)
    const weekColumns = headers
      .filter((h) => /^w\d+$/i.test(h.trim()))
      .sort()
      .reverse();
    let latestAction: string | undefined;
    for (const wCol of weekColumns) {
      const v = raw[wCol]?.trim();
      if (v) { latestAction = `${wCol}: ${v}`; break; }
    }

    const priorityStr = strField('priority', 'prio');
    const priority = priorityStr ? parseInt(priorityStr) : undefined;

    return {
      priority: isNaN(priority!) ? undefined : priority,
      owner: strField('owner', 'owned by'),
      supplier_name: strField('supplier', 'supplier name', 'name', 'brand'),
      prefix: strField('prefix', 'code'),
      ads_status: strField('ads status', 'ads', 'status'),
      strategic_notes: strField('notes', 'strategic notes', 'comment'),
      latest_action: latestAction,
    };
  } catch (err) {
    console.error('[sheets] getOKRBrandsRow error:', err);
    return null;
  }
}

// ========================================
// 2026 TRANSITION TAB (price update tracking)
// ========================================

export async function getTransitionRow(prefix: string, supplierName?: string): Promise<TransitionRow | null> {
  try {
    const { headers, rows } = await readSheet(SHEET_MASTERTAB_ID, '2026 Transition');

    // Try by prefix first, then by supplier name
    let raw = findRow(headers, rows, ['prefix', 'code', 'sku'], prefix);
    if (!raw && supplierName) {
      raw = findRow(headers, rows, ['supplier', 'supplier name', 'name', 'brand'], supplierName);
    }
    if (!raw) return null;

    const strField = (...keys: string[]): string | undefined => {
      const v = findFieldValue(raw!, keys);
      return v && v.trim() ? v.trim() : undefined;
    };

    return {
      supplier_name: strField('supplier', 'supplier name', 'name'),
      prefix: strField('prefix', 'code'),
      price_update_status: strField('status', 'price status', 'price update', 'update status'),
      ops_stop_date: strField('ops stop', 'stop date', 'paused'),
      ops_resume_date: strField('ops resume', 'resume date', 'resumed'),
      price_list_link: strField('price list', 'price list link', 'link'),
    };
  } catch (err) {
    // Tab might not exist — not an error
    if (err instanceof Error && err.message.includes('Unable to parse range')) {
      console.log('[sheets] 2026 Transition tab not found');
    } else {
      console.error('[sheets] getTransitionRow error:', err);
    }
    return null;
  }
}

// ========================================
// BRAND ANALYTICS (GMV / margin / ads per brand)
// ========================================

export async function getBrandAnalytics(
  brandName: string,
  months = 3
): Promise<AnalyticsMonthRow[]> {
  try {
    const { headers, rows } = await readSheet(SHEET_ANALYTICS_ID, 'suppliers', 2000);

    // Find the brand name column
    const brandColIdx = findColumn(headers, ['brand_name', 'brand', 'supplier', 'name']);
    if (brandColIdx < 0) return [];

    // Filter rows for this brand, take last N months
    const brandRows = rows
      .filter((r) => (r[brandColIdx] || '').toLowerCase().trim() === brandName.toLowerCase().trim())
      .slice(-months);

    return brandRows.map((row) => {
      const obj = rowToObject(headers, row);
      const n = (k: string) => parseFloat(obj[k] || '0') || 0;

      return {
        month: obj['month'] || obj['date'] || '',
        orders: n('orders_total') || n('orders'),
        gmv: n('value_total') || n('gmv') || n('revenue'),
        margin_eur: n('total_margin') || n('margin'),
        margin_pct: n('sku_margin') || n('margin_pct'),
        ad_spend: n('brand_ads') || n('ad_spend'),
        roas: n('roas') || 0,
        co_advertising_pct: n('co_advertising') || 0,
        aov: n('aov_per_order') || n('aov') || 0,
        margin_per_order: n('margin_per_order') || 0,
      };
    });
  } catch (err) {
    console.error('[sheets] getBrandAnalytics error:', err);
    return [];
  }
}

// ========================================
// HELPER: find value by key (case-insensitive)
// ========================================

// ========================================
// SCAN: Read full tab as structured data (for aggregate queries)
// ========================================

export async function scanSheet(
  sheetName: 'transition' | 'mastertab' | 'okr' | 'analytics',
  filterColumn?: string,
  filterValue?: string
): Promise<{ headers: string[]; rows: Record<string, string>[]; total: number }> {
  const sheetMap: Record<string, { id: string; tab: string }> = {
    transition: { id: SHEET_MASTERTAB_ID, tab: '2026 Transition' },
    mastertab: { id: SHEET_MASTERTAB_ID, tab: 'Supplier Mastertab' },
    okr: { id: SHEET_OKR_ID, tab: 'Brands' },
    analytics: { id: SHEET_ANALYTICS_ID, tab: 'suppliers' },
  };

  const config = sheetMap[sheetName];
  if (!config) throw new Error(`Unknown sheet: ${sheetName}`);

  const { headers, rows } = await readSheet(config.id, config.tab, 1000);

  let objects = rows.map((r) => rowToObject(headers, r));

  // Optional filter
  if (filterColumn && filterValue) {
    const col = filterColumn.toLowerCase();
    const val = filterValue.toLowerCase();
    objects = objects.filter((obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes(col) && v.toLowerCase().includes(val)) return true;
      }
      return false;
    });
  }

  return { headers, rows: objects, total: objects.length };
}

// ========================================
// HELPER: find value by key (case-insensitive)
// ========================================

function findFieldValue(obj: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase().trim() === key.toLowerCase()) {
        return v || undefined;
      }
    }
  }
  return undefined;
}

// ========================================
// WRITE: Update a cell in a sheet
// ========================================

async function updateCell(
  spreadsheetId: string,
  tabName: string,
  cell: string,
  value: string
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!${cell}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

// ========================================
// WRITE: Update a row by finding it first
// ========================================

async function updateRowField(
  spreadsheetId: string,
  tabName: string,
  lookupColumnCandidates: string[],
  lookupValue: string,
  targetColumnCandidates: string[],
  newValue: string
): Promise<{ success: boolean; cell?: string; error?: string }> {
  try {
    const { headers, rows } = await readSheet(spreadsheetId, tabName);

    const lookupColIdx = findColumn(headers, lookupColumnCandidates);
    if (lookupColIdx < 0) {
      return { success: false, error: `Lookup column not found: ${lookupColumnCandidates.join('/')}` };
    }

    const targetColIdx = findColumn(headers, targetColumnCandidates);
    if (targetColIdx < 0) {
      return { success: false, error: `Target column not found: ${targetColumnCandidates.join('/')}` };
    }

    const target = lookupValue.toLowerCase().trim();
    const rowIdx = rows.findIndex((r) => (r[lookupColIdx] || '').toLowerCase().trim() === target);
    if (rowIdx < 0) {
      return { success: false, error: `Row not found for "${lookupValue}"` };
    }

    // Convert to A1 notation (row +2 because headers are row 1 and rows are 0-indexed)
    const colLetter = String.fromCharCode(65 + targetColIdx);
    const cellRef = `${colLetter}${rowIdx + 2}`;

    await updateCell(spreadsheetId, tabName, cellRef, newValue);
    return { success: true, cell: `${tabName}!${cellRef}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ========================================
// WRITE: Update 2026 Transition tab (price list tracking)
// ========================================

export async function updateTransitionField(
  prefix: string,
  field: string,
  value: string,
  supplierName?: string
): Promise<{ success: boolean; cell?: string; error?: string }> {
  const fieldMap: Record<string, string[]> = {
    price_update_status: ['status', 'price status', 'price update', 'update status'],
    price_list_link: ['price list', 'price list link', 'link'],
    ops_stop_date: ['ops stop', 'stop date', 'paused'],
    ops_resume_date: ['ops resume', 'resume date', 'resumed'],
  };

  const targetColumns = fieldMap[field];
  if (!targetColumns) {
    return { success: false, error: `Unknown field: ${field}. Valid: ${Object.keys(fieldMap).join(', ')}` };
  }

  // Try by prefix first
  let result = await updateRowField(
    SHEET_MASTERTAB_ID, '2026 Transition',
    ['prefix', 'code', 'sku'], prefix,
    targetColumns, value
  );

  // Fallback: try by supplier name
  if (!result.success && supplierName) {
    result = await updateRowField(
      SHEET_MASTERTAB_ID, '2026 Transition',
      ['supplier', 'supplier name', 'name', 'brand'], supplierName,
      targetColumns, value
    );
  }

  return result;
}

// ========================================
// WRITE: Update Mastertab (supplier operational data)
// ========================================

export async function updateMastertabField(
  prefix: string,
  field: string,
  value: string
): Promise<{ success: boolean; cell?: string; error?: string }> {
  const fieldMap: Record<string, string[]> = {
    catalog_type: ['catalog type', 'type', 'catalog'],
    available_skus: ['available skus', 'skus', 'sku count'],
    source_language: ['language', 'source language', 'lang'],
    source_currency: ['currency', 'source currency'],
    raw_data_folder: ['folder', 'raw data folder', 'data folder'],
  };

  const targetColumns = fieldMap[field];
  if (!targetColumns) {
    return { success: false, error: `Unknown field: ${field}. Valid: ${Object.keys(fieldMap).join(', ')}` };
  }

  return updateRowField(
    SHEET_MASTERTAB_ID, 'Supplier Mastertab',
    ['prefix', 'code', 'sku', 'short', 'id'], prefix,
    targetColumns, value
  );
}
