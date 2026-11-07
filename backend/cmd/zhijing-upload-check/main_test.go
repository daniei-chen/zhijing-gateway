package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
)

func TestDecodedHashAndLengthAcrossEncodings(t *testing.T) {
	body := []byte(`{"synthetic_source":"` + strings.Repeat("export const value = 42; ", 10000) + `"}`)
	var gz bytes.Buffer
	writer := gzip.NewWriter(&gz)
	_, _ = writer.Write(body)
	_ = writer.Close()
	encoder, err := zstd.NewWriter(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer encoder.Close()
	variants := map[string][]byte{"identity": body, "gzip": gz.Bytes(), "zstd": encoder.EncodeAll(body, nil)}
	for encoding, wire := range variants {
		t.Run(encoding, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/probe", bytes.NewReader(wire))
			request.Header.Set("X-Zhijing-Probe", "synthetic-token")
			request.Header.Set("Content-Encoding", encoding)
			response := httptest.NewRecorder()
			handler("synthetic-token", "/probe").ServeHTTP(response, request)
			if response.Code != 200 {
				t.Fatalf("status: %d", response.Code)
			}
			var output struct {
				WireBytes     int    `json:"wire_bytes"`
				DecodedBytes  int    `json:"decoded_bytes"`
				DecodedSHA256 string `json:"decoded_sha256"`
			}
			if json.Unmarshal(response.Body.Bytes(), &output) != nil {
				t.Fatal("invalid_result")
			}
			digest := sha256.Sum256(body)
			if output.WireBytes != len(wire) || output.DecodedBytes != len(body) || output.DecodedSHA256 != hex.EncodeToString(digest[:]) {
				t.Fatal("decoded_content_not_identical")
			}
		})
	}
}

type brokenBody struct{}

func (brokenBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (brokenBody) Close() error             { return nil }

func TestProbeRejectsUnauthenticatedMalformedAndTruncatedBodies(t *testing.T) {
	for _, item := range []struct {
		name, path, token, method, encoding, body string
		broken                                    bool
		status                                    int
	}{
		{name: "wrong_token", path: "/probe", token: "wrong", method: "POST", body: "{}", status: 404},
		{name: "wrong_path", path: "/else", token: "token", method: "POST", body: "{}", status: 404},
		{name: "get", path: "/probe", token: "token", method: "GET", status: 405},
		{name: "bad_gzip", path: "/probe", token: "token", method: "POST", encoding: "gzip", body: "not-gzip", status: 400},
		{name: "bad_json", path: "/probe", token: "token", method: "POST", body: "{", status: 400},
		{name: "truncated", path: "/probe", token: "token", method: "POST", broken: true, status: 400},
	} {
		t.Run(item.name, func(t *testing.T) {
			request := httptest.NewRequest(item.method, item.path, strings.NewReader(item.body))
			request.Header.Set("X-Zhijing-Probe", item.token)
			request.Header.Set("Content-Encoding", item.encoding)
			if item.broken {
				request.Body = brokenBody{}
			}
			response := httptest.NewRecorder()
			handler("token", "/probe").ServeHTTP(response, request)
			if response.Code != item.status {
				t.Fatalf("expected %d, got %d", item.status, response.Code)
			}
		})
	}
}
