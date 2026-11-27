package setup

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/logger"
)

// SetupTokenHeader carries the one-time setup token on setup write requests.
const SetupTokenHeader = "X-Setup-Token"

// SetupTokenFileName is the name of the file that holds the active token
// inside the data directory.
const SetupTokenFileName = "setup-token"

// setupTokenBytes is the amount of randomness behind a token.
const setupTokenBytes = 32

var (
	setupTokenMu sync.RWMutex
	setupToken   string
)

// GetSetupTokenPath returns the path of the file holding the active setup token.
func GetSetupTokenPath() string {
	return filepath.Join(GetDataDir(), SetupTokenFileName)
}

// EnsureSetupToken returns the active one-time setup token, generating and
// persisting a fresh one when none is active. The setup wizard hands out
// administrator rights, so the caller prints the token and the file next to it
// gives an operator with shell access a way to read it back.
func EnsureSetupToken() (string, error) {
	setupTokenMu.Lock()
	defer setupTokenMu.Unlock()

	if setupToken != "" {
		return setupToken, nil
	}

	buf := make([]byte, setupTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate setup token: %w", err)
	}
	token := hex.EncodeToString(buf)

	// The log stays the primary delivery channel: a file the process cannot
	// write must not leave the wizard without a token.
	if err := writeSetupTokenFile(token); err != nil {
		logger.LegacyPrintf("setup", "Warning: failed to write setup token file %s: %v", GetSetupTokenPath(), err)
	}

	setupToken = token
	return token, nil
}

func writeSetupTokenFile(token string) error {
	path := GetSetupTokenPath()
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.WriteString(token + "\n"); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	// OpenFile keeps the permissions of a file that already exists.
	return os.Chmod(path, 0o600)
}

// InvalidateSetupToken revokes the active token and removes its file. It is
// called once the installation completes, so a token that leaks afterwards is
// worthless.
func InvalidateSetupToken() {
	setupTokenMu.Lock()
	defer setupTokenMu.Unlock()

	setupToken = ""
	if err := os.Remove(GetSetupTokenPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		logger.LegacyPrintf("setup", "Warning: failed to remove setup token file %s: %v", GetSetupTokenPath(), err)
	}
}

// CurrentSetupToken returns the active token, or an empty string when none is
// active.
func CurrentSetupToken() string {
	setupTokenMu.RLock()
	defer setupTokenMu.RUnlock()
	return setupToken
}

// SetupTokenMatches reports whether candidate is the active token.
func SetupTokenMatches(candidate string) bool {
	trimmed := strings.TrimSpace(candidate)
	if trimmed == "" {
		return false
	}

	active := CurrentSetupToken()
	if active == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(trimmed), []byte(active)) == 1
}
