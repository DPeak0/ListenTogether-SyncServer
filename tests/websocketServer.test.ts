import { describe, expect, it } from 'vitest'
import { createSyncServer } from '../src/websocketServer.js'

describe('websocketServer', () => {
  it('creates a room and lets another member join with a snapshot', () => {
    const server = createSyncServer({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    const aEvents = collectEvents()
    const bEvents = collectEvents()

    const a = server.connect({
      connectionId: 'conn-a',
      send: (message) => aEvents.push(message),
    })
    const b = server.connect({
      connectionId: 'conn-b',
      send: (message) => bEvents.push(message),
    })

    a.receive({
      type: 'createRoom',
      requestId: 'req-1',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })

    expect(lastMessageOfType(aEvents, 'roomCreated')).toMatchObject({
      type: 'roomCreated',
      requestId: 'req-1',
      roomId: '12345678',
      roomToken: 'token-abc',
    })

    b.receive({
      type: 'joinRoom',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    expect(lastMessageOfType(bEvents, 'joined')).toMatchObject({
      type: 'joined',
      requestId: 'req-2',
      roomId: '12345678',
      snapshot: {
        queue: [],
        playMode: 'sequence',
      },
    })
    expect(lastMessageOfType(aEvents, 'memberUpdate')).toMatchObject({
      type: 'memberUpdate',
      roomId: '12345678',
      members: expect.arrayContaining([
        expect.objectContaining({ deviceId: 'device-a', nickname: 'Alice', online: true }),
        expect.objectContaining({ deviceId: 'device-b', nickname: 'Bob', online: true }),
      ]),
    })
  })

  it('allows joining by roomId even when roomToken is empty', () => {
    const server = createSyncServer({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    const ownerEvents = collectEvents()
    const joinerEvents = collectEvents()

    const owner = server.connect({
      connectionId: 'conn-owner',
      send: (message) => ownerEvents.push(message),
    })
    const joiner = server.connect({
      connectionId: 'conn-joiner',
      send: (message) => joinerEvents.push(message),
    })

    owner.receive({
      type: 'createRoom',
      requestId: 'req-owner',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })

    joiner.receive({
      type: 'joinRoom',
      requestId: 'req-join',
      roomId: '12345678',
      roomToken: '',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    expect(lastMessageOfType(joinerEvents, 'joined')).toMatchObject({
      type: 'joined',
      requestId: 'req-join',
      roomId: '12345678',
    })
    expect(lastMessageOfType(ownerEvents, 'memberUpdate')).toMatchObject({
      type: 'memberUpdate',
      roomId: '12345678',
      members: expect.arrayContaining([
        expect.objectContaining({ deviceId: 'device-b', nickname: 'Bob', online: true }),
      ]),
    })
  })

  it('broadcasts accepted playback and queue commands to all room members', () => {
    const server = createSyncServer({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    const aEvents = collectEvents()
    const bEvents = collectEvents()

    const a = server.connect({
      connectionId: 'conn-a',
      send: (message) => aEvents.push(message),
    })
    const b = server.connect({
      connectionId: 'conn-b',
      send: (message) => bEvents.push(message),
    })

    a.receive({
      type: 'createRoom',
      requestId: 'req-1',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })
    b.receive({
      type: 'joinRoom',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    b.receive({
      type: 'playbackCommand',
      roomId: '12345678',
      commandId: 'cmd-1',
      senderId: 'device-b',
      baseRevision: 0,
      state: {
        provider: 'qq',
        trackId: 'song-1',
        status: 'playing',
        positionMs: 1200,
        startedAt: 10,
      },
    })

    expect(lastMessageOfType(aEvents, 'playbackAccepted')).toMatchObject({
      type: 'playbackAccepted',
      roomId: '12345678',
      commandId: 'cmd-1',
      leaderId: 'device-b',
      revision: 1,
    })
    expect(lastMessageOfType(bEvents, 'playbackAccepted')).toMatchObject({
      type: 'playbackAccepted',
      commandId: 'cmd-1',
      revision: 1,
    })

    a.receive({
      type: 'queueCommand',
      roomId: '12345678',
      commandId: 'cmd-2',
      senderId: 'device-a',
      baseVersion: 0,
      queue: [{ id: 'song-1' }, { id: 'song-2' }],
      playMode: 'loop',
    })

    expect(lastMessageOfType(aEvents, 'queueAccepted')).toMatchObject({
      type: 'queueAccepted',
      roomId: '12345678',
      commandId: 'cmd-2',
      version: 1,
      playMode: 'loop',
    })
    expect(lastMessageOfType(bEvents, 'queueAccepted')).toMatchObject({
      type: 'queueAccepted',
      commandId: 'cmd-2',
      version: 1,
    })
  })

  it('broadcasts heartbeat member updates and marks a member offline when their connection closes', () => {
    const server = createSyncServer({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    const aEvents = collectEvents()
    const bEvents = collectEvents()

    const a = server.connect({
      connectionId: 'conn-a',
      send: (message) => aEvents.push(message),
    })
    const b = server.connect({
      connectionId: 'conn-b',
      send: (message) => bEvents.push(message),
    })

    a.receive({
      type: 'createRoom',
      requestId: 'req-1',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })
    b.receive({
      type: 'joinRoom',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    b.receive({
      type: 'heartbeat',
      roomId: '12345678',
      senderId: 'device-b',
      status: 'playing',
      positionMs: 32000,
      durationMs: 180000,
      reportedAt: 1000,
    })

    expect(lastMessageOfType(aEvents, 'memberUpdate')).toMatchObject({
      type: 'memberUpdate',
      roomId: '12345678',
      members: expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-b',
          online: true,
          playbackStatus: 'playing',
          playbackPositionMs: 32000,
        }),
      ]),
    })

    b.disconnect()

    expect(lastMessageOfType(aEvents, 'memberUpdate')).toMatchObject({
      type: 'memberUpdate',
      roomId: '12345678',
      members: expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-b',
          online: false,
          playbackStatus: 'playing',
          playbackPositionMs: 32000,
        }),
      ]),
    })
  })

  it('broadcasts memberUpdate when cleanup marks heartbeat-timeout members offline', () => {
    let now = 1000
    const server = createSyncServer({
      now: () => now,
      emptyRoomTtlMs: 30 * 60 * 1000,
      memberHeartbeatTimeoutMs: 5000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    const aEvents = collectEvents()
    const bEvents = collectEvents()

    const a = server.connect({
      connectionId: 'conn-a',
      send: (message) => aEvents.push(message),
    })
    const b = server.connect({
      connectionId: 'conn-b',
      send: (message) => bEvents.push(message),
    })

    a.receive({
      type: 'createRoom',
      requestId: 'req-1',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })
    b.receive({
      type: 'joinRoom',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    now = 3000
    b.receive({
      type: 'heartbeat',
      roomId: '12345678',
      senderId: 'device-b',
      status: 'playing',
      positionMs: 32000,
      durationMs: 180000,
      reportedAt: 3000,
    })

    now = 7000
    expect(server.markInactiveMembersOffline()).toEqual(['12345678'])
    expect(lastMessageOfType(aEvents, 'memberUpdate')).toMatchObject({
      type: 'memberUpdate',
      roomId: '12345678',
      members: expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-a',
          online: false,
        }),
        expect.objectContaining({
          deviceId: 'device-b',
          online: true,
        }),
      ]),
    })

    now = 9001
    expect(server.markInactiveMembersOffline()).toEqual(['12345678'])
    expect(lastMessageOfType(aEvents, 'memberUpdate')).toMatchObject({
      type: 'memberUpdate',
      roomId: '12345678',
      members: expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-b',
          online: false,
        }),
      ]),
    })
  })

  it('rejects join when room is full and notifies a still-connected client when the old room no longer exists', () => {
    let now = 1000
    const server = createSyncServer({
      now: () => now,
      emptyRoomTtlMs: 100,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      maxRoomMembers: 1,
      maxQueueItems: 500,
      maxCommandsPerWindow: 20,
      rateLimitWindowMs: 1000,
    })

    const aEvents = collectEvents()
    const bEvents = collectEvents()

    const a = server.connect({
      connectionId: 'conn-a',
      send: (message) => aEvents.push(message),
    })
    const b = server.connect({
      connectionId: 'conn-b',
      send: (message) => bEvents.push(message),
    })

    a.receive({
      type: 'createRoom',
      requestId: 'req-1',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })

    b.receive({
      type: 'joinRoom',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    expect(lastMessageOfType(bEvents, 'error')).toMatchObject({
      type: 'error',
      requestId: 'req-2',
      reason: 'room-full',
    })

    a.receive({
      type: 'leaveRoom',
      roomId: '12345678',
      senderId: 'device-a',
    })
    now = 1100
    expect(server.cleanupExpiredRooms()).toEqual(['12345678'])

    a.receive({
      type: 'heartbeat',
      roomId: '12345678',
      senderId: 'device-a',
      status: 'playing',
      positionMs: 1000,
      durationMs: 180000,
      reportedAt: now,
    })

    expect(lastMessageOfType(aEvents, 'roomClosed')).toMatchObject({
      type: 'roomClosed',
      roomId: '12345678',
      reason: 'room-not-found',
    })
  })

  it('rejects oversized queue updates and command bursts beyond the rate limit', () => {
    let now = 1000
    const server = createSyncServer({
      now: () => now,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      maxRoomMembers: 8,
      maxQueueItems: 1,
      maxCommandsPerWindow: 1,
      rateLimitWindowMs: 1000,
    })

    const aEvents = collectEvents()
    const a = server.connect({
      connectionId: 'conn-a',
      send: (message) => aEvents.push(message),
    })

    a.receive({
      type: 'createRoom',
      requestId: 'req-1',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })

    a.receive({
      type: 'queueCommand',
      roomId: '12345678',
      commandId: 'cmd-1',
      senderId: 'device-a',
      baseVersion: 0,
      queue: [{ id: 'song-1' }, { id: 'song-2' }],
      playMode: 'loop',
    })

    expect(lastMessageOfType(aEvents, 'commandRejected')).toMatchObject({
      type: 'commandRejected',
      roomId: '12345678',
      commandId: 'cmd-1',
      reason: 'queue-too-large',
    })

    a.receive({
      type: 'playbackCommand',
      roomId: '12345678',
      commandId: 'cmd-2',
      senderId: 'device-a',
      baseRevision: 0,
      state: {
        provider: 'qq',
        trackId: 'song-1',
        status: 'playing',
        positionMs: 1200,
        startedAt: 10,
      },
    })

    expect(lastMessageOfType(aEvents, 'error')).toMatchObject({
      type: 'error',
      reason: 'rate-limit-exceeded',
    })
  })

  it('allows empty room token joins but still rejects wrong tokens and rate-limits repeated room entry attempts from the same source', () => {
    const server = createSyncServer({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      maxRoomOpsPerWindow: 2,
      roomOpsRateLimitWindowMs: 10_000,
      maxCommandsPerWindow: 20,
      rateLimitWindowMs: 1000,
      maxRoomMembers: 8,
      maxQueueItems: 500,
    })

    const ownerEvents = collectEvents()
    const attackerEventsA = collectEvents()
    const attackerEventsB = collectEvents()
    const attackerEventsC = collectEvents()

    const owner = server.connect({
      connectionId: 'conn-owner',
      rateLimitKey: 'ip-owner',
      send: (message) => ownerEvents.push(message),
    })
    const attackerA = server.connect({
      connectionId: 'conn-attacker-a',
      rateLimitKey: 'ip-attacker',
      send: (message) => attackerEventsA.push(message),
    })
    const attackerB = server.connect({
      connectionId: 'conn-attacker-b',
      rateLimitKey: 'ip-attacker',
      send: (message) => attackerEventsB.push(message),
    })
    const attackerC = server.connect({
      connectionId: 'conn-attacker-c',
      rateLimitKey: 'ip-attacker',
      send: (message) => attackerEventsC.push(message),
    })

    owner.receive({
      type: 'createRoom',
      requestId: 'req-owner',
      nickname: 'Alice',
      deviceId: 'device-a',
      roomName: 'Alice Room',
    })

    attackerA.receive({
      type: 'joinRoom',
      requestId: 'req-1',
      roomId: '12345678',
      roomToken: '',
      nickname: 'Bob',
      deviceId: 'device-b',
    })
    attackerB.receive({
      type: 'joinRoom',
      requestId: 'req-2',
      roomId: '12345678',
      roomToken: 'wrong-token',
      nickname: 'Carol',
      deviceId: 'device-c',
    })
    attackerC.receive({
      type: 'joinRoom',
      requestId: 'req-3',
      roomId: '12345678',
      roomToken: 'wrong-token',
      nickname: 'Dave',
      deviceId: 'device-d',
    })

    expect(lastMessageOfType(attackerEventsA, 'joined')).toMatchObject({
      type: 'joined',
      requestId: 'req-1',
      roomId: '12345678',
    })
    expect(lastMessageOfType(attackerEventsB, 'error')).toMatchObject({
      type: 'error',
      requestId: 'req-2',
      reason: 'invalid-room-token',
    })
    expect(lastMessageOfType(attackerEventsC, 'error')).toMatchObject({
      type: 'error',
      requestId: 'req-3',
      reason: 'rate-limit-exceeded',
    })
  })
})

function collectEvents() {
  return [] as any[]
}

function lastMessageOfType(messages: any[], type: string) {
  return [...messages].reverse().find((message) => message.type === type)
}
