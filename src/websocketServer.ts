import type {
  CreateRoomMessage,
  HeartbeatMessage,
  JoinRoomMessage,
  LeaveRoomMessage,
  MemberUpdateMessage,
  PlaybackCommandMessage,
  QueueCommandMessage,
  RoomClosedMessage,
  RoomCreatedMessage,
  JoinedMessage,
} from './protocol.js'
import { createConnectionRateLimiter } from './rateLimit.js'
import { judgePlaybackCommand, judgeQueueCommand } from './roomJudge.js'
import { createRoomStore } from './roomStore.js'

type SyncServerOptions = {
  now: () => number
  emptyRoomTtlMs: number
  roomIdFactory: () => string
  roomTokenFactory: () => string
  roomTokenHasher: (token: string) => string
  maxRoomMembers: number
  maxQueueItems: number
  maxCommandsPerWindow: number
  rateLimitWindowMs: number
}

type ConnectionOptions = {
  connectionId: string
  send: (message: unknown) => void
}

type ClientConnection = {
  receive: (message: CreateRoomMessage | JoinRoomMessage | LeaveRoomMessage | HeartbeatMessage | PlaybackCommandMessage | QueueCommandMessage) => void
  disconnect: () => void
}

type ConnectionState = {
  connectionId: string
  send: (message: unknown) => void
  roomId: string | null
  deviceId: string | null
}

