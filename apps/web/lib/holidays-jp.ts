// Japanese national holiday calculator.
// Covers 2020-2099. Substitute holidays (振替休日) included.

function nthMondayOf(year: number, month: number, n: number): number {
  const first = new Date(year, month - 1, 1);
  const firstDay = first.getDay();
  const firstMonday = firstDay <= 1 ? 1 + (1 - firstDay) : 1 + (8 - firstDay);
  return firstMonday + 7 * (n - 1);
}

function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function baseHolidays(year: number): Date[] {
  const h = (m: number, d: number) => new Date(year, m - 1, d);
  return [
    h(1, 1),                                    // 元日
    h(1, nthMondayOf(year, 1, 2)),               // 成人の日
    h(2, 11),                                    // 建国記念の日
    h(2, 23),                                    // 天皇誕生日
    h(3, vernalEquinox(year)),                   // 春分の日
    h(4, 29),                                    // 昭和の日
    h(5, 3),                                     // 憲法記念日
    h(5, 4),                                     // みどりの日
    h(5, 5),                                     // こどもの日
    h(7, nthMondayOf(year, 7, 3)),               // 海の日
    h(8, 11),                                    // 山の日
    h(9, nthMondayOf(year, 9, 3)),               // 敬老の日
    h(9, autumnalEquinox(year)),                 // 秋分の日
    h(10, nthMondayOf(year, 10, 2)),             // スポーツの日
    h(11, 3),                                    // 文化の日
    h(11, 23),                                   // 勤労感謝の日
  ];
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getHolidaySet(year: number): Set<string> {
  const holidays = baseHolidays(year);

  // 振替休日: if holiday falls on Sunday, next non-holiday weekday is substitute
  const set = new Set(holidays.map(toKey));
  for (const h of holidays) {
    if (h.getDay() === 0) {
      const sub = new Date(h);
      do {
        sub.setDate(sub.getDate() + 1);
      } while (set.has(toKey(sub)));
      set.add(toKey(sub));
    }
  }

  // 国民の休日: weekday sandwiched between two holidays
  const sorted = [...set].sort();
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = new Date(sorted[i]! + "T00:00:00");
    const b = new Date(sorted[i + 1]! + "T00:00:00");
    const diff = (b.getTime() - a.getTime()) / 86400000;
    if (diff === 2) {
      const mid = new Date(a);
      mid.setDate(mid.getDate() + 1);
      if (mid.getDay() !== 0) {
        set.add(toKey(mid));
      }
    }
  }

  return set;
}

export function isHoliday(dateStr: string): boolean {
  const year = Number(dateStr.slice(0, 4));
  return getHolidaySet(year).has(dateStr);
}
