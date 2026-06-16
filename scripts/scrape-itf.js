import { init } from '@instantdb/admin';

const APP_ID = process.env.INSTANTDB_APP_ID;
const ADMIN_TOKEN = process.env.INSTANTDB_ADMIN_TOKEN;

const ITF_URL = 'https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar?circuitCode=MT&searchString=&skip=0&take=500&nationCodes=&zoneCodes=&dateFrom=2026-01-01&dateTo=2026-12-31&indoorOutdoor=&categories=&isOrderAscending=true&orderField=startDate&surfaceCodes=&singlesDrawFormat=';

async function main() {
  const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
  console.log('Fetching ITF calendar...');
  const res = await fetch(ITF_URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.slice(0, 500));
}

main().catch(console.error);