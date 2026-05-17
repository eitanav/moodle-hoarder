Add-Type -AssemblyName System.Drawing

# Resizes a source PNG to multiple icon sizes for the Chrome extension.
# Drop a high-res master image at icons/icon-source.png and run this script.

$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'icons'
$src = Join-Path $dir 'icon-source.png'

if (-not (Test-Path $src)) {
    throw "Source icon not found at $src. Place a square high-res PNG there first."
}

function Resize-Icon([string]$source, [int]$size, [string]$out) {
    $img = [System.Drawing.Image]::FromFile($source)
    try {
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.DrawImage($img, 0, 0, $size, $size)
            $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Host "Wrote $out ($size x $size)"
        }
        finally { $g.Dispose() }
        $bmp.Dispose()
    }
    finally { $img.Dispose() }
}

foreach ($s in 16, 32, 48, 128) {
    Resize-Icon $src $s (Join-Path $dir "icon-$s.png")
}
