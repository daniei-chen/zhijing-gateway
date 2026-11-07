package service

import "strings"

const (
	GatewayUserConcurrencyLimitCode   = "gateway_user_concurrency_limit"
	GatewayGlobalConcurrencyLimitCode = "gateway_global_concurrency_limit"
)

// OpsConcurrencyScope recognizes only gateway codes and anchored legacy messages.
// Callers must still check HTTP status and trustworthy upstream/local context.
func OpsConcurrencyScope(code, message string) string {
	message = strings.ToLower(strings.TrimSpace(message))
	switch strings.TrimSpace(code) {
	case GatewayUserConcurrencyLimitCode:
		return "user"
	case GatewayGlobalConcurrencyLimitCode:
		return "global"
	case "gateway_queue_full":
		return "queue"
	case "gateway_concurrency_limit":
		if strings.HasPrefix(message, "concurrency limit exceeded for user,") {
			return "user"
		}
		return "account"
	}
	switch {
	case strings.HasPrefix(message, "个人并发已达上限"):
		return "user"
	case strings.HasPrefix(message, "网关并发已达上限"):
		return "global"
	case strings.HasPrefix(message, "concurrency limit exceeded for user,"):
		return "user"
	case strings.HasPrefix(message, "concurrency limit exceeded for "),
		strings.HasPrefix(message, "image generation concurrency limit exceeded"):
		return "account"
	case message == "too many pending requests, please retry later":
		return "queue"
	default:
		return ""
	}
}
