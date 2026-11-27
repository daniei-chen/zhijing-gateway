//go:build unit

package routes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/handler"
	adminhandler "github.com/daniei-chen/zhijing-gateway/internal/handler/admin"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// adminStepUpClassification 是每条管理路由的 step-up 判定：
// 强制项挂 forcedStepUpAuth（不读 settings.step_up_enabled），其余继续由全局开关决定。
// 判据与逐条理由见 deploy/ADMIN_STEP_UP.md；新增管理端点必须在这里显式判定，否则
// TestEveryAdminRouteHasStepUpClassification 失败。
var adminStepUpClassification = map[string]string{
	"DELETE /api/v1/admin/affiliates/users/:user_id":                                        stepUpMoney,
	"DELETE /api/v1/admin/backups/:id":                                                      stepUpEvidence,
	"DELETE /api/v1/admin/channels/:id":                                                     stepUpMoney,
	"DELETE /api/v1/admin/groups/:id/rate-multipliers":                                      stepUpMoney,
	"DELETE /api/v1/admin/payment/plans/:id":                                                stepUpMoney,
	"DELETE /api/v1/admin/payment/providers/:id":                                            stepUpMoney,
	"DELETE /api/v1/admin/plugins/:id":                                                      stepUpReplaceService,
	"DELETE /api/v1/admin/promo-codes/:id":                                                  stepUpMoney,
	"DELETE /api/v1/admin/prompt-audit/events/:id":                                          stepUpEvidence,
	"DELETE /api/v1/admin/redeem-codes/:id":                                                 stepUpMoney,
	"DELETE /api/v1/admin/risk-control/hashes/all":                                          stepUpEvidence,
	"DELETE /api/v1/admin/settings/admin-api-key":                                           stepUpPrivilege,
	"DELETE /api/v1/admin/settings/admin-api-keys/:id":                                      stepUpPrivilege,
	"DELETE /api/v1/admin/settings/admin-api-keys/:id/record":                               stepUpPrivilege,
	"DELETE /api/v1/admin/subscriptions/:id":                                                stepUpMoney,
	"DELETE /api/v1/admin/users/:id":                                                        stepUpPrivilege,
	"GET /api/v1/admin/accounts/data":                                                       stepUpCredentialEgress,
	"GET /api/v1/admin/backups/:id/download-url":                                            stepUpCredentialEgress,
	"GET /api/v1/admin/proxies/data":                                                        stepUpCredentialEgress,
	"GET /api/v1/admin/redeem-codes/export":                                                 stepUpMoney,
	"POST /api/v1/admin/accounts/batch-update-credentials":                                  stepUpCredentialEgress,
	"POST /api/v1/admin/accounts/data":                                                      stepUpCredentialEgress,
	"POST /api/v1/admin/affiliates/users/:user_id/withdraw":                                 stepUpMoney,
	"POST /api/v1/admin/affiliates/users/batch-rate":                                        stepUpMoney,
	"POST /api/v1/admin/backups":                                                            stepUpCredentialEgress,
	"POST /api/v1/admin/backups/:id/restore":                                                stepUpCredentialEgress,
	"POST /api/v1/admin/channels":                                                           stepUpMoney,
	"POST /api/v1/admin/data-management/backups":                                            stepUpCredentialEgress,
	"POST /api/v1/admin/data-management/s3/profiles":                                        stepUpCredentialEgress,
	"POST /api/v1/admin/data-management/s3/profiles/:profile_id/activate":                   stepUpCredentialEgress,
	"POST /api/v1/admin/ops/system-logs/cleanup":                                            stepUpEvidence,
	"POST /api/v1/admin/payment/orders/:id/cancel":                                          stepUpMoney,
	"POST /api/v1/admin/payment/orders/:id/refund":                                          stepUpMoney,
	"POST /api/v1/admin/payment/orders/:id/refund/query":                                    stepUpMoney,
	"POST /api/v1/admin/payment/orders/:id/retry":                                           stepUpMoney,
	"POST /api/v1/admin/payment/plans":                                                      stepUpMoney,
	"POST /api/v1/admin/payment/providers":                                                  stepUpMoney,
	"POST /api/v1/admin/plugins/:id/disable":                                                stepUpReplaceService,
	"POST /api/v1/admin/plugins/:id/enable":                                                 stepUpReplaceService,
	"POST /api/v1/admin/plugins/:id/test":                                                   stepUpReplaceService,
	"POST /api/v1/admin/plugins/upload":                                                     stepUpReplaceService,
	"POST /api/v1/admin/promo-codes":                                                        stepUpMoney,
	"POST /api/v1/admin/prompt-audit/events/batch-delete":                                   stepUpEvidence,
	"POST /api/v1/admin/prompt-audit/events/delete-by-filter":                               stepUpEvidence,
	"POST /api/v1/admin/proxies/data":                                                       stepUpCredentialEgress,
	"POST /api/v1/admin/redeem-codes/:id/expire":                                            stepUpMoney,
	"POST /api/v1/admin/redeem-codes/batch-delete":                                          stepUpMoney,
	"POST /api/v1/admin/redeem-codes/batch-update":                                          stepUpMoney,
	"POST /api/v1/admin/redeem-codes/create-and-redeem":                                     stepUpMoney,
	"POST /api/v1/admin/redeem-codes/generate":                                              stepUpMoney,
	"POST /api/v1/admin/settings/admin-api-key/regenerate":                                  stepUpPrivilege,
	"POST /api/v1/admin/settings/admin-api-keys":                                            stepUpPrivilege,
	"POST /api/v1/admin/settings/admin-api-keys/:id/rotate":                                 stepUpPrivilege,
	"POST /api/v1/admin/subscriptions/:id/extend":                                           stepUpMoney,
	"POST /api/v1/admin/subscriptions/:id/extend/replay":                                    stepUpMoney,
	"POST /api/v1/admin/subscriptions/:id/reset-quota":                                      stepUpMoney,
	"POST /api/v1/admin/subscriptions/:id/restore":                                          stepUpMoney,
	"POST /api/v1/admin/subscriptions/:id/revoke":                                           stepUpMoney,
	"POST /api/v1/admin/subscriptions/assign":                                               stepUpMoney,
	"POST /api/v1/admin/subscriptions/bulk-action":                                          stepUpMoney,
	"POST /api/v1/admin/subscriptions/bulk-action/replay":                                   stepUpMoney,
	"POST /api/v1/admin/subscriptions/bulk-assign":                                          stepUpMoney,
	"POST /api/v1/admin/system/restart":                                                     stepUpReplaceService,
	"POST /api/v1/admin/system/rollback":                                                    stepUpReplaceService,
	"POST /api/v1/admin/usage/cleanup-tasks":                                                stepUpEvidence,
	"POST /api/v1/admin/users":                                                              stepUpPrivilege,
	"POST /api/v1/admin/users/:id/auth-identities":                                          stepUpPrivilege,
	"POST /api/v1/admin/users/:id/balance":                                                  stepUpMoney,
	"POST /api/v1/admin/users/:id/balance/replay":                                           stepUpMoney,
	"PUT /api/v1/admin/affiliates/users/:user_id":                                           stepUpMoney,
	"PUT /api/v1/admin/backups/image-storage":                                               stepUpCredentialEgress,
	"PUT /api/v1/admin/backups/s3-config":                                                   stepUpCredentialEgress,
	"PUT /api/v1/admin/channels/:id":                                                        stepUpMoney,
	"PUT /api/v1/admin/data-management/s3/profiles/:profile_id":                             stepUpCredentialEgress,
	"PUT /api/v1/admin/groups/:id/rate-multipliers":                                         stepUpMoney,
	"PUT /api/v1/admin/payment/config":                                                      stepUpMoney,
	"PUT /api/v1/admin/payment/plans/:id":                                                   stepUpMoney,
	"PUT /api/v1/admin/payment/providers/:id":                                               stepUpMoney,
	"PUT /api/v1/admin/plugins/:id/config":                                                  stepUpReplaceService,
	"PUT /api/v1/admin/promo-codes/:id":                                                     stepUpMoney,
	"PUT /api/v1/admin/settings/admin-api-keys/:id":                                         stepUpPrivilege,
	"PUT /api/v1/admin/users/:id":                                                           stepUpPrivilege,
	"DELETE /api/v1/admin/accounts/:id":                                                     notForcedAccountWrite,
	"DELETE /api/v1/admin/accounts/:id/ollama-cloud-usage/session":                          notForcedAccountOps,
	"DELETE /api/v1/admin/accounts/:id/temp-unschedulable":                                  notForcedAccountOps,
	"DELETE /api/v1/admin/announcements/:id":                                                notForcedRoutineCRUD,
	"DELETE /api/v1/admin/channel-monitor-templates/:id":                                    notForcedRoutineCRUD,
	"DELETE /api/v1/admin/channel-monitors/:id":                                             notForcedRoutineCRUD,
	"DELETE /api/v1/admin/data-management/s3/profiles/:profile_id":                          notForcedRoutineCRUD,
	"DELETE /api/v1/admin/data-management/sources/:source_type/profiles/:profile_id":        notForcedRoutineCRUD,
	"DELETE /api/v1/admin/error-passthrough-rules/:id":                                      notForcedRoutineCRUD,
	"DELETE /api/v1/admin/groups/:id":                                                       notForcedRoutineCRUD,
	"DELETE /api/v1/admin/groups/:id/composite-routes/:route_id":                            notForcedRoutineCRUD,
	"DELETE /api/v1/admin/groups/:id/rpm-overrides":                                         notForcedRoutineCRUD,
	"DELETE /api/v1/admin/ops/alert-rules/:id":                                              notForcedPolicyTuning,
	"DELETE /api/v1/admin/proxies/:id":                                                      notForcedAccountWrite,
	"DELETE /api/v1/admin/risk-control/hashes":                                              notForcedEvidenceWeak,
	"DELETE /api/v1/admin/scheduled-test-plans/:id":                                         notForcedRoutineCRUD,
	"DELETE /api/v1/admin/tls-fingerprint-profiles/:id":                                     notForcedRoutineCRUD,
	"DELETE /api/v1/admin/user-attributes/:id":                                              notForcedRoutineCRUD,
	"GET /api/v1/admin/accounts":                                                            notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id":                                                        notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/claude/reset-credits":                                   notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/grok-media-eligibility":                                 notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/models":                                                 notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/ollama-cloud-usage":                                     notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/opencode-go-usage":                                      notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/scheduled-test-plans":                                   notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/stats":                                                  notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/temp-unschedulable":                                     notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/today-stats":                                            notForcedReadOnly,
	"GET /api/v1/admin/accounts/:id/usage":                                                  notForcedReadOnly,
	"GET /api/v1/admin/accounts/antigravity/default-model-mapping":                          notForcedReadOnly,
	"GET /api/v1/admin/accounts/ollama-cloud-usage/settings":                                notForcedReadOnly,
	"GET /api/v1/admin/accounts/opencode-go-usage/settings":                                 notForcedReadOnly,
	"GET /api/v1/admin/accounts/upstream-billing-probe/settings":                            notForcedReadOnly,
	"GET /api/v1/admin/accounts/upstream-billing-rates":                                     notForcedReadOnly,
	"GET /api/v1/admin/affiliates/invites":                                                  notForcedReadOnly,
	"GET /api/v1/admin/affiliates/rebates":                                                  notForcedReadOnly,
	"GET /api/v1/admin/affiliates/transfers":                                                notForcedReadOnly,
	"GET /api/v1/admin/affiliates/users":                                                    notForcedReadOnly,
	"GET /api/v1/admin/affiliates/users/:user_id/overview":                                  notForcedReadOnly,
	"GET /api/v1/admin/affiliates/users/lookup":                                             notForcedReadOnly,
	"GET /api/v1/admin/announcements":                                                       notForcedReadOnly,
	"GET /api/v1/admin/announcements/:id":                                                   notForcedReadOnly,
	"GET /api/v1/admin/announcements/:id/read-status":                                       notForcedReadOnly,
	"GET /api/v1/admin/audit-logs":                                                          notForcedReadOnly,
	"GET /api/v1/admin/audit-logs/:id":                                                      notForcedReadOnly,
	"GET /api/v1/admin/backups":                                                             notForcedReadOnly,
	"GET /api/v1/admin/backups/:id":                                                         notForcedReadOnly,
	"GET /api/v1/admin/backups/image-storage":                                               notForcedReadOnly,
	"GET /api/v1/admin/backups/s3-config":                                                   notForcedReadOnly,
	"GET /api/v1/admin/backups/schedule":                                                    notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-templates":                                           notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-templates/:id":                                       notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-templates/:id/monitors":                              notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/config":                                           notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/dimensions":                                       notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/errors":                                           notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/matrix":                                           notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/models":                                           notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/snapshot":                                         notForcedReadOnly,
	"GET /api/v1/admin/channel-monitor-v2/users":                                            notForcedReadOnly,
	"GET /api/v1/admin/channel-monitors":                                                    notForcedReadOnly,
	"GET /api/v1/admin/channel-monitors/:id":                                                notForcedReadOnly,
	"GET /api/v1/admin/channel-monitors/:id/history":                                        notForcedReadOnly,
	"GET /api/v1/admin/channels":                                                            notForcedReadOnly,
	"GET /api/v1/admin/channels/:id":                                                        notForcedReadOnly,
	"GET /api/v1/admin/channels/model-pricing":                                              notForcedReadOnly,
	"GET /api/v1/admin/channels/pricing/sync-models":                                        notForcedPolicyTuning,
	"GET /api/v1/admin/cn-providers/accounts/:id/balance":                                   notForcedReadOnly,
	"GET /api/v1/admin/cn-providers/accounts/:id/quota":                                     notForcedReadOnly,
	"GET /api/v1/admin/compliance":                                                          notForcedReadOnly,
	"GET /api/v1/admin/dashboard/api-keys-trend":                                            notForcedReadOnly,
	"GET /api/v1/admin/dashboard/groups":                                                    notForcedReadOnly,
	"GET /api/v1/admin/dashboard/models":                                                    notForcedReadOnly,
	"GET /api/v1/admin/dashboard/realtime":                                                  notForcedReadOnly,
	"GET /api/v1/admin/dashboard/snapshot-v2":                                               notForcedReadOnly,
	"GET /api/v1/admin/dashboard/stats":                                                     notForcedReadOnly,
	"GET /api/v1/admin/dashboard/trend":                                                     notForcedReadOnly,
	"GET /api/v1/admin/dashboard/user-breakdown":                                            notForcedReadOnly,
	"GET /api/v1/admin/dashboard/users-ranking":                                             notForcedReadOnly,
	"GET /api/v1/admin/dashboard/users-trend":                                               notForcedReadOnly,
	"GET /api/v1/admin/data-management/agent/health":                                        notForcedReadOnly,
	"GET /api/v1/admin/data-management/backups":                                             notForcedReadOnly,
	"GET /api/v1/admin/data-management/backups/:job_id":                                     notForcedReadOnly,
	"GET /api/v1/admin/data-management/config":                                              notForcedReadOnly,
	"GET /api/v1/admin/data-management/s3/profiles":                                         notForcedReadOnly,
	"GET /api/v1/admin/data-management/sources/:source_type/profiles":                       notForcedReadOnly,
	"GET /api/v1/admin/error-passthrough-rules":                                             notForcedReadOnly,
	"GET /api/v1/admin/error-passthrough-rules/:id":                                         notForcedReadOnly,
	"GET /api/v1/admin/gemini/oauth/capabilities":                                           notForcedReadOnly,
	"GET /api/v1/admin/grok/accounts/:id/quota":                                             notForcedReadOnly,
	"GET /api/v1/admin/grok/oauth/capabilities":                                             notForcedReadOnly,
	"GET /api/v1/admin/grok/runtime-sanity":                                                 notForcedReadOnly,
	"GET /api/v1/admin/groups":                                                              notForcedReadOnly,
	"GET /api/v1/admin/groups/:id":                                                          notForcedReadOnly,
	"GET /api/v1/admin/groups/:id/api-keys":                                                 notForcedReadOnly,
	"GET /api/v1/admin/groups/:id/composite-routes":                                         notForcedReadOnly,
	"GET /api/v1/admin/groups/:id/model-allowlist-candidates":                               notForcedReadOnly,
	"GET /api/v1/admin/groups/:id/rate-multipliers":                                         notForcedReadOnly,
	"GET /api/v1/admin/groups/:id/subscriptions":                                            notForcedReadOnly,
	"GET /api/v1/admin/groups/all":                                                          notForcedReadOnly,
	"GET /api/v1/admin/groups/capacity-summary":                                             notForcedReadOnly,
	"GET /api/v1/admin/groups/live-capability":                                              notForcedReadOnly,
	"GET /api/v1/admin/groups/usage-summary":                                                notForcedReadOnly,
	"GET /api/v1/admin/openai/accounts/:id/quota":                                           notForcedReadOnly,
	"GET /api/v1/admin/ops/account-availability":                                            notForcedReadOnly,
	"GET /api/v1/admin/ops/advanced-settings":                                               notForcedReadOnly,
	"GET /api/v1/admin/ops/alert-events":                                                    notForcedReadOnly,
	"GET /api/v1/admin/ops/alert-events/:id":                                                notForcedReadOnly,
	"GET /api/v1/admin/ops/alert-rules":                                                     notForcedReadOnly,
	"GET /api/v1/admin/ops/auth-cache-invalidation/health":                                  notForcedReadOnly,
	"GET /api/v1/admin/ops/concurrency":                                                     notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/error-distribution":                                    notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/error-trend":                                           notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/latency-histogram":                                     notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/openai-token-stats":                                    notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/overview":                                              notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/snapshot-v2":                                           notForcedReadOnly,
	"GET /api/v1/admin/ops/dashboard/throughput-trend":                                      notForcedReadOnly,
	"GET /api/v1/admin/ops/email-notification/config":                                       notForcedReadOnly,
	"GET /api/v1/admin/ops/errors":                                                          notForcedReadOnly,
	"GET /api/v1/admin/ops/errors/:id":                                                      notForcedReadOnly,
	"GET /api/v1/admin/ops/ingress-rejections":                                              notForcedReadOnly,
	"GET /api/v1/admin/ops/ingress-rejections/health":                                       notForcedReadOnly,
	"GET /api/v1/admin/ops/realtime-traffic":                                                notForcedReadOnly,
	"GET /api/v1/admin/ops/request-errors":                                                  notForcedReadOnly,
	"GET /api/v1/admin/ops/request-errors/:id":                                              notForcedReadOnly,
	"GET /api/v1/admin/ops/request-errors/:id/upstream-errors":                              notForcedReadOnly,
	"GET /api/v1/admin/ops/requests":                                                        notForcedReadOnly,
	"GET /api/v1/admin/ops/runtime/alert":                                                   notForcedReadOnly,
	"GET /api/v1/admin/ops/runtime/logging":                                                 notForcedReadOnly,
	"GET /api/v1/admin/ops/settings/metric-thresholds":                                      notForcedReadOnly,
	"GET /api/v1/admin/ops/system-logs":                                                     notForcedReadOnly,
	"GET /api/v1/admin/ops/system-logs/health":                                              notForcedReadOnly,
	"GET /api/v1/admin/ops/upstream-errors":                                                 notForcedReadOnly,
	"GET /api/v1/admin/ops/upstream-errors/:id":                                             notForcedReadOnly,
	"GET /api/v1/admin/ops/user-concurrency":                                                notForcedReadOnly,
	"GET /api/v1/admin/ops/ws/qps":                                                          notForcedReadOnly,
	"GET /api/v1/admin/payment/config":                                                      notForcedReadOnly,
	"GET /api/v1/admin/payment/dashboard":                                                   notForcedReadOnly,
	"GET /api/v1/admin/payment/orders":                                                      notForcedReadOnly,
	"GET /api/v1/admin/payment/orders/:id":                                                  notForcedReadOnly,
	"GET /api/v1/admin/payment/plans":                                                       notForcedReadOnly,
	"GET /api/v1/admin/payment/providers":                                                   notForcedReadOnly,
	"GET /api/v1/admin/plugins":                                                             notForcedReadOnly,
	"GET /api/v1/admin/plugins/:id":                                                         notForcedReadOnly,
	"GET /api/v1/admin/plugins/:id/config":                                                  notForcedReadOnly,
	"GET /api/v1/admin/plugins/:id/status":                                                  notForcedReadOnly,
	"GET /api/v1/admin/promo-codes":                                                         notForcedReadOnly,
	"GET /api/v1/admin/promo-codes/:id":                                                     notForcedReadOnly,
	"GET /api/v1/admin/promo-codes/:id/usages":                                              notForcedReadOnly,
	"GET /api/v1/admin/prompt-audit/config":                                                 notForcedReadOnly,
	"GET /api/v1/admin/prompt-audit/events":                                                 notForcedReadOnly,
	"GET /api/v1/admin/prompt-audit/events/:id":                                             notForcedReadOnly,
	"GET /api/v1/admin/prompt-audit/runtime":                                                notForcedReadOnly,
	"GET /api/v1/admin/proxies":                                                             notForcedReadOnly,
	"GET /api/v1/admin/proxies/:id":                                                         notForcedReadOnly,
	"GET /api/v1/admin/proxies/:id/accounts":                                                notForcedReadOnly,
	"GET /api/v1/admin/proxies/:id/stats":                                                   notForcedReadOnly,
	"GET /api/v1/admin/proxies/all":                                                         notForcedReadOnly,
	"GET /api/v1/admin/redeem-codes":                                                        notForcedReadOnly,
	"GET /api/v1/admin/redeem-codes/:id":                                                    notForcedReadOnly,
	"GET /api/v1/admin/redeem-codes/stats":                                                  notForcedReadOnly,
	"GET /api/v1/admin/risk-control/config":                                                 notForcedReadOnly,
	"GET /api/v1/admin/risk-control/logs":                                                   notForcedReadOnly,
	"GET /api/v1/admin/risk-control/status":                                                 notForcedReadOnly,
	"GET /api/v1/admin/scheduled-test-plans/:id/results":                                    notForcedReadOnly,
	"GET /api/v1/admin/settings":                                                            notForcedReadOnly,
	"GET /api/v1/admin/settings/admin-api-key":                                              notForcedReadOnly,
	"GET /api/v1/admin/settings/admin-api-keys":                                             notForcedReadOnly,
	"GET /api/v1/admin/settings/beta-policy":                                                notForcedReadOnly,
	"GET /api/v1/admin/settings/email-templates":                                            notForcedReadOnly,
	"GET /api/v1/admin/settings/email-templates/:event/:locale":                             notForcedReadOnly,
	"GET /api/v1/admin/settings/openai-images-oauth-unavailable-cooldown":                   notForcedReadOnly,
	"GET /api/v1/admin/settings/overload-cooldown":                                          notForcedReadOnly,
	"GET /api/v1/admin/settings/panel-rate-limit":                                           notForcedReadOnly,
	"GET /api/v1/admin/settings/rate-limit-429-cooldown":                                    notForcedReadOnly,
	"GET /api/v1/admin/settings/rectifier":                                                  notForcedReadOnly,
	"GET /api/v1/admin/settings/registration-email-blacklist":                               notForcedReadOnly,
	"GET /api/v1/admin/settings/stream-timeout":                                             notForcedReadOnly,
	"GET /api/v1/admin/settings/web-search-emulation":                                       notForcedReadOnly,
	"GET /api/v1/admin/subscriptions":                                                       notForcedReadOnly,
	"GET /api/v1/admin/subscriptions/:id":                                                   notForcedReadOnly,
	"GET /api/v1/admin/subscriptions/:id/progress":                                          notForcedReadOnly,
	"GET /api/v1/admin/system/check-updates":                                                notForcedReadOnly,
	"GET /api/v1/admin/system/rollback-versions":                                            notForcedReadOnly,
	"GET /api/v1/admin/system/version":                                                      notForcedReadOnly,
	"GET /api/v1/admin/tls-fingerprint-profiles":                                            notForcedReadOnly,
	"GET /api/v1/admin/tls-fingerprint-profiles/:id":                                        notForcedReadOnly,
	"GET /api/v1/admin/usage":                                                               notForcedReadOnly,
	"GET /api/v1/admin/usage/cleanup-tasks":                                                 notForcedReadOnly,
	"GET /api/v1/admin/usage/search-api-keys":                                               notForcedReadOnly,
	"GET /api/v1/admin/usage/search-users":                                                  notForcedReadOnly,
	"GET /api/v1/admin/usage/stats":                                                         notForcedReadOnly,
	"GET /api/v1/admin/user-attributes":                                                     notForcedReadOnly,
	"GET /api/v1/admin/users":                                                               notForcedReadOnly,
	"GET /api/v1/admin/users/:id":                                                           notForcedReadOnly,
	"GET /api/v1/admin/users/:id/api-keys":                                                  notForcedReadOnly,
	"GET /api/v1/admin/users/:id/attributes":                                                notForcedReadOnly,
	"GET /api/v1/admin/users/:id/balance-history":                                           notForcedReadOnly,
	"GET /api/v1/admin/users/:id/platform-quotas":                                           notForcedReadOnly,
	"GET /api/v1/admin/users/:id/rpm-status":                                                notForcedReadOnly,
	"GET /api/v1/admin/users/:id/subscriptions":                                             notForcedReadOnly,
	"GET /api/v1/admin/users/:id/usage":                                                     notForcedReadOnly,
	"POST /api/v1/admin/accounts":                                                           notForcedAccountWrite,
	"POST /api/v1/admin/accounts/:id/apply-oauth-credentials":                               notForcedAccountWrite,
	"POST /api/v1/admin/accounts/:id/claude/reset-credits/redeem":                           notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/clear-error":                                           notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/clear-rate-limit":                                      notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/duplicate":                                             notForcedAccountWrite,
	"POST /api/v1/admin/accounts/:id/models/sync-upstream":                                  notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/ollama-cloud-usage/refresh":                            notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/opencode-go-usage/refresh":                             notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/recover-state":                                         notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/refresh":                                               notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/refresh-tier":                                          notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/reset-quota":                                           notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/revert-proxy-fallback":                                 notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/schedulable":                                           notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/set-privacy":                                           notForcedAccountOps,
	"POST /api/v1/admin/accounts/:id/shadow":                                                notForcedAccountWrite,
	"POST /api/v1/admin/accounts/:id/test":                                                  notForcedDiagnostic,
	"POST /api/v1/admin/accounts/:id/upstream-billing-probe":                                notForcedAccountOps,
	"POST /api/v1/admin/accounts/batch":                                                     notForcedAccountWrite,
	"POST /api/v1/admin/accounts/batch-clear-error":                                         notForcedAccountOps,
	"POST /api/v1/admin/accounts/batch-delete":                                              notForcedAccountWrite,
	"POST /api/v1/admin/accounts/batch-refresh":                                             notForcedAccountOps,
	"POST /api/v1/admin/accounts/batch-refresh-tier":                                        notForcedAccountOps,
	"POST /api/v1/admin/accounts/bulk-update":                                               notForcedAccountWrite,
	"POST /api/v1/admin/accounts/check-mixed-channel":                                       notForcedDiagnostic,
	"POST /api/v1/admin/accounts/cookie-auth":                                               notForcedAccountWrite,
	"POST /api/v1/admin/accounts/exchange-code":                                             notForcedAccountWrite,
	"POST /api/v1/admin/accounts/exchange-setup-token-code":                                 notForcedAccountWrite,
	"POST /api/v1/admin/accounts/generate-auth-url":                                         notForcedAccountWrite,
	"POST /api/v1/admin/accounts/generate-setup-token-url":                                  notForcedAccountWrite,
	"POST /api/v1/admin/accounts/import/codex-session":                                      notForcedAccountWrite,
	"POST /api/v1/admin/accounts/models/sync-upstream-preview":                              notForcedAccountOps,
	"POST /api/v1/admin/accounts/setup-token-cookie-auth":                                   notForcedAccountWrite,
	"POST /api/v1/admin/accounts/sync/crs":                                                  notForcedAccountWrite,
	"POST /api/v1/admin/accounts/sync/crs/preview":                                          notForcedDiagnostic,
	"POST /api/v1/admin/accounts/today-stats/batch":                                         notForcedAccountOps,
	"POST /api/v1/admin/accounts/upstream-billing-probe/batch":                              notForcedAccountOps,
	"POST /api/v1/admin/accounts/usage/batch":                                               notForcedAccountOps,
	"POST /api/v1/admin/announcements":                                                      notForcedRoutineCRUD,
	"POST /api/v1/admin/antigravity/oauth/auth-url":                                         notForcedAccountWrite,
	"POST /api/v1/admin/antigravity/oauth/exchange-code":                                    notForcedAccountWrite,
	"POST /api/v1/admin/antigravity/oauth/refresh-token":                                    notForcedAccountWrite,
	"POST /api/v1/admin/audit-logs/clear":                                                   notForcedSeparateGate,
	"POST /api/v1/admin/backups/image-storage/test":                                         notForcedDiagnostic,
	"POST /api/v1/admin/backups/s3-config/test":                                             notForcedDiagnostic,
	"POST /api/v1/admin/channel-monitor-templates":                                          notForcedRoutineCRUD,
	"POST /api/v1/admin/channel-monitor-templates/:id/apply":                                notForcedRoutineCRUD,
	"POST /api/v1/admin/channel-monitors":                                                   notForcedRoutineCRUD,
	"POST /api/v1/admin/channel-monitors/:id/duplicate":                                     notForcedRoutineCRUD,
	"POST /api/v1/admin/channel-monitors/:id/run":                                           notForcedRoutineCRUD,
	"POST /api/v1/admin/compliance/accept":                                                  notForcedRoutineCRUD,
	"POST /api/v1/admin/dashboard/aggregation/backfill":                                     notForcedRoutineCRUD,
	"POST /api/v1/admin/dashboard/api-keys-usage":                                           notForcedRoutineCRUD,
	"POST /api/v1/admin/dashboard/users-usage":                                              notForcedRoutineCRUD,
	"POST /api/v1/admin/data-management/s3/test":                                            notForcedDiagnostic,
	"POST /api/v1/admin/data-management/sources/:source_type/profiles":                      notForcedRoutineCRUD,
	"POST /api/v1/admin/data-management/sources/:source_type/profiles/:profile_id/activate": notForcedRoutineCRUD,
	"POST /api/v1/admin/error-passthrough-rules":                                            notForcedRoutineCRUD,
	"POST /api/v1/admin/gemini/oauth/auth-url":                                              notForcedAccountWrite,
	"POST /api/v1/admin/gemini/oauth/exchange-code":                                         notForcedAccountWrite,
	"POST /api/v1/admin/grok/accounts/:id/refresh":                                          notForcedAccountOps,
	"POST /api/v1/admin/grok/accounts/:id/reset-quota":                                      notForcedAccountOps,
	"POST /api/v1/admin/grok/oauth/auth-url":                                                notForcedAccountWrite,
	"POST /api/v1/admin/grok/oauth/create-from-oauth":                                       notForcedAccountWrite,
	"POST /api/v1/admin/grok/oauth/exchange-code":                                           notForcedAccountWrite,
	"POST /api/v1/admin/grok/oauth/password":                                                notForcedAccountWrite,
	"POST /api/v1/admin/grok/oauth/reconcile":                                               notForcedDiagnostic,
	"POST /api/v1/admin/grok/oauth/refresh-token":                                           notForcedAccountWrite,
	"POST /api/v1/admin/grok/oauth/sso-token":                                               notForcedAccountWrite,
	"POST /api/v1/admin/grok/sso-to-oauth":                                                  notForcedAccountWrite,
	"POST /api/v1/admin/groups":                                                             notForcedRoutineCRUD,
	"POST /api/v1/admin/groups/:id/composite-routes":                                        notForcedRoutineCRUD,
	"POST /api/v1/admin/groups/:id/composite-routes/preview":                                notForcedDiagnostic,
	"POST /api/v1/admin/groups/:id/duplicate":                                               notForcedRoutineCRUD,
	"POST /api/v1/admin/openai/accounts/:id/quota/refresh":                                  notForcedAccountOps,
	"POST /api/v1/admin/openai/accounts/:id/referrals/invite":                               notForcedAccountOps,
	"POST /api/v1/admin/openai/accounts/:id/referrals/refresh":                              notForcedAccountOps,
	"POST /api/v1/admin/openai/accounts/:id/refresh":                                        notForcedAccountOps,
	"POST /api/v1/admin/openai/accounts/:id/reset-quota":                                    notForcedAccountOps,
	"POST /api/v1/admin/openai/create-from-codex-pat":                                       notForcedAccountWrite,
	"POST /api/v1/admin/openai/create-from-oauth":                                           notForcedAccountWrite,
	"POST /api/v1/admin/openai/exchange-code":                                               notForcedAccountWrite,
	"POST /api/v1/admin/openai/generate-auth-url":                                           notForcedAccountWrite,
	"POST /api/v1/admin/openai/refresh-token":                                               notForcedAccountWrite,
	"POST /api/v1/admin/ops/alert-rules":                                                    notForcedPolicyTuning,
	"POST /api/v1/admin/ops/alert-silences":                                                 notForcedPolicyTuning,
	"POST /api/v1/admin/ops/runtime/logging/reset":                                          notForcedPolicyTuning,
	"POST /api/v1/admin/plugins/:id/ui-session":                                             notForcedRoutineCRUD,
	"POST /api/v1/admin/prompt-audit/endpoints/probe":                                       notForcedDiagnostic,
	"POST /api/v1/admin/prompt-audit/events/delete-preview":                                 notForcedRoutineCRUD,
	"POST /api/v1/admin/proxies":                                                            notForcedAccountWrite,
	"POST /api/v1/admin/proxies/:id/quality-check":                                          notForcedDiagnostic,
	"POST /api/v1/admin/proxies/:id/test":                                                   notForcedDiagnostic,
	"POST /api/v1/admin/proxies/batch":                                                      notForcedAccountWrite,
	"POST /api/v1/admin/proxies/batch-delete":                                               notForcedAccountWrite,
	"POST /api/v1/admin/risk-control/api-keys/test":                                         notForcedDiagnostic,
	"POST /api/v1/admin/risk-control/users/:user_id/unban":                                  notForcedEvidenceWeak,
	"POST /api/v1/admin/scheduled-test-plans":                                               notForcedRoutineCRUD,
	"POST /api/v1/admin/settings/email-template-preview":                                    notForcedPolicyTuning,
	"POST /api/v1/admin/settings/email-templates/:event/:locale/restore-official":           notForcedRoutineCRUD,
	"POST /api/v1/admin/settings/send-test-email":                                           notForcedPolicyTuning,
	"POST /api/v1/admin/settings/test-smtp":                                                 notForcedPolicyTuning,
	"POST /api/v1/admin/settings/web-search-emulation/reset-usage":                          notForcedPolicyTuning,
	"POST /api/v1/admin/settings/web-search-emulation/test":                                 notForcedPolicyTuning,
	"POST /api/v1/admin/system/update":                                                      notForcedSeparateGate,
	"POST /api/v1/admin/tls-fingerprint-profiles":                                           notForcedRoutineCRUD,
	"POST /api/v1/admin/usage/cleanup-tasks/:id/cancel":                                     notForcedRoutineCRUD,
	"POST /api/v1/admin/user-attributes":                                                    notForcedRoutineCRUD,
	"POST /api/v1/admin/user-attributes/batch":                                              notForcedRoutineCRUD,
	"POST /api/v1/admin/users/:id/platform-quotas/reset":                                    notForcedRoutineCRUD,
	"POST /api/v1/admin/users/:id/replace-group":                                            notForcedRoutineCRUD,
	"POST /api/v1/admin/users/batch-concurrency":                                            notForcedRoutineCRUD,
	"POST /api/v1/admin/users/batch-disable":                                                notForcedRoutineCRUD,
	"POST /api/v1/admin/users/batch-limits":                                                 notForcedRoutineCRUD,
	"POST /api/v1/admin/users/blacklist-matches":                                            notForcedDiagnostic,
	"PUT /api/v1/admin/accounts/:id":                                                        notForcedAccountWrite,
	"PUT /api/v1/admin/accounts/:id/grok-media-eligibility":                                 notForcedAccountOps,
	"PUT /api/v1/admin/accounts/:id/ollama-cloud-usage/auto-refresh":                        notForcedAccountOps,
	"PUT /api/v1/admin/accounts/:id/ollama-cloud-usage/session":                             notForcedAccountOps,
	"PUT /api/v1/admin/accounts/:id/opencode-go-usage/auto-refresh":                         notForcedAccountOps,
	"PUT /api/v1/admin/accounts/:id/upstream-billing-probe":                                 notForcedAccountOps,
	"PUT /api/v1/admin/accounts/ollama-cloud-usage/settings":                                notForcedAccountOps,
	"PUT /api/v1/admin/accounts/opencode-go-usage/settings":                                 notForcedAccountOps,
	"PUT /api/v1/admin/accounts/upstream-billing-probe/settings":                            notForcedAccountOps,
	"PUT /api/v1/admin/announcements/:id":                                                   notForcedRoutineCRUD,
	"PUT /api/v1/admin/api-keys/:id":                                                        notForcedRoutineCRUD,
	"PUT /api/v1/admin/backups/schedule":                                                    notForcedRoutineCRUD,
	"PUT /api/v1/admin/channel-monitor-templates/:id":                                       notForcedRoutineCRUD,
	"PUT /api/v1/admin/channel-monitor-v2/config":                                           notForcedRoutineCRUD,
	"PUT /api/v1/admin/channel-monitors/:id":                                                notForcedRoutineCRUD,
	"PUT /api/v1/admin/data-management/config":                                              notForcedRoutineCRUD,
	"PUT /api/v1/admin/data-management/sources/:source_type/profiles/:profile_id":           notForcedRoutineCRUD,
	"PUT /api/v1/admin/error-passthrough-rules/:id":                                         notForcedRoutineCRUD,
	"PUT /api/v1/admin/groups/:id":                                                          notForcedRoutineCRUD,
	"PUT /api/v1/admin/groups/:id/composite-routes/:route_id":                               notForcedRoutineCRUD,
	"PUT /api/v1/admin/groups/:id/rpm-overrides":                                            notForcedRoutineCRUD,
	"PUT /api/v1/admin/groups/sort-order":                                                   notForcedRoutineCRUD,
	"PUT /api/v1/admin/ops/advanced-settings":                                               notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/alert-events/:id/status":                                         notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/alert-rules/:id":                                                 notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/email-notification/config":                                       notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/errors/:id/resolve":                                              notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/request-errors/:id/resolve":                                      notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/runtime/alert":                                                   notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/runtime/logging":                                                 notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/settings/metric-thresholds":                                      notForcedPolicyTuning,
	"PUT /api/v1/admin/ops/upstream-errors/:id/resolve":                                     notForcedPolicyTuning,
	"PUT /api/v1/admin/prompt-audit/config":                                                 notForcedEvidenceWeak,
	"PUT /api/v1/admin/proxies/:id":                                                         notForcedAccountWrite,
	"PUT /api/v1/admin/risk-control/config":                                                 notForcedEvidenceWeak,
	"PUT /api/v1/admin/scheduled-test-plans/:id":                                            notForcedRoutineCRUD,
	"PUT /api/v1/admin/settings":                                                            notForcedBootstrap,
	"PUT /api/v1/admin/settings/beta-policy":                                                notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/email-templates/:event/:locale":                             notForcedRoutineCRUD,
	"PUT /api/v1/admin/settings/openai-images-oauth-unavailable-cooldown":                   notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/overload-cooldown":                                          notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/panel-rate-limit":                                           notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/rate-limit-429-cooldown":                                    notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/rectifier":                                                  notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/registration-email-blacklist":                               notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/stream-timeout":                                             notForcedPolicyTuning,
	"PUT /api/v1/admin/settings/web-search-emulation":                                       notForcedPolicyTuning,
	"PUT /api/v1/admin/tls-fingerprint-profiles/:id":                                        notForcedRoutineCRUD,
	"PUT /api/v1/admin/user-attributes/:id":                                                 notForcedRoutineCRUD,
	"PUT /api/v1/admin/user-attributes/reorder":                                             notForcedRoutineCRUD,
	"PUT /api/v1/admin/users/:id/attributes":                                                notForcedRoutineCRUD,
	"PUT /api/v1/admin/users/:id/platform-quotas":                                           notForcedRoutineCRUD,
}

