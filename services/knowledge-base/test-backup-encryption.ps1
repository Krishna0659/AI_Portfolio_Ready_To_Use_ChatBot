$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$folder = Join-Path $repo ('.local/encryption-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
$source = Join-Path $folder 'source.bin'
$encrypted = Join-Path $folder 'archive.kbenc'
$key = Join-Path $folder 'recovery.key'
$decoded = Join-Path $folder 'decoded.bin'
[IO.File]::WriteAllBytes($source, [Security.Cryptography.RandomNumberGenerator]::GetBytes(4096))
& "$PSScriptRoot/Protect-Backup.ps1" -Mode Encrypt -InputPath $source -OutputPath $encrypted -KeyPath $key
& "$PSScriptRoot/Protect-Backup.ps1" -Mode Decrypt -InputPath $encrypted -OutputPath $decoded -KeyPath $key
if ((Get-FileHash $source).Hash -ne (Get-FileHash $decoded).Hash) { throw 'Round trip mismatch' }
$tampered = Join-Path $folder 'tampered.kbenc'
$bytes = [IO.File]::ReadAllBytes($encrypted)
$bytes[40] = $bytes[40] -bxor 1
[IO.File]::WriteAllBytes($tampered, $bytes)
$badOutput = Join-Path $folder 'must-not-exist.bin'
$rejected = $false
try { & "$PSScriptRoot/Protect-Backup.ps1" -Mode Decrypt -InputPath $tampered -OutputPath $badOutput -KeyPath $key }
catch { $rejected = $true }
if (-not $rejected -or (Test-Path $badOutput)) { throw 'Tamper rejection failed' }
$wrongKey = Join-Path $folder 'wrong.key'
[IO.File]::WriteAllBytes($wrongKey, [Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$rejected = $false
try { & "$PSScriptRoot/Protect-Backup.ps1" -Mode Decrypt -InputPath $encrypted -OutputPath $badOutput -KeyPath $wrongKey }
catch { $rejected = $true }
if (-not $rejected -or (Test-Path $badOutput)) { throw 'Wrong-key rejection failed' }
Write-Output 'PASS: AES-256-GCM round trip, tampering rejected, wrong key rejected, no unauthenticated output'
