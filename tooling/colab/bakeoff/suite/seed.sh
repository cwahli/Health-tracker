#!/bin/bash
# seed.sh REPO : create branches task1..task5 (base main + optional seed commit) and tags seed-tN
set -e
cd "$1"
git checkout -q main
git reset -q --hard; git clean -fdq
BASE=$(git rev-parse main)
for n in 1 2 3 4 5; do
  git branch -D task$n >/dev/null 2>&1 || true
  git tag -d seed-t$n >/dev/null 2>&1 || true
  git checkout -q -b task$n $BASE
  case $n in
  2) cat >> components/mtd-pricing/fallback.css <<'CSS'

/* CTA row: layout for the pricing buttons. */
.mtd-pricing-cta.button--secondary {
  min-height: 48px;
  padding: 0 24px;
}

.button--secondary:hover {
  background-color: #0a5c36;
  color: #fff;
}

.button--secondary:focus-visible {
  outline: 3px solid #f00;
}

.product-card-cta-tertiary-alt:active {
  transform: scale(0.97);
}

.button-tertiary:hover {
  text-decoration: underline;
}

.button-tertiary {
  min-height: 44px;
}
CSS
  ;;
  4) python3 - <<'PY'
p='tooling/check-contrast.js'
s=open(p).read()
a='fg[i] * a + bg[i] * (1 - a)'
assert a in s
open(p,'w').write(s.replace(a,'fg[i] * (1 - a) + bg[i] * a'))
PY
  ;;
  esac
  if ! git diff --quiet; then git -c user.name=bench -c user.email=bench@x commit -qam "seed task$n"; fi
  git tag seed-t$n
done
git checkout -q main
echo seeded
