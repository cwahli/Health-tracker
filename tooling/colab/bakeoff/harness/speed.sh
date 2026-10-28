for m in "$@"; do
curl -s localhost:11434/api/generate -d "{\"model\":\"$m\",\"prompt\":\"Write a long detailed explanation of how CSS specificity works, with examples.\",\"stream\":false,\"options\":{\"num_predict\":300}}" | python3 -c "import sys,json;d=json.load(sys.stdin);print('$m','decode tok/s',round(d['eval_count']/d['eval_duration']*1e9,1),'load_s',round(d['load_duration']/1e9,1))"
ollama ps | tail -1; nvidia-smi --query-gpu=memory.used --format=csv,noheader
done
