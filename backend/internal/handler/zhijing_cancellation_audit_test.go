package handler

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/repository"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type cancellationAuditUpstream struct {
	service.HTTPUpstream
	started     chan context.Context
	finish      chan struct{}
	active      atomic.Int32
	bodyBlocked bool
}

func (s *cancellationAuditUpstream) Do(req *http.Request, _ string, _ int64, _ int) (*http.Response, error) {
	s.active.Add(1)
	s.started <- req.Context()
	if !s.bodyBlocked {
		select {
		case <-s.finish:
		case <-req.Context().Done():
			s.active.Add(-1)
			return nil, req.Context().Err()
		}
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: &cancellationAuditBody{
		upstream: s, ctx: req.Context(), data: bytes.NewBufferString("data: {\"type\":\"response.completed\",\"response\":{\"id\":\"synthetic\",\"model\":\"gpt-5.4\",\"status\":\"completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n"),
	}}, nil
}

type cancellationAuditBody struct {
	upstream *cancellationAuditUpstream
	ctx      context.Context
	data     io.Reader
	closed   sync.Once
}

func (b *cancellationAuditBody) Read(p []byte) (int, error) {
	select {
	case <-b.upstream.finish:
		return b.data.Read(p)
	case <-b.ctx.Done():
		return 0, b.ctx.Err()
	}
}

func (b *cancellationAuditBody) Close() error {
	b.closed.Do(func() { b.upstream.active.Add(-1) })
	return nil
}

// Exercise actual admission and forwarding with only a synthetic upstream.
func TestZhijingCancellationLifecycleEnforcement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, stream := range []bool{false, true} {
		for _, bodyBlocked := range []bool{false, true} {
			t.Run(fmt.Sprintf("stream_%v_body_blocked_%v", stream, bodyBlocked), func(t *testing.T) {
				runZhijingCancellationLifecycleEnforcement(t, stream, bodyBlocked)
			})
		}
	}
}

