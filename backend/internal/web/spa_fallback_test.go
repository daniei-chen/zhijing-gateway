//go:build unit

package web

import "testing"

// 缺失的静态资源必须返回 404，不能回退成 index.html。
// 否则浏览器把 HTML 当 JS 解析，页面白屏且因 200 不会重试。
func TestShouldServeIndexFallback_StaticAssetMissing(t *testing.T) {
	for _, p := range []string{
		"assets/index-abc.js",
		"assets/vendor-excel.js",
		"assets/app.css",
		"assets/logo.svg",
		"assets/font.woff2",
		"data/pricing.json",
	} {
		if shouldServeIndexFallback(p, false) {
			t.Fatalf("%q: missing static asset must NOT fall back to index.html", p)
		}
	}
}

// 存在的静态资源走文件服务，同样不回退。
func TestShouldServeIndexFallback_StaticAssetExists(t *testing.T) {
	for _, p := range []string{"assets/index-abc.js", "assets/app.css"} {
		if shouldServeIndexFallback(p, true) {
			t.Fatalf("%q: existing asset must be served directly", p)
		}
	}
}

// 前端路由（含带点但不是静态资源的）继续回退到 index.html。
func TestShouldServeIndexFallback_FrontendRoutes(t *testing.T) {
	for _, p := range []string{
		"groups",
		"admin/settings",
		"user/john.doe",
		"keys/123",
		"",
		"index.html",
	} {
		if !shouldServeIndexFallback(p, false) {
			t.Fatalf("%q: frontend route must fall back to index.html", p)
		}
	}
}

func TestHasStaticAssetExtension(t *testing.T) {
	yes := []string{"a.js", "a.JS", "a.css", "a.png", "a.woff2", "a.json", "dir/b.webmanifest"}
	for _, p := range yes {
		if !hasStaticAssetExtension(p) {
			t.Fatalf("%q should be treated as a static asset", p)
		}
	}
	no := []string{"groups", "john.doe", "v1/responses", "index.html", "", "a."}
	for _, p := range no {
		if hasStaticAssetExtension(p) {
			t.Fatalf("%q should NOT be treated as a static asset", p)
		}
	}
}
