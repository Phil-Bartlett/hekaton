# Type a line into the console of another process, the way its user would.
# Used to send /exit to a Claude Code session running outside Hekaton (a
# hard kill leaves that terminal in raw mode and skips Claude's shutdown),
# then `exit` to the shell that launched it, so its tab or window closes.
# Prints the target's parent as JSON, since that is gone once the target exits.
#
# usage: powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File end-session.ps1 -TargetPid <pid> [-Line "/exit"]
param(
    [Parameter(Mandatory = $true)][int]$TargetPid,
    [string]$Line = "/exit"
)

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$TargetPid"
$parent = if ($process) { Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" } else { $null }

Add-Type -Namespace Hekaton -Name Console -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct KeyEvent {
  public ushort EventType; public ushort Pad;
  public int KeyDown; public ushort RepeatCount; public ushort VirtualKeyCode; public ushort VirtualScanCode; public char Char; public uint ControlKeyState;
}
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool WriteConsoleInputW(IntPtr handle, KeyEvent[] events, uint count, out uint written);
'@

[Hekaton.Console]::FreeConsole() | Out-Null
if (-not [Hekaton.Console]::AttachConsole([uint32]$TargetPid)) {
    throw "AttachConsole($TargetPid) failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
# Ctrl events raised in that console must not stop this helper mid-way.
[Hekaton.Console]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null

$GENERIC_READ_WRITE = [uint32]3221225472  # GENERIC_READ | GENERIC_WRITE; the hex literal would parse as a negative Int32
$FILE_SHARE_READ_WRITE = 3
$OPEN_EXISTING = 3
$conin = [Hekaton.Console]::CreateFile("CONIN$", $GENERIC_READ_WRITE, $FILE_SHARE_READ_WRITE, [IntPtr]::Zero, $OPEN_EXISTING, 0, [IntPtr]::Zero)
if ($conin -eq [IntPtr]::Zero -or $conin -eq [IntPtr]::new(-1)) {
    throw "CONIN$ open failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

function Key([char]$c, [uint16]$vk, [bool]$down) {
    $e = New-Object Hekaton.Console+KeyEvent
    $e.EventType = 1
    $e.KeyDown = [int]$down
    $e.RepeatCount = 1
    $e.VirtualKeyCode = $vk
    $e.Char = $c
    return $e
}

$events = New-Object System.Collections.Generic.List[Hekaton.Console+KeyEvent]
foreach ($c in $Line.ToCharArray()) {
    $vk = [uint16]([int][char]::ToUpperInvariant($c))
    $events.Add((Key $c $vk $true))
    $events.Add((Key $c $vk $false))
}
$events.Add((Key ([char]13) 0x0D $true))
$events.Add((Key ([char]13) 0x0D $false))
$written = [uint32]0
if (-not [Hekaton.Console]::WriteConsoleInputW($conin, $events.ToArray(), [uint32]$events.Count, [ref]$written)) {
    throw "WriteConsoleInput failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

@{ parentPid = $(if ($parent) { [int]$parent.ProcessId } else { $null }); parentName = $(if ($parent) { $parent.Name } else { $null }) } | ConvertTo-Json -Compress
