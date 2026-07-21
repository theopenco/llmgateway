// Package main provides a command-line tool to fetch models from LLM Gateway
// and generate a configuration file for the provider.
//
// This file is intended for the charmbracelet/catwalk repository as
// cmd/llmgateway/main.go. It follows the same structure as cmd/openrouter.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"charm.land/catwalk/pkg/catwalk"
)

// Model represents a model returned by the LLM Gateway models API.
type Model struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Architecture  Architecture    `json:"architecture"`
	Providers     []ModelProvider `json:"providers"`
	Pricing       Pricing         `json:"pricing"`
	ContextLength int64           `json:"context_length"`
	MaxOutput     *int64          `json:"max_output"`
	Free          bool            `json:"free"`
}

// Architecture defines the model's input/output modalities.
type Architecture struct {
	InputModalities  []string `json:"input_modalities"`
	OutputModalities []string `json:"output_modalities"`
}

// ModelProvider describes one upstream provider mapping of a model.
type ModelProvider struct {
	ProviderID       string   `json:"providerId"`
	Tools            bool     `json:"tools"`
	Vision           bool     `json:"vision"`
	Reasoning        bool     `json:"reasoning"`
	ReasoningEfforts []string `json:"reasoning_efforts"`
	MaxOutput        *int64   `json:"max_output"`
}

// Pricing contains per-token USD prices (cheapest active provider).
type Pricing struct {
	Prompt         string `json:"prompt"`
	Completion     string `json:"completion"`
	InputCacheRead string `json:"input_cache_read"`
}

// ModelsResponse is the response structure for the models API.
type ModelsResponse struct {
	Data []Model `json:"data"`
}

func roundCost(v float64) float64 {
	return math.Round(v*1e5) / 1e5
}

func costPer1M(perToken string) float64 {
	cost, err := strconv.ParseFloat(perToken, 64)
	if err != nil {
		cost = 0.0
	}
	return roundCost(cost * 1_000_000)
}

func fetchLLMGatewayModels() (*ModelsResponse, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequestWithContext(
		context.Background(),
		"GET",
		"https://api.llmgateway.io/v1/models?exclude_deprecated=true",
		nil,
	)
	req.Header.Set("User-Agent", "Crush-Client/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err //nolint:wrapcheck
	}
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("unable to read models response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, body)
	}

	var mr ModelsResponse
	if err := json.Unmarshal(body, &mr); err != nil {
		return nil, err //nolint:wrapcheck
	}
	return &mr, nil
}

// This is used to generate the llmgateway.json config file.
func main() {
	modelsResp, err := fetchLLMGatewayModels()
	if err != nil {
		log.Fatal("Error fetching LLM Gateway models:", err)
	}

	llmGatewayProvider := catwalk.Provider{
		Name:                "LLM Gateway",
		ID:                  "llmgateway",
		APIKey:              "$LLMGATEWAY_API_KEY",
		APIEndpoint:         "https://api.llmgateway.io/v1",
		Type:                catwalk.TypeOpenAICompat,
		DefaultLargeModelID: "claude-sonnet-5",
		DefaultSmallModelID: "claude-haiku-4-5",
		Models:              []catwalk.Model{},
	}

	for _, model := range modelsResp.Data {
		if model.ContextLength < 20000 {
			continue
		}
		if !slices.Contains(model.Architecture.InputModalities, "text") ||
			!slices.Contains(model.Architecture.OutputModalities, "text") {
			continue
		}

		hasTools := false
		canReason := false
		supportsImages := false
		var reasoningLevels []string
		for _, provider := range model.Providers {
			hasTools = hasTools || provider.Tools
			canReason = canReason || provider.Reasoning
			supportsImages = supportsImages || provider.Vision
			if reasoningLevels == nil && len(provider.ReasoningEfforts) > 0 {
				reasoningLevels = provider.ReasoningEfforts
			}
		}
		if !hasTools {
			continue
		}

		var defaultReasoning string
		if canReason && len(reasoningLevels) > 0 {
			if slices.Contains(reasoningLevels, "medium") {
				defaultReasoning = "medium"
			} else {
				defaultReasoning = reasoningLevels[len(reasoningLevels)/2]
			}
		} else {
			reasoningLevels = nil
		}

		m := catwalk.Model{
			ID:                     model.ID,
			Name:                   model.Name,
			CostPer1MIn:            costPer1M(model.Pricing.Prompt),
			CostPer1MOut:           costPer1M(model.Pricing.Completion),
			CostPer1MInCached:      costPer1M(model.Pricing.InputCacheRead),
			CostPer1MOutCached:     0,
			ContextWindow:          model.ContextLength,
			CanReason:              canReason,
			DefaultReasoningEffort: defaultReasoning,
			ReasoningLevels:        reasoningLevels,
			SupportsImages:         supportsImages,
		}

		if model.MaxOutput != nil {
			m.DefaultMaxTokens = *model.MaxOutput
		} else {
			m.DefaultMaxTokens = min(model.ContextLength/4, 32000)
		}

		llmGatewayProvider.Models = append(llmGatewayProvider.Models, m)
	}

	slices.SortFunc(llmGatewayProvider.Models, func(a catwalk.Model, b catwalk.Model) int {
		return strings.Compare(a.Name, b.Name)
	})

	data, err := json.MarshalIndent(llmGatewayProvider, "", "  ")
	if err != nil {
		log.Fatal("Error marshaling LLM Gateway provider:", err)
	}
	if err := os.WriteFile("internal/providers/configs/llmgateway.json", data, 0o600); err != nil {
		log.Fatal("Error writing LLM Gateway provider config:", err)
	}
}
