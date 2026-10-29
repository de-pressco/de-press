import { describe, expect, it } from "vitest";
import {
  isMoreSectionPath,
  isPhoneNestedChromePath,
  isSplitIndexPath,
  modeFromWidth,
} from "./viewport";

describe("modeFromWidth", () => {
  it("phone at 390 and 759", () => {
    expect(modeFromWidth(390)).toBe("phone");
    expect(modeFromWidth(759)).toBe("phone");
  });
  it("tablet at 760 and 1099", () => {
    expect(modeFromWidth(760)).toBe("tablet");
    expect(modeFromWidth(1099)).toBe("tablet");
  });
  it("desktop at 1100", () => {
    expect(modeFromWidth(1100)).toBe("desktop");
  });
});

describe("isSplitIndexPath", () => {
  it("treats feed and chat indexes as list", () => {
    expect(isSplitIndexPath("/feed")).toBe(true);
    expect(isSplitIndexPath("/chat")).toBe(true);
    expect(isSplitIndexPath("/feed/mine")).toBe(true);
  });
  it("treats nested feed/chat as detail", () => {
    expect(isSplitIndexPath("/feed/abc")).toBe(false);
    expect(isSplitIndexPath("/feed/new")).toBe(false);
    expect(isSplitIndexPath("/chat/42")).toBe(false);
  });
  it("ignores other routes", () => {
    expect(isSplitIndexPath("/notifications")).toBe(false);
    expect(isSplitIndexPath("/more")).toBe(false);
  });
});

describe("isPhoneNestedChromePath", () => {
  it("is true for nested feed and chat", () => {
    expect(isPhoneNestedChromePath("/feed/abc")).toBe(true);
    expect(isPhoneNestedChromePath("/feed/new")).toBe(true);
    expect(isPhoneNestedChromePath("/chat/42")).toBe(true);
  });
  it("is false for indexes and other panes", () => {
    expect(isPhoneNestedChromePath("/feed")).toBe(false);
    expect(isPhoneNestedChromePath("/feed/mine")).toBe(false);
    expect(isPhoneNestedChromePath("/chat")).toBe(false);
    expect(isPhoneNestedChromePath("/more")).toBe(false);
    expect(isPhoneNestedChromePath("/notifications")).toBe(false);
  });
});

describe("isMoreSectionPath", () => {
  it("lights More for overflow panes", () => {
    expect(isMoreSectionPath("/more")).toBe(true);
    expect(isMoreSectionPath("/settings")).toBe(true);
    expect(isMoreSectionPath("/help")).toBe(true);
    expect(isMoreSectionPath("/patterns")).toBe(true);
    expect(isMoreSectionPath("/helper")).toBe(true);
    expect(isMoreSectionPath("/inbox")).toBe(true);
  });
  it("does not steal primary tabs", () => {
    expect(isMoreSectionPath("/feed")).toBe(false);
    expect(isMoreSectionPath("/chat")).toBe(false);
    expect(isMoreSectionPath("/notifications")).toBe(false);
  });
});
