param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('prepare','init','upgrade','up','check','scenario','commands-test','business-test','lots-test','live-test','packs-live-test','backup-test','enable-production','disable-production','stop','status')]
    [string]$Action
)

# Use Ubuntu's independent engine, without changing the Windows Docker context.
$repoPath = Split-Path -Parent $PSScriptRoot
$keeperFile = Join-Path $PSScriptRoot '.local/wsl-keepalive.pid'
function Get-PilotKeeper {
    if (Test-Path -LiteralPath $keeperFile) {
        $savedPid = (Get-Content -LiteralPath $keeperFile -Raw).Trim()
        if ($savedPid -match '^\d+$') {
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
            if ($candidate.Name -eq 'wsl.exe' -and $candidate.CommandLine -match 'Ubuntu.*--exec\s+sleep\s+infinity') {
                return $candidate
            }
        }
    }
    return $null
}
if ($Action -in @('init','upgrade','up','check','scenario','commands-test','business-test','lots-test','live-test','packs-live-test','backup-test')) {
    if (-not (Get-PilotKeeper)) {
        New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot '.local') | Out-Null
        $keeper = Start-Process -FilePath wsl.exe -ArgumentList @('-d','Ubuntu','--exec','sleep','infinity') -WindowStyle Hidden -PassThru
        $keeper.Id | Set-Content -LiteralPath $keeperFile
    }
}
$linuxRepo = (& wsl -d Ubuntu --cd $repoPath -- pwd).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu WSL is unavailable' }
$cliDirectory = Join-Path $PSScriptRoot '.local/docker-cli'
New-Item -ItemType Directory -Force -Path $cliDirectory | Out-Null
& wsl -d Ubuntu --cd $repoPath -- env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "DOCKER_CONFIG=$linuxRepo/pilot/.local/docker-cli" python3 pilot/manage.py $Action
$pilotExit = $LASTEXITCODE
if ($Action -eq 'stop' -and $pilotExit -eq 0) {
    $keeper = Get-PilotKeeper
    if ($keeper) { Stop-Process -Id $keeper.ProcessId }
}
exit $pilotExit
