/**
 * Number formatting that matches Python's f"{x:.Nf}".
 *
 * JS toFixed rounds exact binary ties (2.5, 0.125, …) away from zero; Python
 * rounds them to even. Verdict sentences are compared verbatim against the Python
 * originals, so ties are detected from the exact decimal expansion and handled
 * Python's way. Non-ties are identical in both languages.
 */
export function pyFixed(x: number, digits = 0): string {
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf(".");
  const tail = exact.slice(dot + 1 + digits);
  if (!/^50*$/.test(tail)) return x.toFixed(digits);

  // Exact tie: keep the truncated digits and round only if the last kept digit is odd.
  const kept = exact.slice(0, dot + 1 + digits).replace(/\.$/, "");
  const lastDigit = Number(kept.replace(".", "").at(-1));
  const truncated = Number(kept);
  const step = 10 ** -digits;
  const abs = lastDigit % 2 === 0 ? truncated : truncated + step;
  const sign = x < 0 && abs !== 0 ? "-" : "";
  return sign + abs.toFixed(digits);
}

/** Pace in decimal minutes → "m:ss" (5.25 → "5:15"), carrying 60s into the minute. */
export function mmss(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  let m = Math.trunc(minutes);
  let s = Math.round((minutes - m) * 60);
  if (s === 60) [m, s] = [m + 1, 0];
  return `${m}:${String(s).padStart(2, "0")}`;
}