const (
	stepUpReplaceService   = "S1 替换/重启运行中的服务，或装入可执行的本地插件代码"
	stepUpCredentialEgress = "S2 取出或改写上游/代理凭据、整库备份、卡密原文"
	stepUpPrivilege        = "S3 取得或授出管理员权限、接管登录身份、签发管理凭证"
	stepUpMoney            = "S4 让资金/配额/定价离开或偏离账目"
	stepUpEvidence         = "S5 不可逆销毁审计、计费或备份证据"
	notForcedReadOnly      = "不拦：只读查询/列表/统计，不返回凭据原文"
	notForcedRoutineCRUD   = "不拦：可回滚的业务对象增删改（公告/分组元数据/监控/模板/属性/错误透传/TLS 指纹/定时测试计划）"
	notForcedAccountOps    = "不拦：上游账号/代理的运维动作（刷新/清错误/额度/用量/统计/复制），可重试可回滚"
	notForcedAccountWrite  = "不拦（残留风险）：上游账号/代理的创建与凭据改写；要改变流量走向还需再配合分组调度，本 PR 未纳入，已报 owner 决定"
	notForcedDiagnostic    = "不拦：连通性/配置探测与预览，只回报结果"
	notForcedPolicyTuning  = "不拦：策略/限流/告警/日志级别调参，不改凭据、不迁资金、不销毁证据"
	notForcedBootstrap     = "不拦：TOTP 引导通道 —— totp_enabled 关闭时 PUT /admin/settings 是唯一能打开 TOTP 的入口；关闭 step-up 本身已由 handler 内 EnforceStepUpAlways 强制"
	notForcedSeparateGate  = "不拦（本门）：已由独立硬门强制 step-up —— /system/update 走 #27 三重门，/audit-logs/clear 走 handler 内现场 TOTP"
	notForcedEvidenceWeak  = "不拦（残留风险）：削弱证据采集或清理单条误报，不销毁已有证据；列入后续 body 级条件强制"
)

