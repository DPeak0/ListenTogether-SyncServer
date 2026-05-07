import { describe, expect, it } from 'vitest'
import { createRoomStore } from '../src/roomStore.js'

describe('roomStore', () => {
  it('creates a room, returns join token, and exposes an initial snapshot', () => {
    const store = createRoomStore({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    const created = store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })

    expect(created.roomId).toBe('12345678')
    expect(created.roomToken).toBe('token-abc')
    expect(created.snapshot).toMatchObject({
      queue: [],
      playMode: 'sequence',
      members: [
        expect.objectContaining({
          deviceId: 'device-a',
          nickname: 'Alice',
          isOwner: true,
          online: true,
        }),
      ],
      revision: 0,
      queueVersion: 0,
    })
  })

  it('joins a room by roomId and token and returns the latest snapshot', () => {
    const store = createRoomStore({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })

    const joined = store.joinRoom({
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    expect(joined.ok).toBe(true)
    if (!joined.ok) throw new Error('expected join to succeed')
    expect(joined.snapshot.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: 'device-a', nickname: 'Alice', online: true }),
      expect.objectContaining({ deviceId: 'device-b', nickname: 'Bob', online: true }),
    ]))
  })

  it('joins a room by roomId when the room token is omitted', () => {
    const store = createRoomStore({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })

    const joined = store.joinRoom({
      roomId: '12345678',
      roomToken: '   ',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    expect(joined.ok).toBe(true)
    if (!joined.ok) throw new Error('expected join without token to succeed')
    expect(joined.snapshot.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: 'device-a', nickname: 'Alice', online: true }),
      expect.objectContaining({ deviceId: 'device-b', nickname: 'Bob', online: true }),
    ]))
  })

  it('rejects joining with a wrong room token', () => {
    const store = createRoomStore({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })

    const joined = store.joinRoom({
      roomId: '12345678',
      roomToken: 'wrong-token',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    expect(joined).toEqual({
      ok: false,
      reason: 'invalid-room-token',
    })
  })

  it('marks room expired after last member leaves and cleanup removes it after ttl', () => {
    let now = 1000
    const store = createRoomStore({
      now: () => now,
      emptyRoomTtlMs: 100,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })
    store.joinRoom({
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    store.leaveRoom({ roomId: '12345678', deviceId: 'device-a' })
    store.leaveRoom({ roomId: '12345678', deviceId: 'device-b' })

    const beforeExpiry = store.getRoom('12345678')
    expect(beforeExpiry?.meta.expiresAt).toBe(1100)

    now = 1099
    expect(store.cleanupExpiredRooms()).toEqual([])
    expect(store.getRoom('12345678')).toBeTruthy()

    now = 1100
    expect(store.cleanupExpiredRooms()).toEqual(['12345678'])
    expect(store.getRoom('12345678')).toBeNull()
  })

  it('updates member heartbeat state and marks them offline when they leave', () => {
    let now = 1000
    const store = createRoomStore({
      now: () => now,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })
    store.joinRoom({
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    now = 1300
    store.touchMemberHeartbeat({
      roomId: '12345678',
      deviceId: 'device-b',
      heartbeat: {
        status: 'playing',
        positionMs: 48000,
        durationMs: 180000,
      },
    })

    expect(store.getSnapshot('12345678')).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-b',
          online: true,
          playbackStatus: 'playing',
          playbackPositionMs: 48000,
          playbackUpdatedAt: 1300,
        }),
      ]),
    })

    now = 1600
    store.leaveRoom({ roomId: '12345678', deviceId: 'device-b' })

    expect(store.getSnapshot('12345678')).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-b',
          online: false,
          lastSeenAt: 1600,
          playbackStatus: 'playing',
          playbackPositionMs: 48000,
          playbackUpdatedAt: 1300,
        }),
      ]),
    })
  })

  it('marks heartbeat-timeout members offline during cleanup and starts empty-room ttl when everyone is offline', () => {
    let now = 1000
    const store = createRoomStore({
      now: () => now,
      emptyRoomTtlMs: 60000,
      memberHeartbeatTimeoutMs: 5000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })
    store.joinRoom({
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    now = 3000
    store.touchMemberHeartbeat({
      roomId: '12345678',
      deviceId: 'device-b',
      heartbeat: {
        status: 'paused',
        positionMs: 12000,
        durationMs: 180000,
      },
    })

    now = 7000
    expect(store.markInactiveMembersOffline()).toEqual(['12345678'])
    expect(store.getSnapshot('12345678')).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ deviceId: 'device-a', online: false }),
        expect.objectContaining({ deviceId: 'device-b', online: true }),
      ]),
    })

    now = 9001
    expect(store.markInactiveMembersOffline()).toEqual(['12345678'])
    const snapshot = store.getSnapshot('12345678')
    expect(snapshot).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ deviceId: 'device-a', online: false }),
        expect.objectContaining({ deviceId: 'device-b', online: false }),
      ]),
    })
    expect(store.getRoom('12345678')?.meta.expiresAt).toBe(69001)
  })

  it('rejects joining when room member limit is reached', () => {
    const store = createRoomStore({
      now: () => 1000,
      emptyRoomTtlMs: 30 * 60 * 1000,
      roomIdFactory: () => '12345678',
      roomTokenFactory: () => 'token-abc',
      roomTokenHasher: (token) => `hash:${token}`,
      maxRoomMembers: 2,
      maxQueueItems: 500,
    })

    store.createRoom({
      roomName: 'Alice Room',
      nickname: 'Alice',
      deviceId: 'device-a',
    })
    store.joinRoom({
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Bob',
      deviceId: 'device-b',
    })

    const joined = store.joinRoom({
      roomId: '12345678',
      roomToken: 'token-abc',
      nickname: 'Carol',
      deviceId: 'device-c',
    })

    expect(joined).toEqual({
      ok: false,
      reason: 'room-full',
    })
  })
})
