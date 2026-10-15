import { describe, expect, it } from "vitest";
import { helperCommand, isShell } from "../src/main/endOutside.js";

describe("helperCommand", () => {
  it("runs the end-session script without a profile, non-interactively, with the line to type", () => {
    const [command, args] = helperCommand("C:/res/scripts/end-session.ps1", 4242, "/exit");
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
      "-Line",
      "/exit",
    ]);
  });
});

describe("isShell", () => {
  it("recognises the shells whose window closes on exit, whatever the case", () => {
    expect(isShell("pwsh.exe")).toBe(true);
    expect(isShell("PowerShell.exe")).toBe(true);
    expect(isShell("bash.exe")).toBe(true);
    expect(isShell("WindowsTerminal.exe")).toBe(false);
    expect(isShell("Code.exe")).toBe(false);
    expect(isShell(null)).toBe(false);
  });
});