// adminRouteSources 是管理面路由的注册文件与分组前缀种子。
var adminRouteSources = []struct {
	file string
	seed map[string]string
}{
	{"admin.go", map[string]string{"admin": "/api/v1/admin"}},
	{"payment.go", map[string]string{"v1": "/api/v1"}},
	{"custom_admin_keys.go", map[string]string{"settings": "/api/v1/admin/settings"}},
}

var (
	adminGroupDecl = regexp.MustCompile(`^(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"\)`)
	adminRouteDecl = regexp.MustCompile(`^(\w+)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"`)
	pathParam      = regexp.MustCompile(`:[a-zA-Z_]+`)
)

// registeredAdminRoutes 从路由注册源码里取出全部管理端点（method + 完整路径）。
// 这是「不许按前缀猜」的机器兜底：注册处新增一条路由，分类表没跟上就红。
func registeredAdminRoutes(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, src := range adminRouteSources {
		raw, err := os.ReadFile(src.file)
		require.NoError(t, err)
		reset := func() map[string]string {
			prefix := map[string]string{}
			for name, p := range src.seed {
				prefix[name] = p
			}
			return prefix
		}
		prefix := reset()
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "func ") {
				prefix = reset()
				continue
			}
			if m := adminGroupDecl.FindStringSubmatch(line); m != nil {
				prefix[m[1]] = prefix[m[2]] + m[3]
				continue
			}
			m := adminRouteDecl.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			parent, ok := prefix[m[1]]
			if !ok {
				continue
			}
			path := parent + m[3]
			if !strings.HasPrefix(path, "/api/v1/admin") {
				continue
			}
			out[m[2]+" "+path] = src.file
		}
	}
	return out
}

