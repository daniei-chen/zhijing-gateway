package web

import (
	"path"
	"strings"
)

// staticAssetExtensions 是「找不到就必须 404、绝不能回退成 index.html」的扩展名。
//
// 只列真正由构建产物提供的静态类型。SPA 路由里带点的路径（例如 /user/john.doe）
// 不会落到这里，仍然回退到 index.html，所以前端路由不受影响。
var staticAssetExtensions = map[string]struct{}{
	".js": {}, ".mjs": {}, ".cjs": {}, ".css": {}, ".map": {},
	".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {}, ".svg": {}, ".webp": {}, ".avif": {}, ".ico": {}, ".bmp": {},
	".woff": {}, ".woff2": {}, ".ttf": {}, ".otf": {}, ".eot": {},
	".json": {}, ".txt": {}, ".webmanifest": {}, ".wasm": {},
}

// hasStaticAssetExtension 报告路径是否以静态资源扩展名结尾（大小写不敏感）。
func hasStaticAssetExtension(p string) bool {
	ext := strings.ToLower(path.Ext(strings.TrimSpace(p)))
	if ext == "" {
		return false
	}
	_, ok := staticAssetExtensions[ext]
	return ok
}

// shouldServeIndexFallback 决定这个请求该不该回退到 index.html。
//
// 2026-11-15：原实现只要文件不存在就返回 index.html（HTTP 200）。于是请求一个不存在的
// /assets/xxx.js 会拿到 HTML，浏览器按 JS 解析直接语法错误、页面白屏；更糟的是 200 表示
// 「成功」，浏览器不会重试，缓存里旧的 index.html 去请求新 hash 的 chunk 时就会一直白屏——
// 看起来就像「发版之后打不开了」。
//
// 现在的规则：
//   - 空路径和 index.html 本身 → 回退（首页）
//   - 文件存在 → 不回退（交给静态文件服务）
//   - 文件不存在且是静态资源扩展名 → 不回退（调用方返回 404）
//   - 其余（前端路由，可能带点但不是静态资源）→ 回退
func shouldServeIndexFallback(cleanPath string, exists bool) bool {
	trimmed := strings.TrimSpace(cleanPath)
	if trimmed == "" || trimmed == "index.html" {
		return true
	}
	if exists {
		return false
	}
	return !hasStaticAssetExtension(trimmed)
}
