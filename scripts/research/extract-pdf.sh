#!/usr/bin/env bash
# Raw dump of a PDF for research notes (RS-0).
#   extract-pdf.sh PAPER.pdf OUT_DIR            text: OUT/full.txt and OUT/pages/pNNN.txt
#   extract-pdf.sh PAPER.pdf OUT_DIR 12-15,40   also renders those pages to OUT/png/pNNN.png (110 dpi)
#   extract-pdf.sh PAPER.pdf OUT_DIR all        renders every page
# Needs pdftotext/pdftoppm (poppler, /opt/homebrew/bin). OUT_DIR holds third-party content: keep it local.
set -euo pipefail
PATH="/opt/homebrew/bin:$PATH"
pdf="$1"; out="$2"; render="${3:-}"; dpi="${DPI:-110}"
mkdir -p "$out/pages"
n=$(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')
pdftotext -layout "$pdf" "$out/full.txt"
for ((p = 1; p <= n; p++)); do
  pdftotext -layout -f "$p" -l "$p" "$pdf" "$out/pages/$(printf 'p%03d' "$p").txt"
done
render_range() { # $1 first $2 last
  mkdir -p "$out/png"
  pdftoppm -r "$dpi" -png -f "$1" -l "$2" "$pdf" "$out/png/tmp"
  for f in "$out"/png/tmp-*.png; do
    [ -e "$f" ] || continue
    k=$(basename "$f" .png); k=${k##*-}; mv "$f" "$out/png/$(printf 'p%03d' "$((10#$k))").png"
  done
}
if [ "$render" = "all" ]; then
  render_range 1 "$n"
elif [ -n "$render" ]; then
  IFS=',' read -ra parts <<< "$render"
  for part in "${parts[@]}"; do
    if [[ "$part" == *-* ]]; then render_range "${part%-*}" "${part#*-}"; else render_range "$part" "$part"; fi
  done
fi
echo "$(basename "$pdf"): $n pages -> $out"
