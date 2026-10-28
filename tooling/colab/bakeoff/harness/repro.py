import json, sys, urllib.request
def call(model, msgs):
    req = urllib.request.Request('http://127.0.0.1:11434/v1/chat/completions', data=json.dumps({"model": model, "messages": msgs, "max_tokens": 200, "tools": [{"type":"function","function":{"name":"read","description":"read a file","parameters":{"type":"object","properties":{"filePath":{"type":"string"}},"required":["filePath"]}}}]}).encode(), headers={'Content-Type':'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300)); return 'OK ' + json.dumps(r['choices'][0]['message'])[:160]
    except urllib.error.HTTPError as e: return 'HTTP %d %s' % (e.code, e.read().decode()[:120])
def tc(i, p): return {"id": "call_%d" % i, "type": "function", "function": {"name": "read", "arguments": json.dumps({"filePath": p})}}
base = [{"role":"system","content":"You are a coding agent."},{"role":"user","content":"Refactor the three scripts."}]
for model in sys.argv[1:]:
    one = base + [{"role":"assistant","content":"","tool_calls":[tc(0,"a.js")]},{"role":"tool","tool_call_id":"call_0","content":"file a"}]
    three = base + [{"role":"assistant","content":"","tool_calls":[tc(0,"a.js"),tc(1,"b.js"),tc(2,"c.js")]}] + [{"role":"tool","tool_call_id":"call_%d"%i,"content":"file %d"%i} for i in range(3)]
    print(model, '1 call :', call(model, one)); print(model, '3 calls:', call(model, three))
