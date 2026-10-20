import { describe, expect, it } from "vitest";
import { canCheck, initialState, isNewer, nextState, releaseUrl, updateMode } from "../src/main/updateState.js";

describe("updateMode", () => {
  it("installs where the app can replace itself", () => {
    expect(updateMode({ platform: "win32", appImage: false, packaged: true })).toBe("install");
    expect(updateMode({ platform: "linux", appImage: true, packaged: true })).toBe("install");
  });

  it("only links from a deb or a Mac", () => {
    expect(updateMode({ platform: "linux", appImage: false, packaged: true })).toBe("link");
    expect(updateMode({ platform: "darwin", appImage: false, packaged: true })).toBe("link");
  });

  it("is off in development", () => {
    expect(updateMode({ platform: "win32", appImage: false, packaged: false })).toBe("off");
  });
});

describe("isNewer", () => {
  it("compares each part as a number", () => {
    expect(isNewer("v0.3.1", "0.3.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });

  it("is false for the same or an older version", () => {
    expect(isNewer("v0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
  });
});

describe("nextState", () => {
  const install = initialState({ mode: "install", current: "0.3.0" });
  const link = initialState({ mode: "link", current: "0.3.0" });
  const found = { type: "available", version: "0.3.1", url: releaseUrl("0.3.1"), at: 5 };

  it("downloads a found release where it can install", () => {
    const state = nextState(nextState(install, { type: "checking" }), found);
    expect(state).toMatchObject({ status: "downloading", version: "0.3.1", progress: 0, checkedAt: 5 });
    expect(state.url).toBe("https://github.com/Phil-Bartlett/hekaton/releases/tag/v0.3.1");
    expect(nextState(state, { type: "progress", percent: 41.7 }).progress).toBe(41);
    expect(nextState(state, { type: "ready", version: "0.3.1" })).toMatchObject({ status: "ready", progress: 100 });
  });

  it("only reports a found release where it links", () => {
    expect(nextState(link, found).status).toBe("available");
  });

  it("holds a downloaded update whatever comes after", () => {
    const ready = nextState(nextState(install, found), { type: "ready", version: "0.3.1" });
    expect(nextState(ready, { type: "checking" })).toBe(ready);
    expect(nextState(ready, { type: "error", message: "offline" })).toBe(ready);
  });

  it("clears an error on the next check", () => {
    const failed = nextState(install, { type: "error", message: "offline" });
    expect(failed).toMatchObject({ status: "error", error: "offline" });
    expect(nextState(failed, { type: "checking" }).error).toBeNull();
  });

  it("records an up-to-date check", () => {
    expect(nextState(install, { type: "current", at: 9 })).toMatchObject({ status: "current", checkedAt: 9 });
  });
});

describe("canCheck", () => {
  it("does not overlap a check, a download or a waiting update", () => {
    const idle = initialState({ mode: "install", current: "0.3.0" });
    expect(canCheck(idle)).toBe(true);
    expect(canCheck({ ...idle, status: "error" })).toBe(true);
    for (const status of ["checking", "downloading", "ready"]) expect(canCheck({ ...idle, status })).toBe(false);
    expect(canCheck(initialState({ mode: "off", current: "0.3.0" }))).toBe(false);
  });
});
