package service

import (
	"github.com/tidwall/gjson"
	"strings"
)

// This classifier is diagnostic only. It does not change TTFT, flush policy,
// routing, billing or the forwarded SSE bytes. Preamble and empty deltas are not
// usable output, even when the legacy semantic TTFT mode counts structural items.
func openAIResponseOutputKind(data, eventType string) string {
	if !gjson.Valid(data) {
		return ""
	}
	eventType = strings.TrimSpace(eventType)
	if eventType == "" {
		eventType = gjson.Get(data, "type").String()
	}
	if !openAIStreamDataStartsVisibleOutput(data, eventType) {
		return ""
	}
	switch eventType {
	case "response.output_text.delta", "response.output_text.done", "response.refusal.delta", "response.refusal.done":
		return "text"
	case "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.custom_tool_call_input.delta", "response.custom_tool_call_input.done":
		return "tool"
	case "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_text.delta", "response.reasoning_text.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done":
		return "reasoning"
	case "response.content_part.added", "response.content_part.done":
		if gjson.Get(data, "part.type").String() == "reasoning_text" {
			return "reasoning"
		}
		return "text"
	case "response.output_item.added", "response.output_item.done":
		switch gjson.Get(data, "item.type").String() {
		case "function_call", "custom_tool_call":
			return "tool"
		case "reasoning":
			return "reasoning"
		case "message":
			return "text"
		}
	}
	return ""
}
