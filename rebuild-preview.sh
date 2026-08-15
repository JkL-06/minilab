#!/usr/bin/env bash
# 从 index.html 重建 preview.html（内容保持同步）。
set -euo pipefail
cd "$(dirname "$0")"
{
  echo '<title>MiniLab · 下载与安装</title>'
  sed -n '/<style>/,/<\/style>/p' index.html
  sed -n '/<body>/,/<\/body>/p' index.html | grep -v '^<body>$' | grep -v '^</body>$'
} > preview.html
echo "preview.html regenerated ($(wc -l < preview.html) lines)"
