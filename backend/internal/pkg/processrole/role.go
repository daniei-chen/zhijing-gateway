// Package processrole separates request handling from singleton maintenance
// while an existing instance continues to own background work during a rollout.
package processrole

import "os"

// APIOnly is an explicit deployment opt-in, not a billing or safety bypass.
// It must stay fixed for the entire process lifetime.
func APIOnly() bool {
	return os.Getenv("ZHIJING_API_ONLY") == "1"
}