func TestEveryAdminRouteHasStepUpClassification(t *testing.T) {
	registered := registeredAdminRoutes(t)
	require.NotEmpty(t, registered)

	unclassified := make([]string, 0)
	for route := range registered {
		if _, ok := adminStepUpClassification[route]; !ok {
			unclassified = append(unclassified, route)
		}
	}
	sort.Strings(unclassified)
	require.Empty(t, unclassified,
		"新增管理端点必须在 adminStepUpClassification 里显式判定：挂 forcedStepUpAuth，或写明不拦的理由")

	stale := make([]string, 0)
	for route := range adminStepUpClassification {
		if _, ok := registered[route]; !ok {
			stale = append(stale, route)
		}
	}
	sort.Strings(stale)
	require.Empty(t, stale, "分类表里的路由已不在注册处，删除或改正")
}

func TestAdminStepUpClassificationUsesDeclaredClasses(t *testing.T) {
	known := map[string]struct{}{
		stepUpReplaceService: {}, stepUpCredentialEgress: {}, stepUpPrivilege: {},
		stepUpMoney: {}, stepUpEvidence: {},
		notForcedReadOnly: {}, notForcedRoutineCRUD: {}, notForcedAccountOps: {},
		notForcedAccountWrite: {}, notForcedDiagnostic: {}, notForcedPolicyTuning: {},
		notForcedBootstrap: {}, notForcedSeparateGate: {}, notForcedEvidenceWeak: {},
	}
	for route, class := range adminStepUpClassification {
		_, ok := known[class]
		require.True(t, ok, "%s: 未知判定类别 %q", route, class)
	}
}