export function createSyncServer(options: SyncServerOptions) {
  const settings = {
    now: options.now,
    emptyRoomTtlMs: options.emptyRoomTtlMs,
    roomIdFactory: options.roomIdFactory,
    roomTokenFactory: options.roomTokenFactory,
    roomTokenHasher: options.roomTokenHasher,
    maxRoomMembers: options.maxRoomMembers ?? 8,
    maxQueueItems: options.maxQueueItems ?? 500,
    maxCommandsPerWindow: options.maxCommandsPerWindow ?? 20,
    rateLimitWindowMs: options.rateLimitWindowMs ?? 1000,
  }
  const store = createRoomStore(settings)
  const connections = new Map<string, ConnectionState>()
  const rateLimiter = createConnectionRateLimiter({
    maxCommandsPerWindow: settings.maxCommandsPerWindow,
    windowMs: settings.rateLimitWindowMs,
  })

  function connect(input: ConnectionOptions): ClientConnection {
    const connection: ConnectionState = {
      connectionId: input.connectionId,
      send: input.send,
      roomId: null,
      deviceId: null,
    }
    connections.set(input.connectionId, connection)

    return {
      receive(message) {
        if (message.type !== 'createRoom' && !rateLimiter.accept(connection.connectionId, options.now())) {
          connection.send({
            type: 'error',
            reason: 'rate-limit-exceeded',
          })
          return
        }

        if (message.type === 'createRoom') {
          const created = store.createRoom({
            roomName: message.roomName,
            nickname: message.nickname,
            deviceId: message.deviceId,
          })
          connection.roomId = created.roomId
          connection.deviceId = message.deviceId
          const response: RoomCreatedMessage = {
            type: 'roomCreated',
            requestId: message.requestId,
            roomId: created.roomId,
            roomToken: created.roomToken,
            snapshot: created.snapshot,
          }
          connection.send(response)
          broadcastMemberUpdate(created.roomId)
          return
        }

        if (message.type === 'joinRoom') {
          const joined = store.joinRoom({
            roomId: message.roomId,
            roomToken: message.roomToken,
            nickname: message.nickname,
            deviceId: message.deviceId,
          })
          if (!joined.ok) {
            connection.send({
              type: 'error',
              requestId: message.requestId,
              reason: joined.reason,
            })
            return
          }

          connection.roomId = message.roomId
          connection.deviceId = message.deviceId
          const response: JoinedMessage = {
            type: 'joined',
            requestId: message.requestId,
            roomId: message.roomId,
            snapshot: joined.snapshot,
          }
          connection.send(response)
          broadcastMemberUpdate(message.roomId)
          return
        }

        if (message.type === 'playbackCommand') {
          const room = store.getRoom(message.roomId)
          if (!room) return
          const result = judgePlaybackCommand({
            room,
            now: settings.now(),
            maxQueueItems: settings.maxQueueItems,
            command: message,
          })
          if (!result.accepted) {
            broadcastToRoom(message.roomId, {
              type: 'commandRejected',
              roomId: message.roomId,
              commandId: message.commandId,
              reason: result.reason,
            })
            return
          }
          overwriteRoom(message.roomId, result.room)
          broadcastToRoom(message.roomId, result.message)
          return
        }

        if (message.type === 'queueCommand') {
          const room = store.getRoom(message.roomId)
          if (!room) return
          const result = judgeQueueCommand({
            room,
            now: settings.now(),
            maxQueueItems: settings.maxQueueItems,
            command: message,
          })
          if (!result.accepted) {
            broadcastToRoom(message.roomId, {
              type: 'commandRejected',
              roomId: message.roomId,
              commandId: message.commandId,
              reason: result.reason,
            })
            return
          }
          overwriteRoom(message.roomId, result.room)
          broadcastToRoom(message.roomId, result.message)
          return
        }

        if (message.type === 'heartbeat') {
          if (!store.getRoom(message.roomId)) {
            connection.send({
              type: 'roomClosed',
              roomId: message.roomId,
              reason: 'room-not-found',
            })
            return
          }
          store.touchMemberHeartbeat({
            roomId: message.roomId,
            deviceId: message.senderId,
            heartbeat: {
              status: message.status,
              positionMs: message.positionMs,
              durationMs: message.durationMs,
            },
          })
          broadcastMemberUpdate(message.roomId)
          return
        }

        if (message.type === 'leaveRoom') {
          store.leaveRoom({
            roomId: message.roomId,
            deviceId: message.senderId,
          })
          if (connection.roomId === message.roomId && connection.deviceId === message.senderId) {
            connection.roomId = null
            connection.deviceId = null
          }
          broadcastMemberUpdate(message.roomId)
        }
      },
      disconnect() {
        if (connection.roomId && connection.deviceId) {
          const roomId = connection.roomId
          store.leaveRoom({
            roomId,
            deviceId: connection.deviceId,
          })
          connection.roomId = null
          connection.deviceId = null
          broadcastMemberUpdate(roomId)
        }
        connections.delete(connection.connectionId)
        rateLimiter.clear(connection.connectionId)
      },
    }
  }

  function broadcastMemberUpdate(roomId: string): void {
    const snapshot = store.getSnapshot(roomId)
    if (!snapshot) return
    const message: MemberUpdateMessage = {
      type: 'memberUpdate',
      roomId,
      members: snapshot.members,
    }
    broadcastToRoom(roomId, message)
  }

  function broadcastToRoom(roomId: string, message: unknown): void {
    for (const connection of connections.values()) {
      if (connection.roomId === roomId) {
        connection.send(message)
      }
    }
  }

  function overwriteRoom(roomId: string, room: ReturnType<typeof store.getRoom> extends infer T ? Exclude<T, null> : never): void {
    const target = store.getRoom(roomId)
    if (!target) return
    Object.assign(target, room)
  }

  return {
    connect,
    markInactiveMembersOffline() {
      const affectedRoomIds = store.markInactiveMembersOffline()
      affectedRoomIds.forEach((roomId) => {
        broadcastMemberUpdate(roomId)
      })
      return affectedRoomIds
    },
    cleanupExpiredRooms() {
      const removed = store.cleanupExpiredRooms()
      removed.forEach((roomId) => {
        const message: RoomClosedMessage = {
          type: 'roomClosed',
          roomId,
          reason: 'expired',
        }
        for (const connection of connections.values()) {
          connection.send(message)
          if (connection.roomId === roomId) {
            connection.roomId = null
            connection.deviceId = null
          }
        }
      })
      return removed
    },
  }
}
