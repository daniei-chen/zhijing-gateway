package handler

import (
	"errors"

	"github.com/Wei-Shaw/sub2api/internal/service"
	coderws "github.com/coder/websocket"
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
