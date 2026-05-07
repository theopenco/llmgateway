#!/bin/bash
#
# Test the OpenAI-compatible API against the LLM Gateway using curl.
#
# Usage:
#   export OPENAI_API_KEY=test-token
#   bash scripts/test-openai-sdk.sh
#
# Options via env vars:
#   OPENAI_API_KEY   - Gateway API key (required)
#   OPENAI_BASE_URL  - Gateway URL (default: http://localhost:4001/v1)
#   TEST_MODEL       - Model to test (default: gpt-4o-mini)

set -euo pipefail

BASE_URL="${OPENAI_BASE_URL:-http://localhost:4001/v1}"
API_KEY="${OPENAI_API_KEY:?Error: OPENAI_API_KEY env var is required}"
MODEL="${TEST_MODEL:-gpt-4o-mini}"

PASSED=0
FAILED=0

run_test() {
  local name="$1"
  shift
  echo ""
  echo "--- $name ---"
  if "$@"; then
    echo "PASS"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL"
    FAILED=$((FAILED + 1))
  fi
}

test_list_models() {
  local res
  res=$(curl -sf "$BASE_URL/models" -H "Authorization: Bearer $API_KEY")
  local count
  count=$(echo "$res" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null || echo "0")
  local first5
  first5=$(echo "$res" | python3 -c "import sys,json; print([m['id'] for m in json.load(sys.stdin)['data'][:5]])" 2>/dev/null)
  echo "  Models count: $count"
  echo "  First 5: $first5"
  [ "$count" -gt 0 ]
}

test_chat_completion() {
  local res
  res=$(curl -sf "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with one word: OK\"}]}")
  local text
  text=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'].strip())" 2>/dev/null)
  local tokens
  tokens=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin)['usage']['total_tokens'])" 2>/dev/null)
  echo "  Response: $text"
  echo "  Tokens: $tokens"
  echo "$text" | grep -iq "OK"
}

test_chat_streaming() {
  local text=""
  while IFS= read -r line; do
    case "$line" in
      data:\ \[DONE\]) break ;;
      data:\ *)
        local chunk
        chunk=$(echo "${line#data: }" | python3 -c "
import sys,json
d=json.load(sys.stdin)
c=d.get('choices',[{}])[0].get('delta',{}).get('content','')
if c: print(c, end='')" 2>/dev/null)
        text="${text}${chunk}"
        ;;
    esac
  done < <(curl -sf "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with one word: OK\"}],\"stream\":true}")
  echo "  Response: $text"
  echo "$text" | grep -iq "OK"
}

test_chat_with_tools() {
  local res
  res=$(curl -sf "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\":\"$MODEL\",
      \"messages\":[{\"role\":\"user\",\"content\":\"What is 2+2?\"}],
      \"tools\":[{
        \"type\":\"function\",
        \"function\":{
          \"name\":\"calculator\",
          \"description\":\"Evaluate a math expression\",
          \"parameters\":{\"type\":\"object\",\"properties\":{\"expression\":{\"type\":\"string\"}},\"required\":[\"expression\"]}
        }
      }]
    }")
  local tool_call
  tool_call=$(echo "$res" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tc=d['choices'][0]['message'].get('tool_calls')
if tc:
  print(f\"  Tool call: {tc[0]['function']['name']}({tc[0]['function']['arguments']})\")
else:
  print(f\"  Response (no tool call): {d['choices'][0]['message'].get('content','')[:100]}\")" 2>/dev/null)
  echo "$tool_call"
  [ -n "$tool_call" ]
}

test_chat_json_mode() {
  local res
  res=$(curl -sf "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\":\"$MODEL\",
      \"messages\":[{\"role\":\"user\",\"content\":\"Return a JSON object with key 'answer' and value 42\"}],
      \"response_format\":{\"type\":\"json_object\"}
    }")
  local text
  text=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'].strip())" 2>/dev/null)
  echo "  JSON: $text"
  echo "$text" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'answer' in d" 2>/dev/null
}

test_responses_api() {
  local res
  res=$(curl -sf "$BASE_URL/responses" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"input\":\"Reply with one word: OK\",\"store\":false}")
  local text
  text=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin)['output'][0]['content'][0]['text'].strip())" 2>/dev/null)
  local rid
  rid=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
  echo "  Response: $text"
  echo "  ID: $rid"
  echo "$text" | grep -iq "OK"
}

test_responses_streaming() {
  local events=""
  while IFS= read -r line; do
    case "$line" in
      event:\ *)
        local evt="${line#event: }"
        if [ -n "$events" ]; then
          events="$events, $evt"
        else
          events="$evt"
        fi
        ;;
    esac
  done < <(curl -sf "$BASE_URL/responses" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"input\":\"Reply with one word: OK\",\"stream\":true,\"store\":false}")
  # deduplicate events
  local unique
  unique=$(echo "$events" | tr ',' '\n' | sed 's/^ //' | awk '!seen[$0]++' | paste -sd ',' -)
  echo "  Events: $unique"
  echo "$events" | grep -q "response.completed"
}

echo "Testing LLM Gateway at $BASE_URL"
echo "Model: $MODEL"
echo "API Key: ${API_KEY:0:8}..."

run_test "List Models" test_list_models
run_test "Chat Completion" test_chat_completion
run_test "Chat Streaming" test_chat_streaming
run_test "Chat with Tools" test_chat_with_tools
run_test "Chat JSON Mode" test_chat_json_mode
run_test "Responses API" test_responses_api
run_test "Responses Streaming" test_responses_streaming

echo ""
echo "========================================"
echo "Results: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
