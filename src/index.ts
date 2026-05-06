import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createCleanupLoop } from './cleanup.js'
import { createConfigFromEnv, type AppServerConfig } from './config.js'
import { createSyncServer } from './websocketServer.js'

type RunningServer = {
  listen: () => Promise<void>
  close: () => Promise<void>
  address: () => ReturnType<http.Server['address']>
}

export function createAppServer(config: AppServerConfig): RunningServer {
  const syncServer = createSyncServer(config)
  const cleanupLoop = createCleanupLoop({
    intervalMs: config.cleanupIntervalMs,
    cleanup: () => {
      syncServer.markInactiveMembersOffline()
      return syncServer.cleanupExpiredRooms()
    },
  })
  const httpServer = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname === '/' || url.pathname === '/ws') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({
        service: 'ListenTogether-SyncServer',
        status: 'ok',
        websocket: {
          address: `ws://${request.headers.host ?? 'localhost'}/`,
          legacyPath: '/ws',
        },
      }))
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
  })
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes,
  })

  let connectionSeq = 0

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname !== '/' && url.pathname !== '/ws') {
      socket.destroy()
      return
    }

    webSocketServer.handleUpgrade(request, socket, head, (websocket) => {
      connectionSeq += 1
      websocket.on('error', () => {})
      const connection = syncServer.connect({
        connectionId: `conn-${connectionSeq}`,
        rateLimitKey: getRateLimitKey(request),
        send: (message) => websocket.send(JSON.stringify(message)),
      })

      websocket.on('message', (payload) => {
        const message = JSON.parse(String(payload))
        connection.receive(message)
      })
      websocket.on('close', () => {
        connection.disconnect()
      })
    })
  })

  return {
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(config.port, config.host, () => {
        httpServer.off('error', reject)
          cleanupLoop.start()
          resolve()
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        cleanupLoop.stop()
        webSocketServer.close()
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
    address() {
      return httpServer.address()
    },
  }
}

function getRateLimitKey(request: http.IncomingMessage): string {
  const forwardedFor = request.headers['x-forwarded-for']
  const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  const firstForwarded = forwarded?.split(',')[0]?.trim()
  return firstForwarded || request.socket.remoteAddress || 'unknown'
}

const currentModulePath = fileURLToPath(import.meta.url)
const entryArgPath = process.argv[1] ? path.resolve(process.argv[1]) : null

if (entryArgPath && path.resolve(currentModulePath) === entryArgPath) {
  const server = createAppServer(createConfigFromEnv())
  server.listen().catch((error) => {
    console.error('[sync-server] failed to start', error)
    process.exitCode = 1
  })
}
