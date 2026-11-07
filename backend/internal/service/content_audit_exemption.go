package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type contentAuditExemptAPIKey struct {
	APIKeyID int64 `json:"api_key_id"`
	UserID   int64 `json:"user_id"`
}

func parseContentAuditExemptAPIKeys(raw string) (map[int64]int64, error) {
	owners := make(map[int64]int64)
	if strings.TrimSpace(raw) == "" {
		return owners, nil
	}
	if len(raw) > 16384 {
		return nil, fmt.Errorf("content audit exemption configuration exceeds limit")
	}
	var pairs []contentAuditExemptAPIKey
	if err := json.Unmarshal([]byte(raw), &pairs); err != nil {
		return nil, fmt.Errorf("invalid content audit exemption configuration")
	}
	for _, pair := range pairs {
		if pair.APIKeyID <= 0 || pair.UserID <= 0 {
			return nil, fmt.Errorf("content audit exemptions require positive key and owner IDs")
		}
		if _, exists := owners[pair.APIKeyID]; exists {
			return nil, fmt.Errorf("duplicate content audit exemption key ID")
		}
		owners[pair.APIKeyID] = pair.UserID
	}
	return owners, nil
}

func (s *contentModerationRuntimeSnapshot) isContentAuditExempt(userID, apiKeyID int64) bool {
	return s != nil && userID > 0 && apiKeyID > 0 && s.exemptAPIKeyOwners[apiKeyID] == userID
}

// Only authenticated database IDs qualify. Email text, roles and request
// headers cannot grant an exemption, and unrelated access controls stay intact.
func (s *ContentModerationService) IsContentAuditExempt(ctx context.Context, userID, apiKeyID int64) bool {
	if s == nil || s.settingRepo == nil || userID <= 0 || apiKeyID <= 0 {
		return false
	}
	snapshot, err := s.loadRuntimeSnapshot(ctx)
	return err == nil && snapshot.isContentAuditExempt(userID, apiKeyID)
}
