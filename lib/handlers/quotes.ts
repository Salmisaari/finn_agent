// lib/handlers/quotes.ts
// Finn — Systematic quote generation for customer emails
// Builds structured quotes from deal parameters and market context

// ========================================
// QUOTE DATA MODEL
// ========================================

export interface QuoteLineItem {
  product: string;           // e.g. "Blue nitrile examination gloves, 4g"
  specs?: string;            // e.g. "EN 455, 37% formaldehyde tested"
  brand?: string;            // e.g. "Intco Medical (OEM)"
  quantity: string;          // e.g. "10,000 boxes" or "1 container (40ft)"
  unit_price: string;        // e.g. "3.60"
  currency: string;          // EUR, USD, SEK
  unit: string;              // e.g. "box (100 pcs)", "carton", "pair"
  moq?: string;              // minimum order quantity if applicable
}

export interface PaymentTerms {
  structure: string;         // e.g. "30/70" or "net30" or "100_prepay"
  prepay_pct?: number;       // e.g. 30
  on_delivery_pct?: number;  // e.g. 70
  net_days?: number;         // e.g. 30
  notes?: string;            // e.g. "Supplier requires prepayment for production run"
}

export interface DeliveryTerms {
  timeline: string;          // e.g. "2-3 weeks from order confirmation"
  incoterms?: string;        // e.g. "DDP", "EXW", "CIF"
  warehouse?: string;        // e.g. "EU warehouse (Netherlands)", "Direct from Malaysia"
  shipping_notes?: string;   // e.g. "Freight included in unit price"
}

export interface MarketContext {
  situation: string;         // Brief market summary for the customer
  price_justification: string; // Why this price is fair/competitive
  urgency_driver?: string;   // Why act now
  recovery_timeline?: string; // Expected price normalization
}

export interface QuoteRequest {
  // Customer
  customer_name: string;
  contact_name?: string;
  contact_email?: string;
  customer_context?: string; // What they need it for (e.g. "reserve stock for municipality contracts")
  customer_country?: string; // ISO code or name — used to auto-detect language (FI→fi, DE→de, SE→sv)

  // Products
  line_items: QuoteLineItem[];

  // Terms
  payment: PaymentTerms;
  delivery: DeliveryTerms;

  // Market framing
  market_context?: MarketContext;

  // Quote metadata
  validity_days?: number;    // Default 7
  language?: string;         // en, fi, de, sv — default en
  notes?: string;            // Additional notes or conditions
  cc_internal?: string[];    // Internal CC (johannes@droppe.fi etc.)
  sender_name?: string;      // Override signature name (default: "Finn"). Use team member name when they send from own email.
  sender_title?: string;     // Override signature title
  sender_email?: string;     // Override signature email
}

export interface GeneratedQuote {
  subject: string;
  body: string;
  summary: string;           // Short summary for Slack preview
  line_item_total: string;   // Calculated total if quantity is numeric
}

// ========================================
// LANGUAGE INFERENCE
// ========================================

const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  // ISO codes
  FI: 'fi', SE: 'sv', DE: 'de', AT: 'de', CH: 'de',
  // Full names (Pipedrive data can have either)
  Finland: 'fi', Sweden: 'sv', Germany: 'de', Austria: 'de', Switzerland: 'de',
  Deutschland: 'de', Österreich: 'de', Schweiz: 'de',
  Suomi: 'fi', Sverige: 'sv',
};

/** Resolve quote language: explicit language > country inference > default en */
export function resolveLanguage(language?: string, country?: string): string {
  if (language) return language;
  if (country) {
    const mapped = COUNTRY_TO_LANGUAGE[country] || COUNTRY_TO_LANGUAGE[country.toUpperCase()];
    if (mapped) return mapped;
  }
  return 'en';
}

// ========================================
// QUOTE BUILDER
// ========================================

/**
 * Generate a quote email that reads like a real person wrote it.
 *
 * Design principles:
 * - Minimal: no filler words, no labeled sections ("Payment terms:", "Delivery:")
 * - Data-led: price, quantity, timeline pop out immediately
 * - Natural: reads like a message from someone who knows the customer
 * - Trust-building: market context woven in as insight, not a sales pitch
 * - Scannable: one idea per paragraph, key numbers easy to find
 */
