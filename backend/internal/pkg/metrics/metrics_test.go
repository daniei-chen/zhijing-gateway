//go:build unit

package metrics

import (
	"strings"
	"testing"
)

func TestObserveRequestCountsByClass(t *testing.T) {
	before := RequestsTotal()

	ObserveRequest(200)
	ObserveRequest(201)
	ObserveRequest(304)
	ObserveRequest(404)
	ObserveRequest(500)

	if got := RequestsTotal() - before; got != 5 {
		t.Fatalf("expected 5 new observations, got %d", got)
	}

	out := Render()
	for _, want := range []string{
		`zhijing_http_requests_by_class_total{class="2xx"}`,
		`zhijing_http_requests_by_class_total{class="3xx"}`,
		`zhijing_http_requests_by_class_total{class="4xx"}`,
		`zhijing_http_requests_by_class_total{class="5xx"}`,
		"zhijing_uptime_seconds",
		"zhijing_go_goroutines",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("render output missing %q:\n%s", want, out)
		}
	}
}

// 输出必须是 Prometheus 文本格式能解析的形状：每个 sample 一行 name value。
func TestRenderIsLineOriented(t *testing.T) {
	ObserveRequest(200)
	out := Render()
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#") {
			if !strings.HasPrefix(line, "# HELP ") && !strings.HasPrefix(line, "# TYPE ") {
				t.Fatalf("unexpected comment line: %q", line)
			}
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			t.Fatalf("sample line must be 'name value', got %q", line)
		}
	}
}
