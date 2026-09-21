# deploy/restart-dsh-web.ps1 -- restart the dsh web host (so profile / plugin / preset changes take effect).
#
# Why a separate process: this script kills the dsh web process that currently hosts the session,
# so it must be detached from that process tree to survive to the end.
#
# Usage (delayed + detached, so the caller can still receive a reply):
#   Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<this script>','-DelaySeconds','25' -WindowStyle Hidden
# Foreground also works: it delays, kills, restarts, then polls the health endpoint; everything is logged.
# Defaults come from $env:DSH_CHECKOUT / $env:DSH_HOME (falling back to ~/Desktop/ds/deepseek-harness and ~/.dsh),
# so this file carries no machine-specific path and can ship with the project.
# NOTE: keep this file ASCII-only -- Windows PowerShell 5.1 reads BOM-less files as ANSI and mangles non-ASCII.
param(
  [int]$DelaySeconds = 25,
  [string]$Checkout = $(if ($env:DSH_CHECKOUT) { $env:DSH_CHECKOUT } else { Join-Path $env:USERPROFILE 'Desktop\ds\deepseek-harness' }),
  [int]$Port = 3080,
  [string]$LogDir = $(if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'logs' } else { Join-Path $env:USERPROFILE '.dsh\logs' })
)
$ErrorActionPreference = 'Continue'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $LogDir "vore-restart-$ts.log"
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }

function L($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  $line | Tee-Object -FilePath $log -Append | Out-Null
  Write-Host $line
}

L "restart plan: dsh web on port $Port, checkout=$Checkout, delay=${DelaySeconds}s"
L "log: $log"
if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }

# 1) Pre-flight: the profile manifest must be valid JSON or the new instance will fail to boot.
$pkg = Join-Path $dshHome 'profiles\web\package.json'
try {
  $j = Get-Content $pkg -Raw -Encoding UTF8 | ConvertFrom-Json
  $bundles = @($j.dsh.profile.bundles)
  L "preflight ok: package.json parses, bundles=$($bundles.Count) [$($bundles -join ', ')]"
} catch {
  L "preflight FAILED: $($_.Exception.Message) -- aborting restart, fix the manifest first"
  exit 2
}

# 2) Stop the old instance(s).
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$oldPids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
if ($oldPids.Count -eq 0) { L "warning: nothing listening on port $Port" }
foreach ($procId in $oldPids) {
  try {
    $pr = Get-Process -Id $procId -ErrorAction Stop
    $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).ParentProcessId
    L "stopping old instance PID $procId ($($pr.ProcessName))"
    Stop-Process -Id $procId -Force -ErrorAction Stop
    if ($parent) {
      $pp = Get-Process -Id $parent -ErrorAction SilentlyContinue
      if ($pp -and $pp.ProcessName -eq 'cmd') { Stop-Process -Id $parent -Force -ErrorAction SilentlyContinue; L "  also stopped parent cmd PID $parent" }
    }
  } catch { L "  failed to stop PID ${procId}: $($_.Exception.Message)" }
}
Start-Sleep -Seconds 3

# 3) Start the new instance (same launch shape as before: source entry via tsx).
$started = $false
for ($i = 1; $i -le 2 -and -not $started; $i++) {
  L "attempt $i/2: node --import tsx/esm apps/cli/src/bin.ts web (cwd=$Checkout)"
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Checkout -WindowStyle Hidden -ArgumentList '/c', "node --import tsx/esm apps/cli/src/bin.ts web >> `"$log`" 2>&1"
  for ($s = 0; $s -lt 30; $s++) {
    Start-Sleep -Seconds 2
    $waited = ($s + 1) * 2
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { $started = $true; L "health check ok: HTTP $($r.StatusCode) after ${waited}s"; break }
    } catch { }
  }
  if (-not $started) { L "  attempt $i did not become ready within 60s" }
}

# 4) Summary.
if ($started) {
  $newPids = @((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) | Select-Object -ExpandProperty OwningProcess -Unique)
  L "new listener PID(s): $($newPids -join ', ')"
  L "RESULT: SUCCESS -- dsh web restarted; refresh http://127.0.0.1:$Port"
} else {
  L "RESULT: FAILED -- both attempts failed; run manually in $Checkout : node --import tsx/esm apps/cli/src/bin.ts web"
}
L "log end: $log"
