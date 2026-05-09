param(
    [string]$VsixPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($VsixPath)) {
    $VsixPath = Join-Path $PSScriptRoot "dreamshaderlang-language-support-1.3.2.vsix"
}

if (-not (Test-Path -LiteralPath $VsixPath)) {
    throw "VSIX package not found: $VsixPath"
}

$codeCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"),
    (Join-Path $env:ProgramFiles "Microsoft VS Code\bin\code.cmd"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft VS Code\bin\code.cmd"),
    "code"
) | Where-Object { $_ -and $_.Trim().Length -gt 0 }

$codeCommand = $null
foreach ($candidate in $codeCandidates) {
    if ($candidate -eq "code") {
        $resolved = Get-Command code -ErrorAction SilentlyContinue
        if ($resolved) {
            $codeCommand = $resolved.Source
            break
        }
        continue
    }

    if (Test-Path -LiteralPath $candidate) {
        $codeCommand = $candidate
        break
    }
}

if (-not $codeCommand) {
    throw "Could not find the VSCode 'code' command. Open VSCode and install from VSIX manually."
}

if ([System.IO.Path]::GetFileName($codeCommand) -ieq "Code.exe") {
    $binCandidate = Join-Path (Split-Path -Parent $codeCommand) "bin\code.cmd"
    if (Test-Path -LiteralPath $binCandidate) {
        $codeCommand = $binCandidate
    }
}

& $codeCommand --install-extension $VsixPath --force
if ($LASTEXITCODE -ne 0) {
    throw "VSCode extension install failed with exit code $LASTEXITCODE."
}
