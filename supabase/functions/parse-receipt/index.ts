// parse-receipt — Zero-Click Expense Engine.
//
// Accepts a receipt image (jpeg/png/webp) or PDF as base64, extracts a strict
// expense payload with Claude Haiku vision, and returns it for one-tap logging.
//
// Contract (always HTTP 200 unless auth/config fails):
//   success:  { success: true,  receipt: { amount, currency, date, merchant, category, confidence } }
//   fallback: { success: false, fallback: true, reason: string, partial?: Partial<Receipt> }
// The client opens a pre-filled manual entry screen on any fallback — never a crash.
//
// Schema is enforced via forced tool-use (tool_choice), not prompt-and-parse:
// the API validates the JSON shape before we ever see it.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const RECEIPT_CATEGORIES = [
  'Flight',
  'Hotel/Housing',
  'Food',
  'Stringing',
  'Coach',
  'Entry Fee',
  'Other',
] as const;

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// ~6MB of base64 ≈ 4.5MB file — plenty for a phone receipt photo.
const MAX_BASE64_LENGTH = 8_000_000;

const RECEIPT_TOOL = {
  name: 'record_receipt',
  description: 'Record the fields extracted from a purchase receipt.',
  input_schema: {
    type: 'object' as const,
    properties: {
      amount: {
        type: 'number',
        description: 'Grand total actually paid, as a decimal. The final charged amount including tax/tip, not a subtotal.',
      },
      currency: {
        type: 'string',
        pattern: '^[A-Z]{3}$',
        description: 'ISO 4217 code of the currency AS WRITTEN on the receipt (e.g. TND, EUR, ARS). Never convert. If only a symbol is shown, infer from merchant country context.',
      },
      date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Transaction date in YYYY-MM-DD. Empty string if not readable.',
      },
      merchant: {
        type: 'string',
        description: 'Merchant/vendor name as printed. Empty string if not readable.',
      },
      category: {
        type: 'string',
        enum: [...RECEIPT_CATEGORIES],
        description: 'Best-fit expense bucket. Airlines/airports → Flight. Hotels, Airbnb, hostels → Hotel/Housing. Restaurants, groceries, cafes → Food. Racquet stringing/grips → Stringing. Coaching invoices → Coach. Tournament entry/sign-up fees → Entry Fee. Anything else → Other.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'low if the image is blurry/partial or key fields were guessed.',
      },
      is_receipt: {
        type: 'boolean',
        description: 'false if the document is clearly not a purchase receipt/invoice.',
      },
    },
    required: ['amount', 'currency', 'category', 'is_receipt', 'confidence'],
  },
};

function getServiceRoleKey(): string | undefined {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const key = parsed.default ?? Object.values(parsed)[0];
      if (key) return key as string;
    } catch {}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fallback(reason: string, partial?: Record<string, unknown>): Response {
  // 200 on purpose: a parse failure is an expected outcome, not a server error.
  return json({ success: false, fallback: true, reason, ...(partial ? { partial } : {}) });
}

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = getServiceRoleKey();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      console.error('[parse-receipt] Missing required environment variables');
      return json({ error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const imageBase64: string | undefined = body?.image_base64;
    const mediaType: string | undefined = body?.media_type;

    if (!imageBase64 || !mediaType) return fallback('No image provided');
    if (!ALLOWED_MEDIA.includes(mediaType)) return fallback(`Unsupported file type: ${mediaType}`);
    if (imageBase64.length > MAX_BASE64_LENGTH) return fallback('Image too large — try a closer, cropped photo');

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const docBlock = mediaType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: imageBase64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: imageBase64 } };

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      tools: [RECEIPT_TOOL],
      tool_choice: { type: 'tool', name: 'record_receipt' },
      messages: [{
        role: 'user',
        content: [
          docBlock,
          {
            type: 'text',
            text: 'Extract this receipt for a professional tennis player\'s expense tracker. Capture the currency exactly as charged on the receipt — do NOT convert to USD or any other currency.',
          },
        ],
      }],
    });

    const toolUse = response.content.find((b: any) => b.type === 'tool_use') as any;
    if (!toolUse?.input) return fallback('Could not read the receipt');

    const r = toolUse.input;

    if (r.is_receipt === false) {
      return fallback('This doesn\'t look like a receipt', {
        merchant: typeof r.merchant === 'string' ? r.merchant : undefined,
      });
    }

    // Server-side validation — never trust model output shape beyond the API's
    // schema check. Anything unusable degrades to the pre-filled fallback.
    const amount = typeof r.amount === 'number' && isFinite(r.amount) ? Math.abs(r.amount) : NaN;
    const currency = typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null;
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const merchant = typeof r.merchant === 'string' ? r.merchant.slice(0, 120) : '';
    const category = RECEIPT_CATEGORIES.includes(r.category) ? r.category : 'Other';
    const confidence = ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low';

    if (!amount || amount <= 0 || !currency) {
      return fallback('Couldn\'t read the total amount', {
        merchant: merchant || undefined,
        date: date ?? undefined,
        category,
      });
    }

    return json({
      success: true,
      receipt: {
        amount: Math.round(amount * 100) / 100,
        currency,
        date,       // null when unreadable — client defaults to today
        merchant,
        category,   // one of RECEIPT_CATEGORIES — client maps to app categories
        confidence,
      },
    });
  } catch (err: any) {
    console.error('[parse-receipt]', err);
    // Even hard failures route to the manual-entry fallback client-side.
    return fallback('Something went wrong reading the receipt');
  }
});