export function generateQuote(req: QuoteRequest): GeneratedQuote {
  const lang = resolveLanguage(req.language, req.customer_country);
  const validity = req.validity_days || 7;
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validity);
  const validUntilStr = formatDate(validUntil, lang);

  const voice = getVoice(lang);

  // Subject: short, scannable
  const mainProduct = req.line_items[0];
  const productShort = mainProduct.product.split(',')[0]; // First part only
  const subject = `${req.customer_name} — ${productShort} ${mainProduct.currency} ${mainProduct.unit_price}/${voice.boxShort}`;

  const lines: string[] = [];

  // 1. Greeting — one word
  lines.push(req.contact_name ? `${voice.hi} ${req.contact_name},` : `${voice.hi},`);
  lines.push('');

  // 2. Opening — what I secured for you (emotional: I took action for you)
  if (req.customer_context) {
    lines.push(voice.secured(req, mainProduct));
  } else {
    lines.push(voice.securedGeneric(req, mainProduct));
  }
  lines.push('');

  // 3. Product block — tight, no labels, just the facts
  for (const item of req.line_items) {
    // Price line — THE most important line, must pop
    lines.push(`${item.currency} ${item.unit_price}/${voice.box} — ${item.product}`);
    lines.push(`${item.quantity}`);
    if (item.specs) lines.push(item.specs);
    if (req.line_items.length > 1) lines.push(''); // space between items
  }
  lines.push('');

  // 4. Terms — one line each, scannable
  if (req.payment.prepay_pct && req.payment.on_delivery_pct) {
    lines.push(`${voice.payment}: ${req.payment.prepay_pct}% ${voice.advance}, ${req.payment.on_delivery_pct}% ${voice.onDelivery}`);
  } else if (req.payment.net_days) {
    lines.push(`${voice.payment}: net ${req.payment.net_days} ${voice.days}`);
  } else {
    lines.push(`${voice.payment}: ${req.payment.structure}`);
  }
  lines.push(`${voice.delivery}: ${req.delivery.timeline}${req.delivery.incoterms ? ` ${req.delivery.incoterms}` : ''}${req.delivery.warehouse ? ` (${req.delivery.warehouse})` : ''}`);
  lines.push(`${voice.validUntil} ${validUntilStr}`);
  lines.push('');

  // 5. Market context — woven as insight, not a pitch (rational + trust)
  if (req.market_context) {
    lines.push(voice.marketInsight(req.market_context));
    lines.push('');
  }

  // 6. Notes — only if genuinely needed
  if (req.notes) {
    lines.push(req.notes);
    lines.push('');
  }

  // 7. Close — one line, action-oriented
  lines.push(voice.close);
  lines.push('');

  // 8. Signature — minimal
  const sigName = req.sender_name || 'Finn';
  lines.push(sigName);

  const body = lines.join('\n');

  // Slack summary — tight
  const summary = [
    `*${req.customer_name}* — ${mainProduct.currency} ${mainProduct.unit_price}/${voice.boxShort}`,
    mainProduct.product,
    `${req.payment.structure} | ${req.delivery.timeline} | ${validUntilStr}`,
  ].join('\n');

  return {
    subject,
    body,
    summary,
    line_item_total: '',
  };
}

// ========================================
// DATE FORMATTING
// ========================================

function formatDate(date: Date, lang: string): string {
  const d = date.getDate();
  const m = date.getMonth();
  const y = date.getFullYear();
  const dayNames: Record<string, string[]> = {
    fi: ['su','ma','ti','ke','to','pe','la'],
    sv: ['sön','mån','tis','ons','tor','fre','lör'],
    de: ['So','Mo','Di','Mi','Do','Fr','Sa'],
    en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  };
  const monthNames: Record<string, string[]> = {
    fi: ['tammi','helmi','maalis','huhti','touko','kesä','heinä','elo','syys','loka','marras','joulu'],
    sv: ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'],
    de: ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],
    en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  };
  const day = (dayNames[lang] || dayNames.en)[date.getDay()];
  const month = (monthNames[lang] || monthNames.en)[m];
  return `${day} ${d}.${m + 1}.${y}`;
}

// ========================================
// VOICE — conversational, not template-y
// ========================================

interface Voice {
  hi: string;
  box: string;
  boxShort: string;
  payment: string;
  advance: string;
  onDelivery: string;
  days: string;
  delivery: string;
  validUntil: string;
  close: string;
  secured: (req: QuoteRequest, item: QuoteLineItem) => string;
  securedGeneric: (req: QuoteRequest, item: QuoteLineItem) => string;
  marketInsight: (ctx: MarketContext) => string;
}

