//go:build windows

package main

import "testing"

func TestWindowsProxyOnlyAcceptsCurrentCredentialFreeLoopback(t *testing.T) {
	for _, item := range []string{"127.0.0.1:7890", "http=127.0.0.1:7897;https=127.0.0.1:7890", "http://localhost:7890"} {
		proxy, err := parseLoopbackProxy(item)
		if err != nil || proxy.Port() != "7890" {
			t.Fatalf("valid system loopback proxy rejected")
		}
	}
	for _, item := range []string{"", "remote.invalid:7890", "http://synthetic:password@127.0.0.1:7890", "127.0.0.1:0", "127.0.0.1:99999", "socks=127.0.0.1:7890", "127.0.0.1:7890/private"} {
		if _, err := parseLoopbackProxy(item); err == nil {
			t.Fatal("unexpected proxy or credential accepted")
		}
	}
}
