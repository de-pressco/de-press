import { describe, expect, it } from "vitest";

import { DEFAULT_NAV_ORDER, visibleNavKeys } from "./navOrder";

describe("visibleNavKeys", () => {
  it("hides the Helper tab from a plain account", () => {
    expect(visibleNavKeys(false)).not.toContain("helper");
  });

  it("shows the whole order to a Helper (staff are Helpers by invariant)", () => {
    expect(visibleNavKeys(true)).toEqual(DEFAULT_NAV_ORDER);
  });

  it("always exposes More, and Therapy is not on the rail — Therapy lives in the Help pane now", () => {
    for (const canHelper of [false, true]) {
      const keys = visibleNavKeys(canHelper);
      expect(keys).toContain("more");
      expect(keys).not.toContain("therapy");
    }
  });
});