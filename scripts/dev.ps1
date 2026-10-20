# Start the StreetMend API and web app in two new PowerShell windows.
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
$root = Split-Path -Parent $PSScriptRoot

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\services\api'; uv sync; uv run uvicorn streetmend.api.main:app --port 8000"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\apps\web'; if (-not (Test-Path node_modules)) { npm install }; npm run dev"

Write-Host "API:  http://127.0.0.1:8000/api/health"
Write-Host "Web:  http://localhost:5173  (give it a few seconds)"