// stepUpCacheStub 只实现 HasStepUpGrant，其余 TotpCache 方法留给内嵌 nil 接口（本测试不会走到）。
type stepUpCacheStub struct {
	service.TotpCache
	granted bool
}

func (s stepUpCacheStub) HasStepUpGrant(context.Context, int64, string) (bool, error) {
	return s.granted, nil
}

type stepUpUserRepoStub struct {
	service.UserRepository
	totpEnabled bool
}

func (s stepUpUserRepoStub) GetByID(context.Context, int64) (*service.User, error) {
	return &service.User{ID: 9, Role: service.RoleAdmin, Status: service.StatusActive, TotpEnabled: s.totpEnabled}, nil
}

func (s stepUpUserRepoStub) GetUserAvatar(context.Context, int64) (*service.UserAvatar, error) {
	return nil, nil
}

// stepUpSettingRepoStub 让所有设置项都「不存在」：IsStepUpEnabled 因此返回默认 false。
type stepUpSettingRepoStub struct {
	service.SettingRepository
}

func (s stepUpSettingRepoStub) GetValue(context.Context, string) (string, error) {
	return "", service.ErrSettingNotFound
}

// newAdminStepUpTestEngine 装配真实的管理面路由，只替换认证/审计/step-up 依赖。
// settings 用空仓库 → IsStepUpEnabled 读到错误 → 返回默认 false，正是「全局开关关闭」的部署形态。
func newAdminStepUpTestEngine(t *testing.T, granted bool) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	settings := service.NewSettingService(stepUpSettingRepoStub{}, nil)
	require.False(t, settings.IsStepUpEnabled(context.Background()), "测试前提：全局 step-up 开关必须是关闭的")

	totp := service.NewTotpService(nil, nil, stepUpCacheStub{granted: granted}, settings, nil, nil)
	users := service.NewUserService(stepUpUserRepoStub{totpEnabled: true}, nil, nil, nil)

	soft := middleware.NewStepUpAuthMiddleware(totp, users, settings)
	forced := middleware.NewForcedStepUpAuthMiddleware(totp, users)

	adminAuth := middleware.AdminAuthMiddleware(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9})
		c.Set(string(middleware.ContextKeyUserRole), service.RoleAdmin)
		c.Set("auth_method", service.AuditAuthMethodJWT)
		c.Next()
	})
	audit := middleware.AuditLogMiddleware(func(c *gin.Context) { c.Next() })

	engine := gin.New()
	// handler 全部为 nil：门放行后处理器会 panic，这里把 panic 收成 500，
	// 只关心「有没有被 step-up 拦下」，不关心处理器自身行为。
	engine.Use(func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()
		c.Next()
	})

	handlers := &handler.Handlers{Admin: &handler.AdminHandlers{
		Account: &adminhandler.AccountHandler{},
		Group:   adminhandler.NewGroupHandler(nil, nil, nil),
	}}
	v1 := engine.Group("/api/v1")
	RegisterAdminRoutes(v1, handlers, adminAuth, audit, soft, forced, nil, nil)
	RegisterPaymentRoutes(v1, nil, nil, nil, nil, adminAuth, audit, forced, nil, nil, nil)
	return engine
}

