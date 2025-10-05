#!/bin/bash

# Configuration
API_KEY="${LLM_GATEWAY_API_KEY:-your-api-key-here}"
BASE_URL="https://api.llmgateway.io/v1"
#MODELS=(
#  "deepseek/deepseek-r1-0528"
#  "cloudrift/deepseek-r1-0528"
#  "nebius/deepseek-r1-0528"
#)
MODELS=(
	"moonshot/kimi-k2"
	"novita/kimi-k2"
	"groq/kimi-k2"
)
REQUESTS_PER_MODEL=5
OUTPUT_FILE="benchmark_results.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Starting benchmark..."
echo "Models: ${MODELS[@]}"
echo "Requests per model: $REQUESTS_PER_MODEL"
echo ""

# Initialize results array
results="[]"

# Function to make a single request and measure timings
benchmark_request() {
  local model=$1
  local request_num=$2

  # Create temporary files for response and timing
  local response_file=$(mktemp)
  local timing_file=$(mktemp)

  # Payload
  local payload=$(cat <<EOF
{
  "model": "$model",
  "messages": [
    {"role": "user", "content": "Write a haiku about programming"}
  ],
  "stream": true,
  "max_tokens": 100
}
EOF
)

  # Record start time in nanoseconds
  local start_time=$(date +%s%N)
  local ttft=""
  local first_chunk_received=false

  # Make streaming request and capture TTFT
  curl -s -N -X POST "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null | while IFS= read -r line; do

    # Check if this is the first data chunk
    if [[ ! $first_chunk_received && $line == data:* ]]; then
      first_chunk_received=true
      ttft=$(date +%s%N)
      echo "$ttft" > "$timing_file"
    fi

    echo "$line" >> "$response_file"
  done

  # Record end time
  local end_time=$(date +%s%N)

  # Read TTFT from timing file
  if [[ -f "$timing_file" && -s "$timing_file" ]]; then
    ttft=$(cat "$timing_file")
    ttft_ms=$(( (ttft - start_time) / 1000000 ))
  else
    ttft_ms="null"
  fi

  # Calculate total duration
  local total_ms=$(( (end_time - start_time) / 1000000 ))

  # Check if request was successful
  if [[ -f "$response_file" ]] && grep -q "data:" "$response_file"; then
    status="success"
  else
    status="error"
  fi

  # Clean up
  rm -f "$response_file" "$timing_file"

  # Return JSON result
  echo "{\"model\":\"$model\",\"request\":$request_num,\"ttft_ms\":$ttft_ms,\"total_ms\":$total_ms,\"status\":\"$status\"}"
}

# Benchmark each model
for model in "${MODELS[@]}"; do
  echo -e "${YELLOW}Testing $model...${NC}"

  for i in $(seq 1 $REQUESTS_PER_MODEL); do
    echo -n "  Request $i/$REQUESTS_PER_MODEL... "

    result=$(benchmark_request "$model" "$i")

    # Add result to results array
    if [[ "$results" == "[]" ]]; then
      results="[$result]"
    else
      results="${results%]}, $result]"
    fi

    # Extract values for display
    ttft=$(echo "$result" | grep -o '"ttft_ms":[0-9]*' | cut -d':' -f2)
    total=$(echo "$result" | grep -o '"total_ms":[0-9]*' | cut -d':' -f2)
    status=$(echo "$result" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [[ "$status" == "success" ]]; then
      echo -e "${GREEN}✓${NC} TTFT: ${ttft}ms, Total: ${total}ms"
    else
      echo -e "${RED}✗${NC} Failed"
    fi
  done
  echo ""
done

# Calculate aggregated statistics
echo "📊 Calculating statistics..."
echo ""

stats="{"
first_model=true

for model in "${MODELS[@]}"; do
  # Extract all measurements for this model
  ttfts=$(echo "$results" | grep -o "\"model\":\"$model\"[^}]*" | grep -o '"ttft_ms":[0-9]*' | cut -d':' -f2)
  totals=$(echo "$results" | grep -o "\"model\":\"$model\"[^}]*" | grep -o '"total_ms":[0-9]*' | cut -d':' -f2)

  # Calculate averages
  if [[ -n "$ttfts" ]]; then
    avg_ttft=$(echo "$ttfts" | awk '{sum+=$1; count++} END {if(count>0) print int(sum/count); else print 0}')
    min_ttft=$(echo "$ttfts" | sort -n | head -1)
    max_ttft=$(echo "$ttfts" | sort -n | tail -1)
  else
    avg_ttft=0
    min_ttft=0
    max_ttft=0
  fi

  if [[ -n "$totals" ]]; then
    avg_total=$(echo "$totals" | awk '{sum+=$1; count++} END {if(count>0) print int(sum/count); else print 0}')
    min_total=$(echo "$totals" | sort -n | head -1)
    max_total=$(echo "$totals" | sort -n | tail -1)
  else
    avg_total=0
    min_total=0
    max_total=0
  fi

  # Add comma if not first model
  if [[ "$first_model" == false ]]; then
    stats="$stats,"
  fi
  first_model=false

  stats="$stats\"$model\":{\"avg_ttft_ms\":$avg_ttft,\"min_ttft_ms\":$min_ttft,\"max_ttft_ms\":$max_ttft,\"avg_total_ms\":$avg_total,\"min_total_ms\":$min_total,\"max_total_ms\":$max_total,\"requests\":$REQUESTS_PER_MODEL}"

  # Display stats
  echo -e "${YELLOW}$model${NC}"
  echo "  TTFT: avg=${avg_ttft}ms, min=${min_ttft}ms, max=${max_ttft}ms"
  echo "  Total: avg=${avg_total}ms, min=${min_total}ms, max=${max_total}ms"
  echo ""
done

stats="$stats}"

# Create final JSON output
output=$(cat <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "config": {
    "base_url": "$BASE_URL",
    "models": $(printf '%s\n' "${MODELS[@]}" | jq -R . | jq -s .),
    "requests_per_model": $REQUESTS_PER_MODEL
  },
  "statistics": $stats,
  "raw_results": $results
}
EOF
)

# Save to file
echo "$output" | jq '.' > "$OUTPUT_FILE"

echo -e "${GREEN}✅ Benchmark complete!${NC}"
echo "Results saved to: $OUTPUT_FILE"
