package main

//go:generate go run github.com/google/wire/cmd/wire

import (
	"context"
	_ "embed"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/daniei-chen/zhijing-gateway/ent/runtime"
	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/handler"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/logger"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/setup"
	"github.com/daniei-chen/zhijing-gateway/internal/web"

	"github.com/gin-gonic/gin"
)

//go:embed VERSION
var embeddedVersion string

// Build-time variables (can be set by ldflags)
var (
	Version   = ""
	Commit    = "unknown"
	Date      = "unknown"
	BuildType = "source" // "source" for manual builds, "release" for CI builds (set by ldflags)
)

func init() {
	// 如果 Version 已通过 ldflags 注入（例如 -X main.Version=...），则不要覆盖。
	if strings.TrimSpace(Version) != "" {
		return
	}

	// 默认从 embedded VERSION 文件读取版本号（编译期打包进二进制）。
	Version = strings.TrimSpace(embeddedVersion)
	if Version == "" {
		Version = "0.0.0-dev"
	}
}

// initLogger configures the default slog handler based on gin.Mode().
// In non-release mode, Debug level logs are enabled.
func main() {
	logger.InitBootstrap()
	defer logger.Sync()

	// Parse command line flags
	setupMode := flag.Bool("setup", false, "Run setup wizard in CLI mode")
	showVersion := flag.Bool("version", false, "Show version information")
	flag.Parse()

	if *showVersion {
		log.Printf("智境网关 %s (commit: %s, built: %s)\n", Version, Commit, Date)
		return
	}

	// CLI setup mode
	if *setupMode {
		if err := setup.RunCLI(); err != nil {
			log.Fatalf("Setup failed: %v", err)
		}
		return
	}

	// Check if setup is needed
	if setup.NeedsSetup() {
		// Check if auto-setup is enabled (for Docker deployment)
		if setup.AutoSetupEnabled() {
			log.Println("Auto setup mode enabled...")
			if err := setup.AutoSetupFromEnv(); err != nil {
				log.Fatalf("Auto setup failed: %v", err)
			}
			// Continue to main server after auto-setup
		} else {
			log.Println("First run detected, starting setup wizard...")
			runSetupServer()
			return
		}
	}

	// Normal server mode
	runMainServer()
}

func runSetupServer() {
	r := gin.New()
	r.Use(middleware.Recovery())
	r.Use(middleware.CORS(config.CORSConfig{}))
	r.Use(middleware.SecurityHeaders(config.CSPConfig{Enabled: true, Policy: config.DefaultCSPPolicy}, nil))

	// Register setup routes
	setup.RegisterRoutes(r)

	// Serve embedded frontend if available
	if web.HasEmbeddedFrontend() {
		r.Use(web.ServeEmbeddedFrontend())
	}

	// Get server address from config.yaml or environment variables (SERVER_HOST, SERVER_PORT)
	// This allows users to run setup on a different address if needed, but the
	// wizard hands out administrator rights, so it stays on loopback by default.
	setupAddr := config.GetSetupServerAddress()
	if setupAddr.Explicit && !config.IsLoopbackHost(setupAddr.Host) {
		log.Printf(
			"WARNING: setup wizard is bound to %s, which is reachable from other hosts. Anyone who can reach it and read the setup token can become the administrator. Leave SERVER_HOST/server.host unset to keep it on 127.0.0.1 and use an SSH tunnel instead: ssh -L %d:127.0.0.1:%d <user>@<server>",
			setupAddr.Address, setupAddr.Port, setupAddr.Port,
		)
	}

	token, err := setup.EnsureSetupToken()
	if err != nil {
		log.Fatalf("Failed to create setup token: %v", err)
	}

	log.Printf("Setup wizard listening on http://%s", setupAddr.Address)
	log.Printf("Setup token: %s (also written to %s)", token, setup.GetSetupTokenPath())
	log.Printf("Open the wizard at http://127.0.0.1:%d/setup?setup_token=%s", setupAddr.Port, token)
	log.Printf("From another machine, forward the port first: ssh -L %d:127.0.0.1:%d <user>@<server>", setupAddr.Port, setupAddr.Port)
	log.Println("Complete the setup wizard to configure 智境网关")

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	server := &http.Server{
		Addr:              setupAddr.Address,
		Handler:           r,
		ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout:       120 * time.Second,
		Protocols:         protocols,
	}

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Failed to start setup server: %v", err)
	}
}

func runMainServer() {
	cfg, err := config.LoadForBootstrap()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	if err := logger.Init(logger.OptionsFromConfig(cfg.Log)); err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	if cfg.RunMode == config.RunModeSimple {
		log.Println("⚠️  WARNING: Running in SIMPLE mode - billing and quota checks are DISABLED")
	}

	buildInfo := handler.BuildInfo{
		Version:   Version,
		BuildType: BuildType,
		// Commit / Date 由构建脚本通过 -X 注入；漏注入时端点上会显示 unknown，
		// 而不是把空字符串当成「没有这一版」。
		Commit:    Commit,
		BuildTime: Date,
	}

	app, err := initializeApplication(buildInfo)
	if err != nil {
		log.Fatalf("Failed to initialize application: %v", err)
	}
	defer app.Cleanup()
	if app.PluginManager != nil {
		if err := app.PluginManager.Start(context.Background()); err != nil {
			log.Printf("Plugin manager started in degraded state: %v", err)
		}
	}
	if app.PromptAudit != nil {
		if err := app.PromptAudit.Start(context.Background()); err != nil {
			// Startup continues so unrelated APIs stay up. Fail-closed (unavailable)
			// applies only when a persisted blocking policy was observed; without
			// blocking intent, Prompt Audit stays ModeOff so the gateway remains
			// usable and administrators can still disable the feature (#4560).
			log.Printf("Prompt Audit started in degraded state: %v", err)
		}
	}

	// 启动服务器
	go func() {
		if err := app.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Printf("Server started on %s", app.Server.Addr)

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout())
	defer cancel()

	if err := app.Server.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

// defaultShutdownTimeout 略小于 Docker 默认的 10 秒停止超时。
// http.Server.Shutdown 超时后会强制断开仍在进行的响应，而推理流量是流式的，
// 一次回答动辄十几秒；把窗口留在 10 秒以内，是为了拿到「优雅退出」而不是
// 在 10 秒整被 SIGKILL 掐断。需要更长的排空时间时，同步把容器/编排的
// stop grace period 调大，再用 SHUTDOWN_TIMEOUT_SECONDS 指定。
const defaultShutdownTimeout = 8 * time.Second

// maxShutdownTimeout 是对配置的上限保护：停止超时配得太离谱会让一次
// 发布卡住不动，运维只会看到「服务停不下来」。
const maxShutdownTimeout = 600 * time.Second

// shutdownTimeout 解析 SHUTDOWN_TIMEOUT_SECONDS。取值非法或越界时回落到默认值，
// 不因为一个写错的变量让进程停不下来。
func shutdownTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SHUTDOWN_TIMEOUT_SECONDS"))
	if raw == "" {
		return defaultShutdownTimeout
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return defaultShutdownTimeout
	}
	timeout := time.Duration(seconds) * time.Second
	if timeout > maxShutdownTimeout {
		return maxShutdownTimeout
	}
	return timeout
}
