// F-060 希望開催日の表示ヘルパ（純関数・テスト対象）。
//
// desiredDates は 'YYYY-MM-DD' のフラット配列（§3.4.1-(4)）。UI は連続日を帯チップに
// グルーピングして表示する（例: ['2026-07-07','2026-07-08'] → "7/7~8"）。
// すべて local-time 計算で、toISOString() を使わない（TZ ずれ防止）。

const DOW = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 'YYYY-MM-DD' を local Date に（never toISOString）。
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function dowOf(dateStr: string): number {
  return parseLocalDate(dateStr).getDay();
}

export interface DateBand {
  // 帯を構成する日付（昇順・連続）。
  dates: string[];
  // 表示ラベル（例 "7/7~8" / 単日は "7/7"）。
  label: string;
  // 帯の代表曜日（先頭日の曜日。土日色分け用）。
  startDow: number;
}

function md(dateStr: string): { m: number; d: number } {
  const dt = parseLocalDate(dateStr);
  return { m: dt.getMonth() + 1, d: dt.getDate() };
}

// 連続する日付（カレンダー上で隣接）を 1 帯にまとめる。入力順不問・重複は無視。
export function groupConsecutiveDates(dates: string[]): DateBand[] {
  const sorted = Array.from(new Set(dates)).sort();
  const bands: DateBand[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const f = md(first);
    const l = md(last);
    const label =
      run.length === 1
        ? `${f.m}/${f.d}`
        : f.m === l.m
          ? `${f.m}/${f.d}~${l.d}`
          : `${f.m}/${f.d}~${l.m}/${l.d}`;
    bands.push({ dates: [...run], label, startDow: dowOf(first) });
    run = [];
  };

  for (const ds of sorted) {
    if (run.length === 0) {
      run.push(ds);
      continue;
    }
    const prev = parseLocalDate(run[run.length - 1]!);
    const cur = parseLocalDate(ds);
    const adjacent = cur.getTime() - prev.getTime() === 86_400_000;
    if (adjacent) {
      run.push(ds);
    } else {
      flush();
      run.push(ds);
    }
  }
  flush();
  return bands;
}

// 帯の色分け（先頭日の曜日基準。土=青 / 日=赤 / 平日=ニュートラル）。
export function bandColor(startDow: number): string {
  if (startDow === 0) return "bg-red-50 text-red-700 border-red-200";
  if (startDow === 6) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-surface-soft text-ink border-hairline-light";
}

export function dowLabel(startDow: number): string {
  return DOW[startDow] ?? "";
}
