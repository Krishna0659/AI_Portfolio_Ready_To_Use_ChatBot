$ErrorActionPreference = 'Stop'
function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Docker crash drill command failed' }
}
Invoke-Docker cp (Join-Path $PSScriptRoot 'crash_check.py') 'portfolioai-kb-knowledge-base-1:/app/crash_check.py'
try {
    Invoke-Docker exec portfolioai-kb-knowledge-base-1 python /app/crash_check.py interrupt
    Invoke-Docker kill --signal KILL portfolioai-kb-knowledge-base-1
} finally {
    Invoke-Docker restart portfolioai-kb-knowledge-base-1
}
Start-Sleep -Seconds 3
Invoke-Docker exec portfolioai-kb-knowledge-base-1 python /app/crash_check.py verify
