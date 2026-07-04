const ITF3_TO_ISO2: Record<string, string> = {
  'ROU':'RO','ESP':'ES','FRA':'FR','GER':'DE','ITA':'IT','GBR':'GB','USA':'US',
  'ARG':'AR','BRA':'BR','AUS':'AU','SUI':'CH','BEL':'BE','NED':'NL','POL':'PL',
  'CZE':'CZ','POR':'PT','SWE':'SE','AUT':'AT','GRE':'GR','HUN':'HU','BUL':'BG',
  'CRO':'HR','SRB':'RS','RUS':'RU','UKR':'UA','KAZ':'KZ','JPN':'JP','CHN':'CN',
  'KOR':'KR','IND':'IN','CHI':'CL','COL':'CO','PER':'PE','MEX':'MX','CAN':'CA',
  'RSA':'ZA','EGY':'EG','MAR':'MA','TUN':'TN','SVK':'SK','SLO':'SI','TUR':'TR',
  'ISR':'IL','THA':'TH','MAS':'MY','INA':'ID','PHI':'PH','UZB':'UZ','NGR':'NG',
};

// Maps full country names (as stored in ITF/Supabase) → 2-letter ISO code
const NAME_TO_ISO2: Record<string, string> = {
  'albania':'AL','armenia':'AM','australia':'AU','austria':'AT','azerbaijan':'AZ',
  'belarus':'BY','belgium':'BE','bolivia':'BO','bosnia and herzegovina':'BA','brazil':'BR',
  'bulgaria':'BG','canada':'CA','chile':'CL','china, p.r.':'CN','china':'CN','chinese taipei':'TW',
  'colombia':'CO','costa rica':'CR','croatia':'HR','cyprus':'CY','czech republic':'CZ',
  'czechia':'CZ','denmark':'DK','dominican republic':'DO','ecuador':'EC','egypt':'EG',
  'estonia':'EE','finland':'FI','france':'FR','georgia':'GE','germany':'DE',
  'great britain':'GB','united kingdom':'GB','greece':'GR','guatemala':'GT','honduras':'HN',
  'hungary':'HU','india':'IN','indonesia':'ID','iran, i.r.':'IR','ireland':'IE',
  'israel':'IL','italy':'IT','japan':'JP','jordan':'JO','kazakhstan':'KZ','kenya':'KE',
  'korea, rep.':'KR','south korea':'KR','latvia':'LV','lebanon':'LB','lithuania':'LT',
  'luxembourg':'LU','malaysia':'MY','malta':'MT','mexico':'MX','moldova':'MD',
  'republic of moldova':'MD','montenegro':'ME','morocco':'MA','netherlands':'NL',
  'new zealand':'NZ','nigeria':'NG','north macedonia':'MK','norway':'NO','pakistan':'PK',
  'panama':'PA','paraguay':'PY','peru':'PE','philippines':'PH','poland':'PL',
  'portugal':'PT','romania':'RO','russia':'RU','saudi arabia':'SA','serbia':'RS',
  'singapore':'SG','slovak republic':'SK','slovakia':'SK','slovenia':'SI',
  'south africa':'ZA','spain':'ES','sweden':'SE','switzerland':'CH','taiwan':'TW',
  'thailand':'TH','tunisia':'TN','turkey':'TR','turkiye':'TR','ukraine':'UA',
  'united arab emirates':'AE','usa':'US','united states':'US','uruguay':'UY',
  'uzbekistan':'UZ','venezuela':'VE','vietnam':'VN','zimbabwe':'ZW',
};

function toEmoji(iso2: string): string {
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/** Resolve any country string (full name, 2-letter ISO, 3-letter ITF) → 2-letter ISO code, or null. */
export function nameToIso2(country: string): string | null {
  const raw = (country ?? '').trim();
  if (!raw) return null;
  if (raw.length === 2) return raw.toUpperCase();
  const iso2from3 = ITF3_TO_ISO2[raw.toUpperCase()];
  if (iso2from3) return iso2from3;
  return NAME_TO_ISO2[raw.toLowerCase()] ?? null;
}

export function countryFlag(country: string): string {
  const raw = (country ?? '').trim();
  if (!raw) return '';

  // 2-letter ISO code
  if (raw.length === 2) return toEmoji(raw);

  // 3-letter ITF code
  const iso2from3 = ITF3_TO_ISO2[raw.toUpperCase()];
  if (iso2from3) return toEmoji(iso2from3);

  // Full country name
  const iso2fromName = NAME_TO_ISO2[raw.toLowerCase()];
  if (iso2fromName) return toEmoji(iso2fromName);

  return '';
}
