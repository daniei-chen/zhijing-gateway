//go:build windows

package main

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func parseLoopbackProxy(value string) (*url.URL, error) {
	if len(value) == 0 || len(value) > 2048 {
		return nil, fmt.Errorf("system_proxy_not_supported")
	}
	if strings.Contains(value, "=") {
		parts := map[string]string{}
		for _, item := range strings.Split(value, ";") {
			pair := strings.SplitN(item, "=", 2)
			if len(pair) == 2 {
				parts[strings.TrimSpace(pair[0])] = strings.TrimSpace(pair[1])
			}
		}
		value = parts["https"]
		if value == "" {
			value = parts["http"]
		}
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "http" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Port() == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("system_proxy_not_supported")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("system_proxy_not_supported")
	}
	return parsed, nil
}

func currentSystemProxy(*http.Request) (*url.URL, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil, fmt.Errorf("system_proxy_read_failed")
	}
	defer func() { _ = key.Close() }()
	enabled, _, err := key.GetIntegerValue("ProxyEnable")
	if err == registry.ErrNotExist || (err == nil && enabled == 0) {
		// With system proxy disabled, the operating system/TUN owns routing.
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("system_proxy_read_failed")
	}
	value, _, err := key.GetStringValue("ProxyServer")
	if err != nil {
		return nil, fmt.Errorf("system_proxy_read_failed")
	}
	return parseLoopbackProxy(value)
}
