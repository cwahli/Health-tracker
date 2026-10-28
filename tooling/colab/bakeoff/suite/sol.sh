#!/bin/bash
# sol.sh REPO N : apply a known-good solution (used only to validate check scripts)
cd "$1"
case $2 in
1) sed -i "s/rgba(255, 255, 255, 0.65)/rgba(255, 255, 255, 0.72)/" components/mtd-pricing/fallback.css;;
2) python3 - <<'PY'
import re
p='components/mtd-pricing/fallback.css'
s=open(p).read()
i=s.index('.button--secondary:hover')
j=s.index('.button-tertiary {')
s=s[:i]+s[j:]
open(p,'w').write(s)
PY
;;
3) mkdir -p tooling/lib
cat > tooling/lib/args.js <<'JS'
'use strict';
const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
module.exports = { argv, has, val };
JS
for f in add-pair bot-dispatch check-contrast; do
python3 - $f <<'PY'
import sys,re
p='tooling/%s.js'%sys.argv[1]
s=open(p).read()
s=re.sub(r"const argv = process\.argv\.slice\(2\);\nconst has = [^\n]*\nconst val = [^\n]*\n","const { argv, has, val } = require('./lib/args');\n",s,count=1)
open(p,'w').write(s)
PY
done;;
4) python3 - <<'PY'
p='tooling/check-contrast.js'
s=open(p).read()
s=s.replace('fg[i] * (1 - a) + bg[i] * a','fg[i] * a + bg[i] * (1 - a)')
s=s.replace("  t('bad color is null'","  const half = ratio('rgba(0, 0, 0, 0.5)', '#ffffff');\n  t('50%-black on white is about 3.98', half !== null && Math.abs(half - 3.98) < 0.05, half);\n  t('bad color is null'")
open(p,'w').write(s)
PY
;;
5) mkdir -p components/mtd-callout
cat > components/mtd-callout/callout.css <<'CSS'
.mtd-callout {
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-width: 560px;
  padding: 24px 32px;
  background-color: #F2F5F6;
  border-radius: 16px;
  border-left: 4px solid #00D639;
  font-family: "Sage UI", Arial, sans-serif;
}
.mtd-callout__title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; color: #000000; }
.mtd-callout__body { margin: 8px 0 0; font-size: 16px; line-height: 24px; font-weight: 400; color: rgba(0, 0, 0, 0.65); }
.mtd-callout__cta { margin-top: 16px; display: inline-flex; min-height: 44px; padding: 0 24px; }
@media (max-width: 767px) {
  .mtd-callout { padding: 16px 20px; }
  .mtd-callout__title { font-size: 18px; line-height: 24px; }
}
CSS
;;
esac
