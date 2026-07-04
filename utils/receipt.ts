// Client for the parse-receipt edge function (Zero-Click Expense Engine).
//
// parseReceipt() never throws for parse-level problems — it always resolves to
// a ParseReceiptResult. `ok: false` means "open the manual entry form
// pre-filled with whatever we could read", never a crash.

import { supabase } from '@/lib/supabase';

export type ReceiptCategory =
  | 'Flight'
  | 'Hotel/Housing'
  | 'Food'
  | 'Stringing'
  | 'Coach'
  | 'Entry Fee'
  | 'Other';

export interface ParsedReceipt {
  amount: number;
  currency: string;          // ISO 4217, as charged — never converted
  date: string | null;       // YYYY-MM-DD or null (caller defaults to today)
  merchant: string;
  category: ReceiptCategory;
  confidence: 'high' | 'medium' | 'low';
}

export type ParseReceiptResult =
  | { ok: true; receipt: ParsedReceipt }
  | { ok: false; reason: string; partial: Partial<ParsedReceipt> };

// Receipt buckets → the app's stored expense categories.
export const RECEIPT_TO_APP_CATEGORY: Record<ReceiptCategory, string> = {
  'Flight': 'Flights',
  'Hotel/Housing': 'Hotels',
  'Food': 'Food',
  'Stringing': 'Stringing',
  'Coach': 'Coach Fee',
  'Entry Fee': 'Entry Fee',
  'Other': 'Other',
};

export type ReceiptMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export async function parseReceipt(
  base64: string,
  mediaType: ReceiptMediaType,
): Promise<ParseReceiptResult> {
  try {
    const { data, error } = await supabase.functions.invoke('parse-receipt', {
      body: { image_base64: base64, media_type: mediaType },
    });

    if (error) {
      console.warn('[receipt] edge function error', error);
      return { ok: false, reason: 'Could not reach the receipt reader', partial: {} };
    }

    if (data?.success && data.receipt) {
      return { ok: true, receipt: data.receipt as ParsedReceipt };
    }

    return {
      ok: false,
      reason: data?.reason ?? 'Could not read the receipt',
      partial: (data?.partial ?? {}) as Partial<ParsedReceipt>,
    };
  } catch (err) {
    console.warn('[receipt] parse failed', err);
    return { ok: false, reason: 'Could not read the receipt', partial: {} };
  }
}