func runZhijingCancellationLifecycleEnforcement(t *testing.T, stream, bodyBlocked bool) {
	server := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	cache := repository.NewConcurrencyCache(rdb, 30, 30)
	concurrency := service.NewConcurrencyService(cache)
	upstream := &cancellationAuditUpstream{started: make(chan context.Context, 1), finish: make(chan struct{}), bodyBlocked: bodyBlocked}
	gw := service.NewOpenAIGatewayService(nil, nil, nil, nil, nil, nil, nil, &config.Config{}, nil, concurrency, nil, nil, nil, upstream, nil, nil, nil, nil, nil, nil, nil, nil)
	h := &OpenAIGatewayHandler{gatewayService: gw, concurrencyHelper: NewConcurrencyHelper(concurrency, SSEPingFormatNone, time.Second)}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	body := []byte(fmt.Sprintf(`{"model":"gpt-5.4","messages":[{"role":"user","content":"synthetic"}],"stream":%v}`, stream))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body)).WithContext(ctx)
	started := false
	userRelease, ok := h.acquireResponsesUserSlot(c, 1, 2, stream, &started, zap.NewNop())
	require.True(t, ok)
	defer userRelease()
	account := &service.Account{ID: 1, Platform: service.PlatformOpenAI, Type: service.AccountTypeOAuth, Concurrency: 8, Status: service.StatusActive, Schedulable: true, Credentials: map[string]any{"access_token": "synthetic", "chatgpt_account_id": "synthetic"}}
	slot, err := concurrency.AcquireAccountSlot(ctx, 1, 8)
	require.NoError(t, err)
	require.True(t, slot.Acquired)
	accountRelease, status := h.acquireResponsesAccountSlot(c, nil, "", &service.AccountSelectionResult{Account: account, Acquired: true, ReleaseFunc: slot.ReleaseFunc}, stream, &started, zap.NewNop())
	require.Equal(t, openAISlotAcquireOK, status)
	defer accountRelease()
	completed := make(chan error, 1)
	var result *service.OpenAIForwardResult
	go func() {
		var err error
		func() {
			defer accountRelease()
			defer userRelease()
			result, err = gw.ForwardAsChatCompletions(ctx, c, account, body, "", "gpt-5.4")
		}()
		completed <- err
	}()
	var finish sync.Once
	unblock := func() { finish.Do(func() { close(upstream.finish) }) }
	done := false
	t.Cleanup(func() {
		unblock()
		if !done {
			select {
			case <-completed:
			case <-time.After(3 * time.Second):
				t.Error("synthetic forwarding cleanup timed out")
			}
		}
	})
	var dispatched context.Context
	select {
	case dispatched = <-upstream.started:
	case <-time.After(time.Second):
		t.Fatal("synthetic upstream not dispatched")
	}
	cancel()
	require.Never(t, func() bool {
		accounts, err1 := cache.GetAccountConcurrency(context.Background(), 1)
		users, err2 := cache.GetUserConcurrency(context.Background(), 1)
		return err1 == nil && err2 == nil && accounts == 0 && users == 0
	}, 50*time.Millisecond, time.Millisecond)
	accounts, err := cache.GetAccountConcurrency(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 1, accounts)
	users, err := cache.GetUserConcurrency(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 1, users)
	require.NoError(t, dispatched.Err(), "usage drain must remain possible after client cancellation")
	require.Equal(t, int32(1), upstream.active.Load())
	var admitted []func()
	defer func() {
		for _, release := range admitted {
			release()
		}
	}()
	for range 7 {
		next, err := concurrency.AcquireAccountSlot(context.Background(), 1, 8)
		require.NoError(t, err)
		require.True(t, next.Acquired)
		admitted = append(admitted, next.ReleaseFunc)
	}
	next, err := concurrency.AcquireAccountSlot(context.Background(), 1, 8)
	require.NoError(t, err)
	if next.Acquired {
		next.ReleaseFunc()
		t.Fatal("detached request was omitted from the account cap")
	}
	secondKeyRelease, acquired, err := h.concurrencyHelper.TryAcquireUserSlotForAPIKey(context.Background(), 1, 2, 101)
	require.NoError(t, err)
	require.True(t, acquired)
	defer secondKeyRelease()
	thirdKeyRelease, acquired, err := h.concurrencyHelper.TryAcquireUserSlotForAPIKey(context.Background(), 1, 2, 102)
	require.NoError(t, err)
	if acquired {
		thirdKeyRelease()
		t.Fatal("another API key escaped the shared member cap")
	}
	unblock()
	select {
	case err := <-completed:
		done = true
		require.NoError(t, err)
	case <-time.After(3 * time.Second):
		t.Fatal("forwarding did not finish after terminal usage")
	}
	require.NotNil(t, result)
	require.Equal(t, 1, result.Usage.InputTokens)
	require.Equal(t, 1, result.Usage.OutputTokens)
	require.Zero(t, upstream.active.Load())
	accounts, err = cache.GetAccountConcurrency(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 7, accounts, "only the finished request should be released")
	users, err = cache.GetUserConcurrency(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 1, users)
}

