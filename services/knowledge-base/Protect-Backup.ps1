param(
    [Parameter(Mandatory)][ValidateSet('Encrypt','Decrypt')][string]$Mode,
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$KeyPath
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputPath) { throw 'Output already exists; refusing overwrite' }
$inputFile = Get-Item -LiteralPath $InputPath
if ($inputFile.Length -gt 512MB) { throw 'This local utility supports archives up to 512 MiB' }
$header = [Text.Encoding]::ASCII.GetBytes('PKBAES01')
$inputBytes = [IO.File]::ReadAllBytes($inputFile.FullName)
if ($Mode -eq 'Encrypt') {
    if (Test-Path -LiteralPath $KeyPath) { throw 'Use a fresh key path for each backup' }
    $key = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $nonce = [Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
    $tag = [byte[]]::new(16)
    $cipher = [byte[]]::new($inputBytes.Length)
    $aes = [Security.Cryptography.AesGcm]::new($key, 16)
    try { $aes.Encrypt($nonce, $inputBytes, $cipher, $tag, $header) } finally { $aes.Dispose() }
    $keyStream = [IO.File]::Open($KeyPath, [IO.FileMode]::CreateNew)
    try { $keyStream.Write($key) } finally { $keyStream.Dispose() }
    $result = $header + $nonce + $tag + $cipher
} else {
    if ($inputBytes.Length -lt 36) { throw 'Invalid encrypted archive' }
    if ([Text.Encoding]::ASCII.GetString($inputBytes, 0, 8) -ne 'PKBAES01') { throw 'Unknown backup format' }
    $key = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $KeyPath).Path)
    if ($key.Length -ne 32) { throw 'Invalid recovery key' }
    $nonce = [byte[]]$inputBytes[8..19]
    $tag = [byte[]]$inputBytes[20..35]
    $cipher = [byte[]]::new($inputBytes.Length - 36)
    [Array]::Copy($inputBytes, 36, $cipher, 0, $cipher.Length)
    $result = [byte[]]::new($cipher.Length)
    $aes = [Security.Cryptography.AesGcm]::new($key, 16)
    try { $aes.Decrypt($nonce, $cipher, $tag, $result, $header) } finally { $aes.Dispose() }
}
$outputStream = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew)
try { $outputStream.Write([byte[]]$result) } finally { $outputStream.Dispose() }
Write-Output "$Mode complete: $OutputPath"
