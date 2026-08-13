# The `dsh-http` helper binary

`src/dsh-http/` contains a tiny Go program that performs **exactly one**
JSON-over-HTTP request on behalf of the dynamic-plugin form of the toolkit
(the session-scoped DSH plugin that registers `native_search` /
`native_scrape` / `vision_describe` / `vision_list_models` in a running
harness, without an agent preset).

## Why it exists (security)

The DeepSeek Harness dynamic-plugin sandbox has no `fetch`: host plugins must
route HTTP through a shell service. A `bash -c "curl -H
'Authorization: Bearer $KEY' …"` invocation would expand the secret into
the `curl` process argv, where any same-UID reader can see it via
`/proc/<pid>/cmdline` for the whole duration of the request.

`dsh-http` closes that hole: the plugin invokes it as
`'/path/to/dsh-http'` — a **constant command line with no variables at all**.
The entire request is described through environment variables and stdin, so
the bearer token appears only in the process environment, never in any argv,
log, or error message. The binary itself never prints the token.

## What it does

- Reads `PLG_URL` / `PLG_METHOD` / `PLG_BEARER` / `PLG_TIMEOUT_MS` from the
  environment and the optional JSON body from stdin.
- Sends one HTTP(S) request with the Go **standard library only**
  (`net/http`) — **zero third-party dependencies** (`go.mod` declares no
  `require`). No crypto, auth protocols, or security primitives are
  hand-rolled; this is a thin stdlib wrapper.
- Writes the response body to stdout verbatim and performs **no retries, no
  logging, and no output besides the response body and stderr errors**.

## Contract

| Channel | Field | Meaning |
|---|---|---|
| env | `PLG_URL` | required; `http(s)://` URL |
| env | `PLG_METHOD` | optional; `GET` (default) or `POST` |
| env | `PLG_BEARER` | optional bearer token (never logged/printed) |
| env | `PLG_TIMEOUT_MS` | optional; per-request deadline, default 30000 |
| stdin | body | optional JSON request body |
| stdout | body | the response body, verbatim |
| exit 0 | | an HTTP response was received (any status code — callers inspect the body) |
| exit 2 | | usage error or transport failure (message on stderr) |

The caller (plugin) enforces its own outer timeout and cancellation through
the harness shell service; the binary's deadline is a belt-and-suspenders
inner bound.

## Build

```bash
cd src/dsh-http
go build -trimpath -o ~/.dsh/bin/dsh-http .
```

Requirements: Go 1.26+. The binary is machine-local (like the rest of the
toolkit install) and is not published to npm. The dynamic plugin's
configuration points at the built path via the `httpHelper` config key.