function getVoice(lang: string): Voice {
  switch (lang) {
    case 'fi':
      return {
        hi: 'Hei',
        box: 'ltk',
        boxShort: 'ltk',
        payment: 'Maksu',
        advance: 'ennakko',
        onDelivery: 'toimituksessa',
        days: 'pv',
        delivery: 'Toimitus',
        validUntil: 'Tarjous voimassa:',
        close: 'Vahvista niin laitetaan liikkeelle.',
        secured: (req, item) =>
          `Voin vahvistaa saatavuuden tuotteelle ${item.product.split(',')[0].toLowerCase()}` +
          (req.customer_context ? ` — ${req.customer_context}.` : '.'),
        securedGeneric: (req, item) =>
          `Ohessa tarjouksemme tuotteesta ${item.product.split(',')[0].toLowerCase()}.`,
        marketInsight: (ctx) => {
          let s = ctx.situation;
          if (ctx.price_justification) s += ` ${ctx.price_justification}`;
          if (ctx.recovery_timeline) s += ` Arvio normalisoitumisesta: ${ctx.recovery_timeline}.`;
          return s;
        },
      };
    case 'de':
      return {
        hi: 'Hallo',
        box: 'Box',
        boxShort: 'Box',
        payment: 'Zahlung',
        advance: 'Vorauskasse',
        onDelivery: 'bei Lieferung',
        days: 'Tage',
        delivery: 'Lieferung',
        validUntil: 'Angebot gültig bis:',
        close: 'Bestätigen Sie Ihr Interesse, dann starten wir sofort.',
        secured: (req, item) =>
          `Ich kann die Verfügbarkeit von ${item.product.split(',')[0]} bestätigen` +
          (req.customer_context ? ` — ${req.customer_context}.` : '.'),
        securedGeneric: (req, item) =>
          `Anbei unser Angebot für ${item.product.split(',')[0]}.`,
        marketInsight: (ctx) => {
          let s = ctx.situation;
          if (ctx.price_justification) s += ` ${ctx.price_justification}`;
          if (ctx.recovery_timeline) s += ` Erwartete Normalisierung: ${ctx.recovery_timeline}.`;
          return s;
        },
      };
    case 'sv':
      return {
        hi: 'Hej',
        box: 'frp',
        boxShort: 'frp',
        payment: 'Betalning',
        advance: 'förskott',
        onDelivery: 'vid leverans',
        days: 'dagar',
        delivery: 'Leverans',
        validUntil: 'Offert giltig till:',
        close: 'Bekräfta ert intresse så kör vi igång.',
        secured: (req, item) =>
          `Jag kan bekräfta tillgängligheten av ${item.product.split(',')[0].toLowerCase()}` +
          (req.customer_context ? ` — ${req.customer_context}.` : '.'),
        securedGeneric: (req, item) =>
          `Här kommer vår offert för ${item.product.split(',')[0].toLowerCase()}.`,
        marketInsight: (ctx) => {
          let s = ctx.situation;
          if (ctx.price_justification) s += ` ${ctx.price_justification}`;
          if (ctx.recovery_timeline) s += ` Förväntad normalisering: ${ctx.recovery_timeline}.`;
          return s;
        },
      };
    default: // en
      return {
        hi: 'Hi',
        box: 'box',
        boxShort: 'box',
        payment: 'Payment',
        advance: 'advance',
        onDelivery: 'on delivery',
        days: 'days',
        delivery: 'Delivery',
        validUntil: 'Valid until:',
        close: 'Confirm your interest and we\'ll get it moving.',
        secured: (req, item) =>
          `I can confirm availability of ${item.product.split(',')[0].toLowerCase()}` +
          (req.customer_context ? ` — ${req.customer_context}.` : '.'),
        securedGeneric: (req, item) =>
          `Here\'s our offer for ${item.product.split(',')[0].toLowerCase()}.`,
        marketInsight: (ctx) => {
          let s = ctx.situation;
          if (ctx.price_justification) s += ` ${ctx.price_justification}`;
          if (ctx.recovery_timeline) s += ` Expected normalization: ${ctx.recovery_timeline}.`;
          return s;
        },
      };
  }
}
