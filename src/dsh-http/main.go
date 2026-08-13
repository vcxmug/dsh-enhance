// Command dsh-http is the HTTP helper binary for the dsh-enhance toolkit.
//
// It performs exactly one JSON-over-HTTP request on behalf of the dynamic
// plugin and deliberately keeps every variable OUT of its argv: the whole
// request is described through environment variables and stdin, so secrets
// (the Authorization bearer token) never appear in any process command line
// (`/proc/<pid>/cmdline`, `ps`, process monitors, crash reports).
//
// Contract (see docs/helper-binary.md):
//
//	env PLG_URL         required, http(s) URL
//	env PLG_METHOD      optional, GET (default) or POST
//	env PLG_BEARER      optional bearer token
//	env PLG_TIMEOUT_MS  optional, default 30000
//	stdin               optional request body (JSON)
//	stdout              the response body, verbatim
//	exit 0              an HTTP response was received (any status code)
//	exit 2              usage error or transport failure (message on stderr)
//
// It performs no retries, no redirect restrictions beyond net/http defaults,
// no logging, and never prints the bearer token.
package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	url := strings.TrimSpace(os.Getenv("PLG_URL"))
	if url == "" || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		fmt.Fprintln(os.Stderr, "dsh-http: PLG_URL must be an http(s) URL")
		os.Exit(2)
	}
	method := strings.ToUpper(strings.TrimSpace(os.Getenv("PLG_METHOD")))
	if method == "" {
		method = http.MethodGet
	}
	switch method {
	case http.MethodGet, http.MethodPost:
	default:
		fmt.Fprintln(os.Stderr, "dsh-http: PLG_METHOD must be GET or POST")
		os.Exit(2)
	}
	timeoutMs := 30000
	if v := os.Getenv("PLG_TIMEOUT_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			timeoutMs = n
		}
	}

	bodyBytes, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dsh-http: cannot read stdin:", err)
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	var body io.Reader
	if len(bodyBytes) > 0 {
		body = bytes.NewReader(bodyBytes)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dsh-http: bad request:", err)
		os.Exit(2)
	}
	if bearer := os.Getenv("PLG_BEARER"); bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if len(bodyBytes) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dsh-http:", err)
		os.Exit(2)
	}
	defer resp.Body.Close()
	if _, err := io.Copy(os.Stdout, resp.Body); err != nil {
		fmt.Fprintln(os.Stderr, "dsh-http: cannot read response:", err)
		os.Exit(2)
	}
}
