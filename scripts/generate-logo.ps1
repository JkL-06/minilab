# MiniLab brand logo generator (pure GDI+, no external deps).
# Draws an app icon: indigo->cyan gradient rounded square + white beaker +
# light-cyan liquid + bubbles. Writes assets/icon-<size>.png (16..512).
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less files as
# ANSI; non-ASCII comments turned into mojibake that swallowed the next
# function definition (parse error).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/generate-logo.ps1

param(
  [string]$OutDir = "E:\MiniLab\assets"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function Add-RoundedRectPath {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [float]$X, [float]$Y, [float]$W, [float]$H, [float]$R
  )
  $d = 2.0 * $R
  $Path.AddArc([float]$X, [float]$Y, [float]$d, [float]$d, [float]180, [float]90)
  $Path.AddArc([float]($X + $W - $d), [float]$Y, [float]$d, [float]$d, [float]270, [float]90)
  $Path.AddArc([float]($X + $W - $d), [float]($Y + $H - $d), [float]$d, [float]$d, [float]0, [float]90)
  $Path.AddArc([float]$X, [float]($Y + $H - $d), [float]$d, [float]$d, [float]90, [float]90)
  $Path.CloseFigure()
}

# Open-top container (beaker / test tube): open top edge, vertical walls,
# rounded bottom corners.
function Add-BeakerPath {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [float]$X, [float]$Y, [float]$W, [float]$H, [float]$R
  )
  $d = 2.0 * $R
  $Path.StartFigure()
  $Path.AddLine([float]$X, [float]$Y, [float]($X + $W), [float]$Y)
  $Path.AddLine([float]($X + $W), [float]$Y, [float]($X + $W), [float]($Y + $H - $R))
  $Path.AddArc([float]($X + $W - $d), [float]($Y + $H - $d), [float]$d, [float]$d, [float]0, [float]90)
  $Path.AddLine([float]($X + $W - $R), [float]($Y + $H), [float]($X + $R), [float]($Y + $H))
  $Path.AddArc([float]$X, [float]($Y + $H - $d), [float]$d, [float]$d, [float]90, [float]90)
  $Path.AddLine([float]$X, [float]($Y + $H - $R), [float]$X, [float]$Y)
  $Path.CloseFigure()
}

function New-LogoBitmap {
  param([int]$N)
  $bmp = [System.Drawing.Bitmap]::new($N, $N, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $f = [float]$N

  # --- Background rounded square, indigo(#4F46E5) -> cyan(#06B6D4) gradient ---
  $bg = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $bgInset = 0.06 * $f
  Add-RoundedRectPath -Path $bg -X $bgInset -Y $bgInset -W ($f - 2.0 * $bgInset) -H ($f - 2.0 * $bgInset) -R (0.22 * $f)
  $bgRect = [System.Drawing.RectangleF]::new([float]$bgInset, [float]$bgInset, [float]($f - 2.0 * $bgInset), [float]($f - 2.0 * $bgInset))
  $c1 = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)
  $c2 = [System.Drawing.Color]::FromArgb(255, 6, 182, 212)
  $grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new($bgRect, $c1, $c2, [float]135)
  $g.FillPath($grad, $bg)

  # --- Beaker (white) ---
  $bk = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-BeakerPath -Path $bk -X (0.30 * $f) -Y (0.22 * $f) -W (0.40 * $f) -H (0.50 * $f) -R (0.06 * $f)
  $g.FillPath([System.Drawing.Brushes]::White, $bk)

  # --- Liquid (light cyan #38BDF8) ---
  $liq = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-BeakerPath -Path $liq -X (0.325 * $f) -Y (0.52 * $f) -W (0.35 * $f) -H (0.18 * $f) -R (0.05 * $f)
  $liquid = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
  $g.FillPath($liquid, $liq)

  # --- Liquid surface line (white) ---
  $g.FillRectangle([System.Drawing.Brushes]::White, [float](0.315 * $f), [float](0.50 * $f), [float](0.37 * $f), [float](0.016 * $f))

  # --- Bubbles (white) ---
  $g.FillEllipse([System.Drawing.Brushes]::White, [float](0.42 * $f - 0.022 * $f), [float](0.45 * $f - 0.022 * $f), [float](0.044 * $f), [float](0.044 * $f))
  $g.FillEllipse([System.Drawing.Brushes]::White, [float](0.50 * $f - 0.016 * $f), [float](0.385 * $f - 0.016 * $f), [float](0.032 * $f), [float](0.032 * $f))
  $g.FillEllipse([System.Drawing.Brushes]::White, [float](0.585 * $f - 0.018 * $f), [float](0.45 * $f - 0.018 * $f), [float](0.036 * $f), [float](0.036 * $f))

  $liquid.Dispose()
  $grad.Dispose()
  $g.Dispose()
  return $bmp
}

$sizes = 16, 24, 32, 48, 64, 128, 256, 512
foreach ($s in $sizes) {
  $bmp = New-LogoBitmap $s
  $file = Join-Path $OutDir ("icon-{0}.png" -f $s)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("wrote {0}  ({1}px)" -f $file, $s)
}
Write-Host "done"
