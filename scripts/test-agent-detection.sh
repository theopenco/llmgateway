#!/bin/bash
# Test script to verify coding agent detection via User-Agent headers.
# Prerequisites: gateway running locally on :4001 with a devpass-enabled API key.
#
# Usage:
#   DEVPASS_API_KEY="your-key" ./scripts/test-agent-detection.sh
#
# The script sends minimal chat completion requests and checks:
# - Recognized agents get past the source restriction (may fail on model/auth but NOT 403 source error)
# - Unknown user-agents get 403 with the "restricted to recognized coding agents" message

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:4001}"
API_KEY="${DEVPASS_API_KEY:-}"

if [ -z "$API_KEY" ]; then
	echo "ERROR: Set DEVPASS_API_KEY to a devpass-enabled API key from seed data"
	exit 1
fi

BODY='{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'

pass=0
fail=0

test_agent() {
	local description="$1"
	local user_agent="$2"
	local expect_blocked="$3"

	response=$(curl -s -w "\n%{http_code}" \
		-X POST "$GATEWAY_URL/v1/chat/completions" \
		-H "Content-Type: application/json" \
		-H "Authorization: Bearer $API_KEY" \
		-H "User-Agent: $user_agent" \
		-d "$BODY" 2>&1)

	http_code=$(echo "$response" | tail -1)
	body=$(echo "$response" | sed '$d')

	if [ "$expect_blocked" = "true" ]; then
		if echo "$body" | grep -q "restricted to recognized coding agents"; then
			echo "  PASS: $description (blocked as expected)"
			pass=$((pass + 1))
		else
			echo "  FAIL: $description - expected 403 source block, got HTTP $http_code"
			echo "        Body: $(echo "$body" | head -1)"
			fail=$((fail + 1))
		fi
	else
		if echo "$body" | grep -q "restricted to recognized coding agents"; then
			echo "  FAIL: $description - got 403 source block but should be allowed"
			echo "        Body: $(echo "$body" | head -1)"
			fail=$((fail + 1))
		else
			echo "  PASS: $description (not source-blocked, HTTP $http_code)"
			pass=$((pass + 1))
		fi
	fi
}

echo "=== Testing Recognized Agents (should NOT be source-blocked) ==="
test_agent "Claude Code" "claude-cli/1.0.0" "false"
test_agent "Codex CLI" "codex_cli_rs/0.4.2" "false"
test_agent "OpenCode" "opencode/0.5.1" "false"
test_agent "Cline" "Cline-VSCode/3.4.0" "false"
test_agent "Cursor" "Cursor/0.45.0" "false"
test_agent "Autohand" "autohand/1.0.0" "false"
test_agent "SoulForge" "soulforge/0.9.0" "false"
test_agent "n8n" "n8n/1.50.0" "false"
test_agent "OpenClaw" "openclaw/0.1.0" "false"
test_agent "Aider" "aider/0.50.0" "false"
test_agent "Continue" "continue/1.2.0" "false"
test_agent "Windsurf" "windsurf/1.0.0" "false"
test_agent "Roo Code" "roo-code/1.0" "false"
test_agent "Zed AI" "Zed/0.150.0" "false"
test_agent "GitHub Copilot" "github-copilot/1.0" "false"
test_agent "Pi Agent" "pi-agent/1.0.0" "false"
test_agent "Hermes Agent" "hermes-agent/0.5.0" "false"

echo ""
echo "=== Testing Claw Forks (should NOT be source-blocked) ==="
test_agent "myclaw fork" "myclaw/1.0" "false"
test_agent "super-claw fork" "super-claw/2.0" "false"
test_agent "anyclaw-tool" "anyclaw-tool/0.1" "false"

echo ""
echo "=== Testing x-source Header Override ==="
response=$(curl -s -w "\n%{http_code}" \
	-X POST "$GATEWAY_URL/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer $API_KEY" \
	-H "User-Agent: curl/8.0" \
	-H "x-source: opencode" \
	-d "$BODY" 2>&1)
body=$(echo "$response" | sed '$d')
if echo "$body" | grep -q "restricted to recognized coding agents"; then
	echo "  FAIL: x-source override - still blocked despite x-source: opencode"
	fail=$((fail + 1))
else
	echo "  PASS: x-source override (x-source: opencode bypasses UA check)"
	pass=$((pass + 1))
fi

echo ""
echo "=== Testing Unknown Agents (SHOULD be source-blocked) ==="
test_agent "curl" "curl/8.4.0" "true"
test_agent "Python requests" "python-requests/2.31.0" "true"
test_agent "Browser" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" "true"
test_agent "Generic axios" "axios/1.6.5" "true"

echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo ""

if [ "$fail" -gt 0 ]; then
	echo "SOME TESTS FAILED"
	exit 1
else
	echo "ALL TESTS PASSED"
fi
