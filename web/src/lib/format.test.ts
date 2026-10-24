import { describe, expect, it } from "vitest";

import { mmss, pyFixed } from "./format";

describe("pyFixed matches Python's f'{x:.Nf}'", () => {
  it.each([
    // exact binary ties round half to even (JS toFixed would round up)
    [2.5, 0, "2"],
    [3.5, 0, "4"],
    [0.5, 0, "0"],
    [-2.5, 0, "-2"],
    [1.125, 2, "1.12"],
    [1.375, 2, "1.38"],
    [0.25, 1, "0.2"],
    // not exact ties in binary: same as toFixed
    [1.005, 2, "1.00"],
    [2.675, 2, "2.67"],
    [1.15, 1, "1.1"],
    // ordinary values
    [1.2345, 2, "1.23"],
    [47, 0, "47"],
    [0, 1, "0.0"],
  ])("pyFixed(%d, %d) = %s", (x, digits, want) => {
    expect(pyFixed(x, digits)).toBe(want);
  });
});

describe("mmss", () => {
  it.each([
    [5.25, "5:15"],
    [5.0, "5:00"],
    [5.995, "6:00"], // 59.7s rounds to 60 → carries into the minute
    [null, "—"],
  ])("mmss(%s) = %s", (x, want) => {
    expect(mmss(x)).toBe(want);
  });
});
