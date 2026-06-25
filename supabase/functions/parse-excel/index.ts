import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

const MAX_BASE64_LENGTH = 10_000_000; // ~7.5MB file

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { base64, fileName } = await req.json();
    if (!base64) {
      return new Response(JSON.stringify({ error: 'No file data provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (base64.length > MAX_BASE64_LENGTH) {
      return new Response(JSON.stringify({ error: 'File too large (max ~7.5MB)' }), {
        status: 413, headers: { 'Content-Type': 'application/json' },
      });
    }

    const workbook = XLSX.read(base64, { type: 'base64' });
    if (!workbook.SheetNames.length) {
      return new Response(JSON.stringify({ error: 'No sheets found in workbook' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    const filtered = rows.filter((r: string[]) => r.some((cell: string) => String(cell).trim() !== ''));

    return new Response(JSON.stringify({ rows: filtered }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[parse-excel]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
