package handler

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// usageRecordSubmitFunnelWhitelist 是允许直接调用 usageRecordWorkerPool.Submit 的
// (文件, 函数) 白名单：只有计费漏斗本身可以提交任务。
//
// 为什么要有这条守卫：池的 drop/sample 策略会返回 DROPPED，而计费任务不允许被丢弃。
// 如果将来新增端点图省事直接调 pool.Submit，它就会绕过漏斗的内联兜底，静默丢费的洞
// 原地复活，而且不会有任何测试变红。这里用 AST 扫描把「复活路径」堵死。
//
// 已知边界：它只认 `x.usageRecordWorkerPool.Submit(...)` 这一种写法；先把池赋给局部
// 变量再 Submit 的绕法抓不到——那种写法在 code review 里也不该通过。
var usageRecordSubmitFunnelWhitelist = map[string]map[string]bool{
	"gateway_handler.go": {
		"submitUsageRecordTask":          true,
		"submitMandatoryUsageRecordTask": true,
	},
	"openai_gateway_handler.go": {
		"submitUsageRecordTask":          true,
		"submitMandatoryUsageRecordTask": true,
	},
}

func TestUsageRecordSubmitOnlyThroughFunnel(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	handlerDir := filepath.Dir(filename)
	internalRoot := filepath.Clean(filepath.Join(handlerDir, ".."))

	found := make(map[string]map[string]bool)
	fileSet := token.NewFileSet()
	require.NoError(t, filepath.WalkDir(internalRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fileSet, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			relativeToHandler, err := filepath.Rel(handlerDir, path)
			require.NoError(t, err)
			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				method, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || method.Sel.Name != "Submit" {
					return true
				}
				pool, ok := method.X.(*ast.SelectorExpr)
				if !ok || pool.Sel.Name != "usageRecordWorkerPool" {
					return true
				}
				allowed := usageRecordSubmitFunnelWhitelist[relativeToHandler]
				if !allowed[function.Name.Name] {
					t.Errorf("%s: %s calls usageRecordWorkerPool.Submit directly; billing submissions must go through the funnel (submitUsageRecordTask / submitMandatoryUsageRecordTask) so DROPPED tasks still run inline",
						fileSet.Position(call.Pos()), function.Name.Name)
				}
				if found[relativeToHandler] == nil {
					found[relativeToHandler] = make(map[string]bool)
				}
				found[relativeToHandler][function.Name.Name] = true
				return true
			})
		}
		return nil
	}))

	// 白名单里的漏斗必须真的存在且在提交，否则改名会让这条守卫悄悄失效。
	for file, functions := range usageRecordSubmitFunnelWhitelist {
		for function := range functions {
			require.Truef(t, found[file][function],
				"whitelisted funnel %s in %s no longer calls usageRecordWorkerPool.Submit; update the whitelist instead of leaving this guard vacuous", function, file)
		}
	}
}
