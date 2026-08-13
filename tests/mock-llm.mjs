// Scripted chat-completions mock for the runtime verification test.
// Node stdlib only, zero dependencies. Wire format mirrors the DeepSeek
// chat-completions adapter used by the harness: POST {base}/v1/chat/completions,
// SSE `data:` chunks, terminated by `data: [DONE]`.
//
// Script (deterministic):
//   - last message is a tool result  -> one text completion ("MOCK-OK: ...")
//   - request offers tools           -> one `bash` tool call (fallback: first tool offered)
//   - anything else (no tools, cap)  -> one text completion
//
// Every request is recorded in the `log` array as verification evidence.
//
// Module API:      startMockLlm({ port, log }) -> { port, log, close() }
// Standalone:      node tests/mock-llm.mjs [PORT]
import http from 'node:http'
import { pathToFileURL } from 'node:url'

function finishChunk(id, { content, toolCall } = {}) {
  const choice = { index: 0, delta: {} }
  if (content !== undefined) choice.delta.content = content
  if (toolCall) choice.delta.tool_calls = [toolCall]
  choice.finish_reason = toolCall ? 'tool_calls' : 'stop'
  return {
    id,
    object: 'chat.completion.chunk',
    choices: [choice],
    usage: {
      prompt_tokens: 25,
      completion_tokens: toolCall ? 4 : 12,
      prompt_tokens_details: {},
      completion_tokens_details: {},
    },
  }
}

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export async function startMockLlm(options = {}) {
  const log = options.log ?? []
  let counter = 0

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('ok')
        return
      }
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404)
        res.end()
        return
      }
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      counter++
      const messages = parsed.messages ?? []
      const last = messages[messages.length - 1]
      const toolNames = (parsed.tools ?? []).map((tool) => tool.function?.name).filter(Boolean)
      log.push({
        n: counter,
        model: parsed.model,
        lastRole: last?.role ?? null,
        toolCount: toolNames.length,
        tools: toolNames,
        hasToolResult: last?.role === 'tool',
      })

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const id = `chatcmpl-mock-${counter}`

      if (last?.role === 'tool' || counter > 6) {
        const snippet = last?.role === 'tool' ? String(last.content).slice(0, 40) : '(safety cap)'
        res.write(sseChunk(finishChunk(id, { content: `MOCK-OK: loop completed. Last tool output: ${snippet}` })))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      if (toolNames.length === 0) {
        res.write(sseChunk(finishChunk(id, { content: 'MOCK: no tools offered; answering directly.' })))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      const name = toolNames.includes('bash') ? 'bash' : toolNames[0]
      const args = name === 'bash'
        ? JSON.stringify({ command: 'ls', description: 'List files in current directory' })
        : '{}'
      res.write(sseChunk(finishChunk(id, {
        toolCall: {
          index: 0,
          id: `call_mock_${counter}`,
          type: 'function',
          function: { name, arguments: args },
        },
      })))
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return {
    get port() {
      return server.address().port
    },
    log,
    close() {
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startMockLlm({ port: Number(process.argv[2] ?? 8791) })
  console.log(`mock-llm listening on http://127.0.0.1:${mock.port}/v1/chat/completions`)
  const shutdown = () => mock.close().then(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
