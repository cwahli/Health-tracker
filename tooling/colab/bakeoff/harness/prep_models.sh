#!/bin/bash
# create sampling-tuned Modelfile variants for models that are present
cd /content/bakeoff/modelfiles
for f in *.Modelfile; do n=${f%.Modelfile}; base=$(grep ^FROM $f | cut -d' ' -f2)
  if ollama list | awk '{print $1}' | grep -q "^${base%%:*}"; then
    ollama list | awk '{print $1}' | grep -qx "$base" || ollama list | awk '{print $1}' | grep -qx "$base:latest" || { echo "skip $n (base $base missing)"; continue; }
    ollama create $n -f $f 2>&1 | tail -1; ollama show $n | grep -E "tools|thinking" | tr -s ' ' | tr '\n' ' '; echo " <- $n"
  else echo "skip $n"; fi
done
