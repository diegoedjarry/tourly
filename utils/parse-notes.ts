export interface ParsedExpense {
  amount: number;
  description: string;
  date: string | null;
  category: string;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Travel': ['flight', 'vuelo', 'plane', 'avion', 'airline', 'aerolinea', 'airport', 'aeropuerto', 'uber', 'taxi', 'cab', 'bus', 'train', 'tren', 'gas', 'gasolina', 'toll', 'peaje', 'transport', 'transporte', 'lyft', 'rental car', 'auto'],
  'Accommodation': ['hotel', 'airbnb', 'hostel', 'room', 'habitacion', 'alojamiento', 'accommodation', 'stay', 'lodge', 'rent', 'arriendo', 'booking', 'hospedaje'],
  'Food': ['meal', 'comida', 'food', 'dinner', 'cena', 'lunch', 'almuerzo', 'breakfast', 'desayuno', 'restaurant', 'restaurante', 'coffee', 'cafe', 'snack', 'grocery', 'supermercado', 'eating'],
  'Equipment': ['racket', 'raqueta', 'string', 'cuerda', 'encordado', 'grip', 'shoes', 'zapatillas', 'shoe', 'clothes', 'ropa', 'bag', 'bolso', 'gear', 'equipment', 'equipo', 'overgrip', 'dampener'],
  'Entry Fee': ['entry', 'inscripcion', 'registration', 'registro', 'sign up', 'fee', 'entry fee', 'tournament fee'],
  'Coaching': ['coach', 'coaching', 'entrenador', 'trainer', 'training', 'entrenamiento', 'lesson', 'clase', 'academy', 'academia'],
  'Physio': ['physio', 'physiotherapy', 'kinesiolog', 'massage', 'masaje', 'doctor', 'medical', 'medico', 'therapy', 'terapia', 'health', 'salud', 'injury'],
};

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  let bestCat = 'Other';
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) && kw.length > bestScore) {
        bestScore = kw.length;
        bestCat = cat;
      }
    }
  }
  return bestCat;
}

const AMOUNT_PATTERNS = [
  /\$\s?([\d,]+\.?\d*)/,                          // $350 or $1,200.50
  /([\d,]+\.?\d*)\s*(?:usd|dollars?|dolares?)/i,  // 350 USD, 350 dollars
  /(?:usd|dollars?|dolares?)\s*([\d,]+\.?\d*)/i,  // USD 350
  /([\d,]+\.?\d*)\s*(?:clp|pesos?)/i,             // 5000 CLP
  /(?:^|[\s:=\-–—])([\d,]+\.?\d{0,2})(?:\s*$|[\s,;.])/m, // standalone number
];

const DATE_PATTERNS = [
  /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/,   // 01/15/2024, 15-01-2024, 15.01.24
  /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/,      // 2024-01-15
  /(\d{1,2})\s+(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(?:de\s+)?(\d{2,4})?/i,
];

const MONTH_MAP: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, septiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

function extractDate(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;

    if (pattern === DATE_PATTERNS[2]) {
      const day = parseInt(m[1]);
      const monthStr = m[2].toLowerCase().slice(0, 3);
      const month = MONTH_MAP[monthStr];
      if (!month || day < 1 || day > 31) continue;
      const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3])) : new Date().getFullYear();
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    if (pattern === DATE_PATTERNS[1]) {
      const y = parseInt(m[1]);
      const mo = parseInt(m[2]);
      const d = parseInt(m[3]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    if (pattern === DATE_PATTERNS[0]) {
      const a = parseInt(m[1]);
      const b = parseInt(m[2]);
      let y = m[3] ? parseInt(m[3]) : new Date().getFullYear();
      if (y < 100) y += 2000;

      if (a > 12 && b <= 12) {
        return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
      }
      if (a <= 12) {
        return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

function extractAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0 && num < 1000000) return num;
    }
  }
  return null;
}

export function parseNotes(text: string): ParsedExpense[] {
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const expenses: ParsedExpense[] = [];
  let currentDate: string | null = null;

  for (const line of lines) {
    const lineDate = extractDate(line);
    if (lineDate) currentDate = lineDate;

    const amount = extractAmount(line);
    if (amount == null) continue;

    const description = line
      .replace(/\$\s?[\d,]+\.?\d*/g, '')
      .replace(/[\d,]+\.?\d*\s*(?:usd|dollars?|dolares?|clp|pesos?)/gi, '')
      .replace(/[-–—:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    expenses.push({
      amount,
      description: description || 'Expense',
      date: lineDate ?? currentDate,
      category: detectCategory(line),
    });
  }

  return expenses;
}
