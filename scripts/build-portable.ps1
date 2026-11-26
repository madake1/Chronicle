param([string]$Ref = 'HEAD')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$nodeVersion = '24.22.3'
$runtimeName = "node-v$nodeVersion-win-x64"
$runtimeSha = 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'
$dist = Join-Path $repo 'dist'
$commit = git -C $repo rev-parse --verify "$Ref^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Source ref is not a commit.' }
$short = $commit.Substring(0, 12)
$buildId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$stage = Join-Path $dist "build-$short-$buildId"
$package = Join-Path $stage 'Chronicle'
$app = Join-Path $package 'app'
$runtime = Join-Path $package 'runtime'
New-Item -ItemType Directory -Path $app,$runtime -Force | Out-Null

# Archive an explicit allowlist from Git. Local changes, data and secrets are excluded.
$sourceZip = Join-Path $stage 'source.zip'
$entries = @('package.json','package-lock.json','server.mjs','runtime-config.mjs','portable-launch.mjs',
  'atomic-write.mjs','note-files.mjs','note-storage.mjs','knowledge.mjs','atlas-sources.mjs',
  'atlas-place-index.mjs','atlas-event-catalog.mjs','fixtures.json','public','portable','README.md',
  'docs/DATA_SOURCES.md','docs/HANDOFF.md')
git -C $repo archive --format=zip --output=$sourceZip $commit -- $entries
if ($LASTEXITCODE -ne 0) { throw 'Unable to archive the source commit.' }
Expand-Archive -LiteralPath $sourceZip -DestinationPath $app
foreach ($name in 'Start-Chronicle.bat','Stop-Chronicle.bat') {
  Move-Item -LiteralPath (Join-Path $app "portable/$name") -Destination $package
}
Move-Item -LiteralPath (Join-Path $app 'README.md') -Destination $package
Move-Item -LiteralPath (Join-Path $app 'docs') -Destination $package

$runtimeZip = Join-Path $stage "$runtimeName.zip"
$download = "https://nodejs.org/dist/v$nodeVersion/$runtimeName.zip"
curl.exe --fail --location --silent --show-error --retry 2 --output $runtimeZip $download
if ($LASTEXITCODE -ne 0) { throw 'Unable to download the official Node.js distribution.' }
if ((Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash -ne $runtimeSha) {
  throw 'Official Node.js SHA256 digest does not match.'
}
tar.exe -xf $runtimeZip -C $stage "$runtimeName/node.exe" "$runtimeName/LICENSE"
if ($LASTEXITCODE -ne 0) { throw 'Unable to unpack the verified runtime.' }
foreach ($name in 'node.exe','LICENSE') {
  Move-Item -LiteralPath (Join-Path $stage "$runtimeName/$name") -Destination $runtime
}

Push-Location $app
try {
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Production dependencies could not be installed from the lockfile.' }
} finally { Pop-Location }

@{ commit = $commit; platform = 'win-x64'; node = $nodeVersion; runtimeSha256 = $runtimeSha } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $package 'version.json') -Encoding utf8
$zip = Join-Path $stage "Chronicle-$short-win-x64.zip"
Compress-Archive -LiteralPath $package -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path -Leaf $zip)" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
Write-Output "Package: $zip"
Write-Output "Folder: $package"
