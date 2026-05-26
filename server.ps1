# Simple PowerShell HTTP Server for Windows hosting Tuition Payment App
$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Server started on http://localhost:$port/"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $url = $request.RawUrl
        # Strip query strings if any
        $cleanUrl = $url.Split('?')[0]
        
        if ($cleanUrl -eq "/" -or $cleanUrl -eq "") {
            $cleanUrl = "/index.html"
        }
        
        # Clean path for Windows filesystem
        $cleanPath = $cleanUrl.Replace("/", "\")
        $filePath = Join-Path "c:\Users\UserNonthaburi01\.gemini\antigravity\scratch\tuition_payment" $cleanPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            
            # Set exact Content-Type headers
            if ($filePath.EndsWith(".html")) {
                $response.ContentType = "text/html; charset=utf-8"
            } elseif ($filePath.EndsWith(".css")) {
                $response.ContentType = "text/css; charset=utf-8"
            } elseif ($filePath.EndsWith(".js")) {
                $response.ContentType = "application/javascript; charset=utf-8"
            } elseif ($filePath.EndsWith(".png")) {
                $response.ContentType = "image/png"
            }
            
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
            $errorMsg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentLength64 = $errorMsg.Length
            $response.OutputStream.Write($errorMsg, 0, $errorMsg.Length)
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