func TestZhijingCancellationHTTPDisconnectHoldsLeaseUntilDrain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	cfg := &config.Config{}
	cfg.Gateway.ConcurrencySlotTTLMinutes = 30
	cfg.Gateway.MemberConcurrencyLimit, cfg.Gateway.GlobalConcurrencyLimit = 3, 9
	cache := repository.ProvideConcurrencyCache(rdb, cfg)
	concurrency := service.ProvideConcurrencyService(cache, nil, cfg)
	upstream := &cancellationAuditUpstream{
		started: make(chan context.Context, 16), finish: make(chan struct{}), bodyBlocked: true,
	}
	gw := service.NewOpenAIGatewayService(nil, nil, nil, nil, nil, nil, nil, cfg, nil, concurrency, nil, nil, nil, upstream, nil, nil, nil, nil, nil, nil, nil, nil)
	h := &OpenAIGatewayHandler{gatewayService: gw, cfg: cfg, concurrencyHelper: NewConcurrencyHelper(concurrency, SSEPingFormatNone, time.Second)}
	account := &service.Account{ID: 1, Platform: service.PlatformOpenAI, Type: service.AccountTypeOAuth, Concurrency: 8, Status: service.StatusActive, Schedulable: true, Credentials: map[string]any{"access_token": "synthetic", "chatgpt_account_id": "synthetic"}}
	clientGone, handlerDone := make(chan struct{}), make(chan struct{}, 16)
	router := gin.New()
	router.POST("/v1/chat/completions", func(c *gin.Context) {
		defer func() { handlerDone <- struct{}{} }()
		_, _ = io.Copy(io.Discard, c.Request.Body)
		user, _ := strconv.ParseInt(c.GetHeader("X-Synthetic-Member"), 10, 64)
		started := false
		userRelease, ok := h.acquireResponsesUserSlot(c, user, 3, false, &started, zap.NewNop())
		if !ok {
			return
		}
		defer userRelease()
		if user == 1 {
			clientContext := c.Request.Context()
			go func() { <-clientContext.Done(); close(clientGone) }()
		}
		slot, err := concurrency.AcquireAccountSlot(c.Request.Context(), 1, 8)
		if err != nil || !slot.Acquired {
			c.Status(http.StatusTooManyRequests)
			return
		}
		defer slot.ReleaseFunc()
		_, _ = gw.ForwardAsChatCompletions(c.Request.Context(), c, account,
			[]byte(`{"model":"gpt-5.4","messages":[{"role":"user","content":"synthetic"}],"stream":false}`), "", "gpt-5.4")
	})
	httpServer := httptest.NewServer(router)
	var finish sync.Once
	t.Cleanup(func() {
		finish.Do(func() { close(upstream.finish) })
		httpServer.Close()
	})
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, httpServer.URL+"/v1/chat/completions", bytes.NewReader([]byte(`{}`)))
	require.NoError(t, err)
	request.Header.Set("X-Synthetic-Member", "1")
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		response, err := http.DefaultClient.Do(request)
		if err == nil {
			_ = response.Body.Close()
		}
	}()
	select {
	case <-upstream.started:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream did not start")
	}
	cancel()
	select {
	case <-clientGone:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not observe actual socket cancellation")
	}
	select {
	case <-clientDone:
	case <-time.After(time.Second):
		t.Fatal("client cancellation did not finish")
	}
	require.Equal(t, int32(1), upstream.active.Load())
	count, err := cache.GetUserConcurrency(context.Background(), 1)
	require.NoError(t, err)
	require.Equal(t, 1, count, "the disconnected upstream is still a running request")
	var releases []func()
	t.Cleanup(func() {
		for _, release := range releases {
			release()
		}
	})
	for user, slots := range map[int64]int{2: 3, 3: 3, 4: 2} {
		for range slots {
			lease, err := concurrency.AcquireUserSlot(context.Background(), user, 3)
			require.NoError(t, err)
			require.True(t, lease.Acquired)
			releases = append(releases, lease.ReleaseFunc)
		}
	}
	next, err := concurrency.AcquireUserSlot(context.Background(), 5, 3)
	require.Nil(t, next)
	var limited *service.GatewayConcurrencyLimitError
	require.ErrorAs(t, err, &limited)
	require.Equal(t, "global", limited.Scope)
	finish.Do(func() { close(upstream.finish) })
	select {
	case <-handlerDone:
	case <-time.After(3 * time.Second):
		t.Fatal("terminal drain did not release the handler")
	}
	require.Zero(t, upstream.active.Load())
	count, err = cache.GetUserConcurrency(context.Background(), 1)
	require.NoError(t, err)
	require.Zero(t, count)
	lease, err := concurrency.AcquireUserSlot(context.Background(), 5, 3)
	require.NoError(t, err)
	require.True(t, lease.Acquired)
	lease.ReleaseFunc()
}
