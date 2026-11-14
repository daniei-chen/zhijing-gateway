package handler

import (
	"errors"

	coderws "github.com/coder/websocket"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
)

func openAIConcurrencyWSClose(err error) (coderws.StatusCode, string) {
	var policyErr *service.GatewayConcurrencyLimitError
	if errors.As(err, &policyErr) {
		return coderws.StatusTryAgainLater, policyErr.Error()
	}
	return coderws.StatusInternalError, "failed to acquire user concurrency slot"
}

func closeOpenAIConcurrencyWS(conn *coderws.Conn, err error) {
	status, message := openAIConcurrencyWSClose(err)
	closeOpenAIClientWS(conn, status, message)
}
