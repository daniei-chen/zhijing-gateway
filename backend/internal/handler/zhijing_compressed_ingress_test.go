package handler

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/gatewaytiming"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/gin-gonic/gin"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/require"
)

// Exercise the actual ingress limiter, body timing and handler decoder without
// authorizing accounts or dispatching a model request.
func TestZhijingCompressedIngressPreservesContentAndWireMeasurement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, endpoint := range []string{"/v1/responses", "/v1/chat/completions"} {
		for _, encoding := range []string{"identity", "gzip", "zstd"} {
			t.Run(endpoint+"/"+encoding, func(t *testing.T) {
				plain, err := json.Marshal(map[string]any{"model": "synthetic", "source": strings.Repeat("const value = 42; ", 64000)})
				require.NoError(t, err)
				wire := zhijingEncodeIngress(t, encoding, plain)
				cfg := &config.Config{}
				cfg.Gateway.MaxBodySize = 16 << 20
				router := gin.New()
				router.Use(middleware.RequestBodyLimit(cfg.Gateway.MaxBodySize))
				router.POST(endpoint, func(c *gin.Context) {
					c.Request = c.Request.WithContext(gatewaytiming.Start(c.Request.Context()))
					gatewaytiming.ObserveBody(c.Request)
					decoded, err := readLenientJSONRequestBodyWithPrealloc(c.Request, cfg)
					require.NoError(t, err)
					require.Equal(t, plain, decoded)
					snapshot := gatewaytiming.Snapshot(c.Request.Context())
					require.Equal(t, int64(len(wire)), snapshot["body_wire_bytes"])
					digest := sha256.Sum256(decoded)
					c.JSON(200, gin.H{"hash": hex.EncodeToString(digest[:])})
				})
				request := httptest.NewRequest(http.MethodPost, endpoint, bytes.NewReader(wire))
				request.Header.Set("Content-Encoding", encoding)
				request.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				require.Equal(t, 200, response.Code)
			})
		}
	}
}

func TestZhijingCompressedIngressStillEnforcesDecodedLimit(t *testing.T) {
	for _, encoding := range []string{"gzip", "zstd"} {
		t.Run(encoding, func(t *testing.T) {
			plain := []byte(`{"source":"` + strings.Repeat("x", 4096) + `"}`)
			wire := zhijingEncodeIngress(t, encoding, plain)
			cfg := &config.Config{}
			cfg.Gateway.MaxBodySize = 128
			request := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(wire))
			request.Header.Set("Content-Encoding", encoding)
			_, err := readLenientJSONRequestBodyWithPrealloc(request, cfg)
			require.Error(t, err)
			var maxErr *http.MaxBytesError
			require.ErrorAs(t, err, &maxErr)
		})
	}
}

func zhijingEncodeIngress(t *testing.T, encoding string, plain []byte) []byte {
	t.Helper()
	switch encoding {
	case "gzip":
		var buf bytes.Buffer
		writer := gzip.NewWriter(&buf)
		_, err := writer.Write(plain)
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		return buf.Bytes()
	case "zstd":
		encoder, err := zstd.NewWriter(nil)
		require.NoError(t, err)
		defer func() { _ = encoder.Close() }()
		return encoder.EncodeAll(plain, nil)
	default:
		return plain
	}
}
