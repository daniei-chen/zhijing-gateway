//go:build !windows

package main

import (
	"net/http"
	"net/url"
)

func currentSystemProxy(request *http.Request) (*url.URL, error) {
	return http.ProxyFromEnvironment(request)
}
