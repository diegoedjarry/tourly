import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? '';
const GITHUB_REPO  = Deno.env.get('GITHUB_REPO') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Human-name shape only: letters (any script), spaces, dots, apostrophes, hyphens.
const NAME_RE = /^[\p{L}][\p{L} .'-]{1,39}$/u;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // Supabase DB webhooks POST JSON: { type, table, record, old_record }
  let body: any;
  try { body = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

  const playerName: string | null =
    body?.record?.atp_player_name ?? body?.new?.atp_player_name ?? null;

  if (!playerName) {
    return new Response(JSON.stringify({ skipped: 'no atp_player_name' }), { status: 200 });
  }
  if (typeof playerName !== 'string' || !NAME_RE.test(playerName)) {
    return new Response('invalid player name', { status: 400 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Anti-abuse: this endpoint is invoked by a DB webhook without a JWT, so it
  // must not act on arbitrary input. Only dispatch a scrape for a player that
  // an actual Tourly profile is tracking.
  const { data: match } = await sb
    .from('profiles')
    .select('id')
    .ilike('atp_player_name', playerName)
    .limit(1)
    .maybeSingle();
  if (!match) {
    return new Response(JSON.stringify({ skipped: 'unknown player' }), { status: 200 });
  }

  // Rate limit: at most one workflow dispatch per 15 minutes, tracked in scraper_runs.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recent } = await sb
    .from('scraper_runs')
    .select('id')
    .eq('phase', 'dispatch')
    .gte('started_at', since)
    .limit(1);
  if (recent && recent.length > 0) {
    return new Response(JSON.stringify({ skipped: 'rate limited' }), { status: 429 });
  }
  const nowIso = new Date().toISOString();
  await sb.from('scraper_runs').insert({
    phase: 'dispatch', status: 'ok', rows_found: 0, rows_upserted: 0,
    started_at: nowIso, finished_at: nowIso, error: `dispatch:${playerName}`,
  });

  // Trigger GitHub Actions workflow_dispatch
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/weekly-scraper.yml/dispatches`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { player_name: playerName } }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return new Response(JSON.stringify({ error: err }), { status: 500 });
  }

  return new Response(JSON.stringify({ triggered: playerName }), { status: 200 });
});
