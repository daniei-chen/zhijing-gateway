// Package metrics 是一个极简的进程内指标注册表。
//
// 刻意不引入 prometheus/client_golang：这里只需要暴露几个计数器，手写 Prometheus
// 文本格式（每行一个 sample）就够，省掉一整条依赖链和它的传递依赖。
//
// 全部用 atomic.Int64，读路径无锁；采集方按 Prometheus 的套路定期抓取，
// 进程重启后计数归零也是允许的（counter 语义本就允许重置）。
package metrics

import (
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

var (
	processStart = time.Now()

	requestsTotal atomic.Int64

	class1xx atomic.Int64
	class2xx atomic.Int64
	class3xx atomic.Int64
	class4xx atomic.Int64
	class5xx atomic.Int64
)

// ObserveRequest 记录一次 HTTP 响应。status 取的是最终写出的状态码
// （gin 的 c.Writer.Status()），流式响应被中断时通常是 200，这类错误由
// 上游错误日志的 stream_ok 指标覆盖，不在这里重复计。
func ObserveRequest(status int) {
	requestsTotal.Add(1)
	switch {
	case status >= 500:
		class5xx.Add(1)
	case status >= 400:
		class4xx.Add(1)
	case status >= 300:
		class3xx.Add(1)
	case status >= 200:
		class2xx.Add(1)
	default:
		class1xx.Add(1)
	}
}

// RequestsTotal 返回自进程启动以来的请求总数（供测试与内部使用）。
func RequestsTotal() int64 { return requestsTotal.Load() }

// Render 输出 Prometheus 文本格式（version 0.0.4）。
func Render() string {
	var b strings.Builder
	b.Grow(512)

	writeSample(&b, "zhijing_uptime_seconds", "process uptime in seconds",
		strconv.FormatFloat(time.Since(processStart).Seconds(), 'f', 0, 64))

	writeSample(&b, "zhijing_http_requests_total", "total HTTP responses by status class",
		strconv.FormatInt(requestsTotal.Load(), 10))

	for _, row := range []struct {
		class string
		value *atomic.Int64
	}{
		{"1xx", &class1xx},
		{"2xx", &class2xx},
		{"3xx", &class3xx},
		{"4xx", &class4xx},
		{"5xx", &class5xx},
	} {
		b.WriteString("zhijing_http_requests_by_class_total{class=\"")
		b.WriteString(row.class)
		b.WriteString("\"} ")
		b.WriteString(strconv.FormatInt(row.value.Load(), 10))
		b.WriteString("\n")
	}

	writeSample(&b, "zhijing_go_goroutines", "number of goroutines",
		strconv.Itoa(runtime.NumGoroutine()))

	return b.String()
}

func writeSample(b *strings.Builder, name, help, value string) {
	b.WriteString("# HELP ")
	b.WriteString(name)
	b.WriteString(" ")
	b.WriteString(help)
	b.WriteString("\n# TYPE ")
	b.WriteString(name)
	b.WriteString(" counter\n")
	b.WriteString(name)
	b.WriteString(" ")
	b.WriteString(value)
	b.WriteString("\n")
}
