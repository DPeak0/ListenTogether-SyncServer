import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createAppServer, formatStartupMessages } from '../src/index.js'

describe('server runtime', () => {
  const servers: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close()
    }
  })

  it('accepts websocket clients and returns roomCreated for createRoom', async () => {
    const server = createAppServer({
      port: 0,
      host: '127.0.0.1',
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      now: () => 1000,
    })
    servers.push(server)
    await server.listen()

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected tcp address')
    }

    const messages = await connectAndExchange({
      url: `ws://127.0.0.1:${address.port}/ws`,
      outgoing: {
        type: 'createRoom',
        requestId: 'req-1',
        nickname: 'Alice',
        deviceId: 'device-a',
        roomName: 'Alice Room',
      },
      untilType: 'roomCreated',
    })

    expect(messages.find((message) => message.type === 'roomCreated')).toMatchObject({
      type: 'roomCreated',
      requestId: 'req-1',
      roomId: '12345678',
      roomToken: 'token-abc',
    })
  })

  it('accepts websocket clients on the root path', async () => {
    const server = createAppServer({
      port: 0,
      host: '127.0.0.1',
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      now: () => 1000,
    })
    servers.push(server)
    await server.listen()

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected tcp address')
    }

    const messages = await connectAndExchange({
      url: `ws://127.0.0.1:${address.port}/`,
      outgoing: {
        type: 'createRoom',
        requestId: 'req-2',
        nickname: 'Alice',
        deviceId: 'device-a',
        roomName: 'Alice Room',
      },
      untilType: 'roomCreated',
    })

    expect(messages.find((message) => message.type === 'roomCreated')).toMatchObject({
      type: 'roomCreated',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'token-abc',
    })
  })

  it('rejects websocket payloads larger than the configured limit', async () => {
    const server = createAppServer({
      port: 0,
      host: '127.0.0.1',
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      now: () => 1000,
      maxRoomMembers: 8,
      maxQueueItems: 500,
      maxCommandsPerWindow: 20,
      rateLimitWindowMs: 1000,
      maxMessageBytes: 32,
      cleanupIntervalMs: 60_000,
    })
    servers.push(server)
    await server.listen()

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected tcp address')
    }

    await expect(connectAndExchange({
      url: `ws://127.0.0.1:${address.port}/ws`,
      outgoing: {
        type: 'createRoom',
        requestId: 'req-1',
        nickname: 'Alice-with-a-very-long-name',
        deviceId: 'device-a',
        roomName: 'Alice Room with a very long title',
      },
      untilType: 'roomCreated',
    })).rejects.toThrow(/socket closed/i)
  })

  it('formats startup messages for a listening server', () => {
    expect(formatStartupMessages({
      port: 8787,
      host: '0.0.0.0',
      emptyRoomTtlMs: 30 * 60 * 1000,
      memberHeartbeatTimeoutMs: 5000,
      maxRoomMembers: 8,
      maxQueueItems: 500,
      maxCommandsPerWindow: 20,
      rateLimitWindowMs: 1000,
      maxRoomOpsPerWindow: 6,
      roomOpsRateLimitWindowMs: 10_000,
      maxMessageBytes: 65_536,
      cleanupIntervalMs: 1000,
      now: () => 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    }, {
      address: '0.0.0.0',
      family: 'IPv4',
      port: 8787,
    })).toEqual([
      '[sync-server] started on 0.0.0.0:8787',
      '[sync-server] probe http://0.0.0.0:8787/',
      '[sync-server] websocket ws://0.0.0.0:8787/',
    ])
  })
})

function connectAndExchange(input: { url: string; outgoing: unknown; untilType: string }): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const received: any[] = []
    const socket = new WebSocket(input.url)

    socket.on('open', () => {
      socket.send(JSON.stringify(input.outgoing))
    })

    socket.on('message', (payload) => {
      const message = JSON.parse(String(payload))
      received.push(message)
      if (message.type === input.untilType) {
        socket.close()
        resolve(received)
      }
    })

    socket.on('error', reject)
    socket.on('close', () => {
      const found = received.some((message) => message.type === input.untilType)
      if (!found) reject(new Error(`socket closed before receiving ${input.untilType}`))
    })
  })
}
