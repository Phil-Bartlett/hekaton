import { describe, expect, it } from "vitest";
import { helperCommand } from "../src/main/endOutside.js";

describe("helperCommand", () => {
  it("runs the end-session script without a profile, non-interactively, for the pid", () => {
    const [command, args] = helperCommand("C:/res/scripts/end-session.ps1", 4242);
    expect(command).toBe("powershell");
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:/res/scripts/end-session.ps1",
      "-TargetPid",
      "4242",
    ]);
  });
});
