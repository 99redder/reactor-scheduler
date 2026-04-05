# OpenClaw + GX10 Troubleshooting Guide
## Last Updated: April 5, 2026

## Working Setup Summary
- **Model**: Qwen3-Coder-Next-Q8_0 (dense 80B, best coding quality for OpenClaw)
- **Server**: llama.cpp on ASUS Ascent GX10 (NVIDIA GB10, 128GB unified memory)
- **Server flags**: `--ctx-size 49152 --batch-size 2048 --ubatch-size 2048 --cache-prompt --flash-attn on --parallel 1 --prio 3 --reasoning off`
- **Server port**: 8080, bound to 0.0.0.0
- **Client**: OpenClaw 2026.4.1 on Mac Mini, connected via Discord DM
- **API type**: `openai-completions` (the ONLY type that works with llama.cpp)

## Critical Config Rules
1. **Model ID must exactly match the GGUF filename** including the `.gguf` extension
2. **contextWindow in openclaw.json MUST match --ctx-size on the server** (both 49152)
3. **compaction.reserveTokensFloor must be set to 20000** — prevents context overflow causing 12+ minute hangs
4. **Auth token in config must match the running gateway** — mismatch causes silent failures
5. **API must be "openai-completions"** — "openai-chat", "openai-responses", "openai", "ollama" all fail or are invalid
6. **baseUrl must point to GX10 IP** (192.168.1.23:8080/v1), never 127.0.0.1

## What Broke and Why (April 4-5, 2026)

### Problem 1: Context Overflow (12-minute hangs)
- **Symptom**: Agent types for 12+ minutes, then says "Context limit exceeded"
- **Cause**: Conversation history fills entire context window, no room for model to think
- **Fix**: Add `"compaction": {"reserveTokensFloor": 20000}` under `agents.defaults`

### Problem 2: Context Window Mismatch (400 errors)
- **Symptom**: Gateway error log shows "request (40631 tokens) exceeds available context size (32768)"
- **Cause**: openclaw.json had contextWindow: 32768 but server had --ctx-size 49152, or vice versa
- **Fix**: Both values must be identical (49152)

### Problem 3: Sandbox Write Failures
- **Symptom**: "Path escapes sandbox root" errors, agent can't edit project files
- **Cause**: Project repos live outside ~/.openclaw/workspace
- **Fix**: Symlink repos into workspace: `ln -s /Users/chrisgorham/Websites ~/.openclaw/workspace/Websites`

### Problem 4: XML Tool Call Parse Errors
- **Symptom**: "Failed to parse input at pos XXX" followed by XML like `<tool_call><function=read>...`
- **Cause**: Model outputs tool calls in XML format instead of OpenAI JSON format
- **Affected models**: Qwen3.5-122B-A10B, Nemotron 3 Super 120B — both incompatible with OpenClaw
- **Fix**: Use Qwen3-Coder-Next which outputs JSON tool calls. No fix exists for the other models with OpenClaw.

### Problem 5: Reasoning Token Parsing
- **Symptom**: Model generates <think> tags that OpenClaw can't parse, responses are blank or errors
- **Cause**: Model uses reasoning/thinking mode, OpenClaw doesn't handle the format
- **Fix**: Launch server with `--reasoning off`

### Problem 6: Config Corruption from Multiple Edits
- **Symptom**: Multiple zombie providers, wrong auth tokens, missing sections
- **Cause**: Running `openclaw onboard` multiple times or LLMs editing config without full context
- **Fix**: Keep a known-good backup. Never let an LLM rewrite the entire config — only change specific fields.

## Models Tested on GX10

| Model | Speed | Coding Quality | OpenClaw Compatible | Notes |
|-------|-------|---------------|-------------------|-------|
| Qwen3-Coder-Next 80B (Q8) | ~31 tok/s | Excellent | YES | Only model that works end-to-end |
| Qwen3.5-122B-A10B (Q6) | ~20 tok/s | Good general, mediocre coding | NO | XML tool calls break OpenClaw |
| Nemotron 3 Super 120B-A12B | ~16 tok/s | Best agentic benchmarks | NO | XML tool calls + reasoning tokens break OpenClaw |

## Recovery Checklist
If things break again:
1. Check gateway error log: `tail -20 ~/.openclaw/logs/gateway.err.log`
2. Check server is running: `curl http://192.168.1.23:8080/v1/models`
3. Check model name matches config: model ID in config must equal server model name
4. Check auth token matches: compare config token to what gateway is using
5. Restore from backup if needed: `cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json`
6. Restart gateway: `openclaw gateway restart`
7. DO NOT run `openclaw onboard` — it creates duplicate providers and corrupts config

## GX10 Server Quick Start
```bash
cd ~/llama.cpp
nohup ./build/bin/llama-server \
 --model /home/easternshoreai/llama.cpp/models/Qwen3-Coder-Next-Q8_0-00001-of-00003.gguf \
 --host 0.0.0.0 --port 8080 -ngl 999 \
 --ctx-size 49152 --batch-size 2048 --ubatch-size 2048 \
 --cache-prompt --flash-attn on --parallel 1 --prio 3 --reasoning off \
 > ~/llama-server.log 2>&1 &
```
