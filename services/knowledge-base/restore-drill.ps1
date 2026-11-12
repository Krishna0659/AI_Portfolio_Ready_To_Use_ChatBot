$ErrorActionPreference = 'Stop'
function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Docker command failed' }
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [guid]::NewGuid().ToString('N').Substring(0,12)
$backup = Join-Path $repo ".local/kb-backup-$suffix"
New-Item -ItemType Directory -Path $backup | Out-Null
$config = (docker inspect portfolioai-kb-knowledge-base-1 | ConvertFrom-Json)[0]
$chromaConfig = (docker inspect portfolioai-kb-chroma-1 | ConvertFrom-Json)[0]
$credentials = @($config.Config.Env | Where-Object { $_.StartsWith('KB_API_KEY=') -or $_.StartsWith('KB_CALLER_GRANTS=') })
try {
    Invoke-Docker stop portfolioai-kb-knowledge-base-1 portfolioai-kb-chroma-1
    Invoke-Docker cp -a 'portfolioai-kb-knowledge-base-1:/data' (Join-Path $backup 'kb')
    Invoke-Docker cp -a 'portfolioai-kb-chroma-1:/data' (Join-Path $backup 'chroma')
} finally {
    Invoke-Docker start portfolioai-kb-chroma-1 portfolioai-kb-knowledge-base-1
}
$network = "kb-restore-$suffix"
$chroma = "$network-chroma"
$kb = "$network-api"
Invoke-Docker network create --internal $network
Invoke-Docker create --name $chroma --network $network --network-alias chroma $chromaConfig.Image
$envArgs = @()
foreach ($entry in $credentials) { $envArgs += @('-e', $entry) }
Invoke-Docker create --name $kb --network $network @envArgs -e CHROMA_HOST=chroma -e KB_DATA_DIR=/data $config.Image
Invoke-Docker cp -a (Join-Path $backup 'chroma/.') "${chroma}:/data"
Invoke-Docker cp -a (Join-Path $backup 'kb/.') "${kb}:/data"
Invoke-Docker cp (Join-Path $PSScriptRoot 'restore_check.py') "${kb}:/tmp/restore_check.py"
try {
    Invoke-Docker start $chroma $kb
    $passed = $false
    for ($attempt=0; $attempt -lt 12; $attempt++) {
        $result = & docker exec $kb python /tmp/restore_check.py 2>&1
        if ($LASTEXITCODE -eq 0) { $passed=$true; $result; break }
        Start-Sleep -Seconds 5
    }
    if (-not $passed) { $result; throw 'Restore acceptance failed' }
    Write-Output "Backup retained locally at $backup"
} finally {
    Invoke-Docker stop $kb $chroma
}