func concretePath(route string) (string, string) {
	method, path, _ := strings.Cut(route, " ")
	return method, pathParam.ReplaceAllString(path, "1")
}

func serveAdminStepUp(t *testing.T, engine *gin.Engine, route string) *httptest.ResponseRecorder {
	t.Helper()
	method, path := concretePath(route)
	req := httptest.NewRequest(method, path, nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

// TestForcedStepUpDeniesWhenGlobalSwitchOff 是 DAN-48 的核心断言：
// settings.step_up_enabled=false（默认部署形态）时，强制端点仍然要求 step-up。
// 修前这些端点会被 StepUpAuthMiddleware 直接放行 —— 本用例即为「修前会红」的那条。
func TestForcedStepUpDeniesWhenGlobalSwitchOff(t *testing.T) {
	engine := newAdminStepUpTestEngine(t, false)
	forced := forcedStepUpRoutes()
	require.NotEmpty(t, forced)

	for _, route := range forced {
		w := serveAdminStepUp(t, engine, route)
		require.Equal(t, http.StatusForbidden, w.Code, "%s 未完成 step-up 却被放行：%s", route, w.Body.String())
		require.Contains(t, w.Body.String(), "STEP_UP_REQUIRED", route)
	}
}

// TestForcedStepUpAllowsVerifiedSession 是另一半：完成过 step-up 的正常会话必须能过，
// 否则「没人能管理」也算绿。处理器是 nil，放行后 panic 成 500 也算通过门。
func TestForcedStepUpAllowsVerifiedSession(t *testing.T) {
	engine := newAdminStepUpTestEngine(t, true)

	for _, route := range forcedStepUpRoutes() {
		w := serveAdminStepUp(t, engine, route)
		require.NotContains(t, w.Body.String(), "STEP_UP_", "%s 完成 step-up 后仍被拦：%s", route, w.Body.String())
	}
}

// TestNotForcedAdminRoutesStayUnderGlobalSwitch 反向看守：判为「不拦」的端点不能被悄悄挂上强制门，
// 否则就是「多拦一个把管理面拦死」。
func TestNotForcedAdminRoutesStayUnderGlobalSwitch(t *testing.T) {
	engine := newAdminStepUpTestEngine(t, false)

	for route, class := range adminStepUpClassification {
		if isForcedStepUpClass(class) {
			continue
		}
		w := serveAdminStepUp(t, engine, route)
		require.NotContains(t, w.Body.String(), "STEP_UP_",
			"%s 被判为「%s」，却在全局开关关闭时要求 step-up", route, class)
	}
}

func isForcedStepUpClass(class string) bool {
	switch class {
	case stepUpReplaceService, stepUpCredentialEgress, stepUpPrivilege, stepUpMoney, stepUpEvidence:
		return true
	default:
		return false
	}
}

func forcedStepUpRoutes() []string {
	routes := make([]string, 0, len(adminStepUpClassification))
	for route, class := range adminStepUpClassification {
		if isForcedStepUpClass(class) {
			routes = append(routes, route)
		}
	}
	sort.Strings(routes)
	return routes
}
