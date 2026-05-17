Add-Type -AssemblyName System.Drawing

function New-MhIcon([int]$size, [string]$out) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded square background with gradient (orange -> magenta)
    $r = [single]($size * 0.22)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $p.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $p.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $p.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure()

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 255, 140, 60),
        [System.Drawing.Color]::FromArgb(255, 220, 40, 110),
        45
    )
    $g.FillPath($brush, $p)

    # Folder shape (white)
    $folderW = [single]($size * 0.62)
    $folderH = [single]($size * 0.42)
    $fx = [single](($size - $folderW) / 2)
    $fy = [single]($size * 0.40)
    $tabW = [single]($folderW * 0.35)
    $tabH = [single]($size * 0.07)

    $folderPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $folderPath.AddLine($fx, $fy, $fx + $tabW, $fy)
    $folderPath.AddLine($fx + $tabW, $fy, $fx + $tabW + $tabH, $fy - $tabH)
    $folderPath.AddLine($fx + $tabW + $tabH, $fy - $tabH, $fx + $folderW, $fy - $tabH)
    $folderPath.AddLine($fx + $folderW, $fy - $tabH, $fx + $folderW, $fy + $folderH)
    $folderPath.AddLine($fx + $folderW, $fy + $folderH, $fx, $fy + $folderH)
    $folderPath.CloseFigure()
    $g.FillPath([System.Drawing.Brushes]::White, $folderPath)

    # Download arrow inside folder
    $penW = [single]([Math]::Max(2, $size * 0.07))
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 220, 40, 110), $penW)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $cx = [single]($size / 2)
    $aTop = [single]($size * 0.50)
    $aBot = [single]($size * 0.76)
    $aw = [single]($size * 0.12)
    $g.DrawLine($pen, $cx, $aTop, $cx, $aBot)
    $g.DrawLine($pen, $cx - $aw, $aBot - $aw, $cx, $aBot)
    $g.DrawLine($pen, $cx + $aw, $aBot - $aw, $cx, $aBot)

    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Wrote $out"
}

$dir = Join-Path $PSScriptRoot "icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
foreach ($s in 16, 32, 48, 128) {
    New-MhIcon $s (Join-Path $dir "icon-$s.png")
}
