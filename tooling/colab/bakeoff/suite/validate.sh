#!/bin/bash
# validate.sh REPO : each check must FAIL on seed and PASS on the hand solution
R=$1; D=$(dirname "$(readlink -f "$0")")
for n in 1 2 3 4 5; do
  cd $R; git checkout -q -f task$n; git reset -q --hard seed-t$n; git clean -fdq
  a=$(node $D/checks.js t$n $R | cut -c1-260)
  bash $D/sol.sh $R $n
  b=$(node $D/checks.js t$n $R | cut -c1-260)
  echo "T$n seed: $a"; echo "T$n sol : $b"
  git reset -q --hard seed-t$n; git clean -fdq
done
git checkout -q -f main
