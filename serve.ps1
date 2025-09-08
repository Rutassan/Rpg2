param(
  [int]$Port = 8080,
  [string]$Root = "rpg2d"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ContentType([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8'; break }
    '.css'  { 'text/css; charset=utf-8'; break }
    '.js'   { 'application/javascript; charset=utf-8'; break }
    '.json' { 'application/json; charset=utf-8'; break }
    '.svg'  { 'image/svg+xml'; break }
    '.png'  { 'image/png'; break }
    '.jpg'  { 'image/jpeg'; break }
    '.ico'  { 'image/x-icon'; break }
    default { 'application/octet-stream' }
  }
}

if (-not (Test-Path $Root)) { throw "Root not found: $Root" }
$absRoot = (Resolve-Path $Root).Path
Write-Host "Serving $absRoot on http://localhost:$Port" -ForegroundColor Green

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://*:$Port/")
$listener.Start()

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    Start-Job -ScriptBlock {
      param($ctx, $absRoot)
      try {
        $req = $ctx.Request
        $res = $ctx.Response
        $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
        if ($path -eq '/') { $path = '/index.html' }
        $fsPath = Join-Path $absRoot ($path.TrimStart('/'))
        if (-not (Test-Path $fsPath)) {
          $res.StatusCode = 404
          $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          $res.OutputStream.Close()
          return
        }
        $bytes = [IO.File]::ReadAllBytes($fsPath)
        $res.StatusCode = 200
        $res.ContentType = (Get-ContentType -path $fsPath)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
      } catch {
        try { $ctx.Response.StatusCode = 500; $bytes = [Text.Encoding]::UTF8.GetBytes("500 Internal Server Error"); $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length); $ctx.Response.OutputStream.Close() } catch {}
      }
    } -ArgumentList $ctx, $absRoot | Out-Null
  }
} finally {
  $listener.Stop()
  $listener.Close()
}

