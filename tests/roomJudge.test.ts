import { describe, expect, it } from 'vitest'
import { judgePlaybackCommand, judgeQueueCommand } from '../src/roomJudge.js'
import type { RoomState } from '../src/roomTypes.js'

function createRoomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    meta: {
      roomId: '12345678',
      name: 'Room',
      createdAt: 1,
      updatedAt: 1,
      expiresAt: null,
      revision: 0,
      queueVersion: 0,
      roomTokenHash: 'hash',
    },
    members: {
      'device-a': {
        deviceId: 'device-a',
        nickname: 'Alice',
        isOwner: false,
        online: true,
        joinedAt: 1,
        lastSeenAt: 1,
      },
    },
    queue: {
      items: [],
      playMode: 'sequence',
      queueVersion: 0,
    },
    commands: {},
    ...overrides,
  }
}

describe('roomJudge', () => {
  it('accepts playback command from an online member and strips streamUrl', () => {
    const room = createRoomState()
    const result = judgePlaybackCommand({
      room,
      now: 1000,
      command: {
        type: 'playbackCommand',
        roomId: '12345678',
        commandId: 'cmd-1',
        senderId: 'device-a',
        baseRevision: 0,
        state: {
          provider: 'qq',
          trackId: 'song-1',
          status: 'playing',
          positionMs: 1200,
          startedAt: 100,
          streamUrl: 'https://temp.example/song.mp3',
        },
      },
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error('expected accepted playback result')
    expect(result.room.meta.revision).toBe(1)
    expect(result.room.playback).toMatchObject({
      provider: 'qq',
      trackId: 'song-1',
      status: 'playing',
      positionMs: 1200,
      revision: 1,
      commandId: 'cmd-1',
      leaderId: 'device-a',
      senderId: 'device-a',
      serverTime: 1000,
      startedAt: 1000,
    })
    expect(result.room.playback).not.toHaveProperty('streamUrl')
  })

  it('rejects stale playback command for a different track', () => {
    const room = createRoomState({
      meta: {
        roomId: '12345678',
        name: 'Room',
        createdAt: 1,
        updatedAt: 1,
        expiresAt: null,
        revision: 2,
        queueVersion: 0,
        roomTokenHash: 'hash',
      },
      playback: {
        provider: 'qq',
        trackId: 'song-2',
        status: 'playing',
        positionMs: 0,
        startedAt: 1,
        revision: 2,
      },
    })

    const result = judgePlaybackCommand({
      room,
      now: 1000,
      command: {
        type: 'playbackCommand',
        roomId: '12345678',
        commandId: 'cmd-2',
        senderId: 'device-a',
        baseRevision: 1,
        state: {
          provider: 'qq',
          trackId: 'song-1',
          status: 'playing',
          positionMs: 0,
          startedAt: 1,
        },
      },
    })

    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('expected rejected playback result')
    expect(result.reason).toBe('stale-playback-revision')
    expect(result.room.meta.revision).toBe(2)
    expect(result.room.playback?.trackId).toBe('song-2')
  })

  it('accepts queue command from an online member and increments queueVersion', () => {
    const room = createRoomState()
    const result = judgeQueueCommand({
      room,
      now: 1000,
      command: {
        type: 'queueCommand',
        roomId: '12345678',
        commandId: 'cmd-3',
        senderId: 'device-a',
        baseVersion: 0,
        queue: [{ id: 'song-1' }, { id: 'song-2' }],
        playMode: 'loop',
      },
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error('expected accepted queue result')
    expect(result.room.meta.queueVersion).toBe(1)
    expect(result.room.queue).toMatchObject({
      items: [{ id: 'song-1' }, { id: 'song-2' }],
      playMode: 'loop',
      queueVersion: 1,
      commandId: 'cmd-3',
      senderId: 'device-a',
      serverTime: 1000,
    })
  })

  it('rejects queue command from a non-member', () => {
    const room = createRoomState()
    const result = judgeQueueCommand({
      room,
      now: 1000,
      command: {
        type: 'queueCommand',
        roomId: '12345678',
        commandId: 'cmd-4',
        senderId: 'device-b',
        baseVersion: 0,
        queue: [{ id: 'song-1' }],
        playMode: 'random',
      },
    })

    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('expected rejected queue result')
    expect(result.reason).toBe('sender-not-member')
    expect(result.room.meta.queueVersion).toBe(0)
    expect(result.room.queue.items).toEqual([])
  })

  it('rejects queue command that exceeds the configured queue limit', () => {
    const room = createRoomState()
    const result = judgeQueueCommand({
      room,
      now: 1000,
      maxQueueItems: 2,
      command: {
        type: 'queueCommand',
        roomId: '12345678',
        commandId: 'cmd-5',
        senderId: 'device-a',
        baseVersion: 0,
        queue: [{ id: 'song-1' }, { id: 'song-2' }, { id: 'song-3' }],
        playMode: 'loop',
      },
    })

    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('expected rejected queue result')
    expect(result.reason).toBe('queue-too-large')
    expect(result.room.meta.queueVersion).toBe(0)
  })
})
