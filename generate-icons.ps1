Add-Type -AssemblyName System.Drawing

# Resizes a source PNG to multiple icon sizes for the Chrome extension.
# Auto-detects content bounding box (skips transparent + near-pure-black padding)
# so the rounded-square logo fills each tiny PNG instead of being lost in padding.

$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'icons'
$src = Join-Path $dir 'icon-source.png'

if (-not (Test-Path $src)) {
    throw "Source icon not found at $src. Place a square high-res PNG there first."
}

function Get-ContentBounds([System.Drawing.Bitmap]$bmp) {
    $w = $bmp.Width
    $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $data = $bmp.LockBits($rect,
        [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $stride = $data.Stride
        $bytes = New-Object byte[] ($stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    }
    finally { $bmp.UnlockBits($data) }

    $isContent = {
        param($i)
        $b = $bytes[$i]; $g = $bytes[$i + 1]; $r = $bytes[$i + 2]; $a = $bytes[$i + 3]
        return ($a -gt 10) -and (($r + $g + $b) -gt 60)
    }

    # Top
    $top = -1
    for ($y = 0; $y -lt $h -and $top -lt 0; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            if (& $isContent ($y * $stride + $x * 4)) { $top = $y; break }
        }
    }
    # Bottom
    $bottom = -1
    for ($y = $h - 1; $y -ge 0 -and $bottom -lt 0; $y--) {
        for ($x = 0; $x -lt $w; $x++) {
            if (& $isContent ($y * $stride + $x * 4)) { $bottom = $y; break }
        }
    }
    # Left
    $left = -1
    for ($x = 0; $x -lt $w -and $left -lt 0; $x++) {
        for ($y = 0; $y -lt $h; $y++) {
            if (& $isContent ($y * $stride + $x * 4)) { $left = $x; break }
        }
    }
    # Right
    $right = -1
    for ($x = $w - 1; $x -ge 0 -and $right -lt 0; $x--) {
        for ($y = 0; $y -lt $h; $y++) {
            if (& $isContent ($y * $stride + $x * 4)) { $right = $x; break }
        }
    }

    if ($top -lt 0) { return $null }
    return @{ X = $left; Y = $top; W = ($right - $left + 1); H = ($bottom - $top + 1) }
}

function Resize-Icon([System.Drawing.Bitmap]$srcBmp, [int]$size, [string]$out) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($srcBmp, 0, 0, $size, $size)
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host "Wrote $out ($size x $size)"
    }
    finally { $g.Dispose(); $bmp.Dispose() }
}

$img = [System.Drawing.Image]::FromFile($src)
try {
    $original = New-Object System.Drawing.Bitmap($img)
}
finally { $img.Dispose() }

try {
    Write-Host "Detecting content bounds (skipping transparent + near-black padding)..."
    $bounds = Get-ContentBounds $original
    if ($null -eq $bounds) {
        Write-Warning "No content detected; using full image."
        $cropped = $original.Clone()
    } else {
        # Make square by extending the smaller dimension symmetrically around centre
        $maxDim = [Math]::Max($bounds.W, $bounds.H)
        # Add a 2% breathing-room margin
        $margin = [int]($maxDim * 0.02)
        $boxSize = $maxDim + 2 * $margin
        $cx = $bounds.X + [int]($bounds.W / 2)
        $cy = $bounds.Y + [int]($bounds.H / 2)
        $sx = [Math]::Max(0, $cx - [int]($boxSize / 2))
        $sy = [Math]::Max(0, $cy - [int]($boxSize / 2))
        if ($sx + $boxSize -gt $original.Width)  { $sx = $original.Width  - $boxSize }
        if ($sy + $boxSize -gt $original.Height) { $sy = $original.Height - $boxSize }
        if ($sx -lt 0) { $sx = 0 }
        if ($sy -lt 0) { $sy = 0 }
        $cropRect = New-Object System.Drawing.Rectangle($sx, $sy, [Math]::Min($boxSize, $original.Width - $sx), [Math]::Min($boxSize, $original.Height - $sy))
        Write-Host ("Content bounds: x={0} y={1} {2}x{3} -> cropping to {4}x{5} at ({6},{7})" -f `
            $bounds.X, $bounds.Y, $bounds.W, $bounds.H, $cropRect.Width, $cropRect.Height, $cropRect.X, $cropRect.Y)
        $cropped = $original.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    }

    foreach ($s in 16, 32, 48, 128) {
        Resize-Icon $cropped $s (Join-Path $dir "icon-$s.png")
    }
}
finally {
    if ($cropped -and ($cropped -ne $original)) { $cropped.Dispose() }
    $original.Dispose()
}
