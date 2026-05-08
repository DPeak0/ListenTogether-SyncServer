import type {
  ShareCapabilitiesUpdateMessage,
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
  StreamAssistDeclinedMessage,
  StreamAssistFailedMessage,
  StreamAssistRequestMessage,
  StreamAssistResolveMessage,
  StreamAssistResultMessage,
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
  maxRoomOpsPerWindow?: number
  roomOpsRateLimitWindowMs?: number
}

type ConnectionOptions = {
  connectionId: string
  rateLimitKey?: string
  send: (message: unknown) => void
}

type ClientConnection = {
  receive: (message:
    | CreateRoomMessage
    | JoinRoomMessage
    | LeaveRoomMessage
    | HeartbeatMessage
    | PlaybackCommandMessage
    | QueueCommandMessage
    | ShareCapabilitiesUpdateMessage
    | StreamAssistRequestMessage
    | StreamAssistFailedMessage
    | StreamAssistDeclinedMessage
  ) => void
  disconnect: () => void
}

type ConnectionState = {
  connectionId: string
  rateLimitKey: string
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
    maxRoomOpsPerWindow: options.maxRoomOpsPerWindow ?? 6,
    roomOpsRateLimitWindowMs: options.roomOpsRateLimitWindowMs ?? 10_000,
  }
  const store = createRoomStore(settings)
  const connections = new Map<string, ConnectionState>()
  const commandRateLimiter = createConnectionRateLimiter({
    maxCommandsPerWindow: settings.maxCommandsPerWindow,
    windowMs: settings.rateLimitWindowMs,
  })
  const roomOpsRateLimiter = createConnectionRateLimiter({
    maxCommandsPerWindow: settings.maxRoomOpsPerWindow,
    windowMs: settings.roomOpsRateLimitWindowMs,
  })

  function connect(input: ConnectionOptions): ClientConnection {
    const connection: ConnectionState = {
      connectionId: input.connectionId,
      rateLimitKey: input.rateLimitKey?.trim() || input.connectionId,
      send: input.send,
      roomId: null,
      deviceId: null,
    }
    connections.set(input.connectionId, connection)

    return {
      receive(message) {
        const now = settings.now()
        const isRoomOp = message.type === 'createRoom' || message.type === 'joinRoom'

        if (isRoomOp && !roomOpsRateLimiter.accept(connection.rateLimitKey, now)) {
          connection.send({
            type: 'error',
            ...('requestId' in message ? { requestId: message.requestId } : {}),
            reason: 'rate-limit-exceeded',
          })
          return
        }

        if (!isRoomOp && !commandRateLimiter.accept(connection.connectionId, now)) {
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
          completeMatchingAssistRequest(message.roomId, message.senderId, message.state.provider, message.state.trackId)
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
          return
        }

        if (message.type === 'shareCapabilitiesUpdate') {
          const room = store.updateMemberSharedProviders({
            roomId: message.roomId,
            deviceId: message.senderId,
            providers: message.providers,
          })
          if (!room) return
          broadcastMemberUpdate(message.roomId)
          return
        }

        if (message.type === 'streamAssistRequest') {
          const request = store.createAssistRequest({
            roomId: message.roomId,
            requestId: message.requestId,
            requesterId: message.senderId,
            provider: message.provider,
            trackId: message.trackId,
            trackMeta: message.trackMeta,
          })
          if (!request) return
          dispatchAssistRequest(message.roomId, message.requestId)
          return
        }

        if (message.type === 'streamAssistFailed' || message.type === 'streamAssistDeclined') {
          const failed = store.failAssistRequest({
            roomId: message.roomId,
            requestId: message.requestId,
            senderId: message.senderId,
          })
          if (!failed) return
          if (failed.retriable) {
            dispatchAssistRequest(message.roomId, message.requestId)
          } else {
            notifyAssistResult(message.roomId, failed.request.requestId, failed.request.requesterId, false, 'no-helper-succeeded')
          }
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
        commandRateLimiter.clear(connection.connectionId)
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

  function dispatchAssistRequest(roomId: string, requestId: string): void {
    const assigned = store.assignNextAssistMember({ roomId, requestId })
    if (!assigned) {
      const request = store.getAssistRequest(roomId, requestId)
      if (request) {
        const reason = request.attemptedMemberIds.length > 0
          ? 'no-helper-succeeded'
          : 'no-helper-available'
        notifyAssistResult(roomId, request.requestId, request.requesterId, false, reason)
      }
      return
    }
    const message: StreamAssistResolveMessage = {
      type: 'streamAssistResolve',
      roomId,
      requestId,
      requesterId: assigned.request.requesterId,
      targetMemberId: assigned.member.deviceId,
      provider: assigned.request.provider,
      trackId: assigned.request.trackId,
      trackMeta: assigned.request.trackMeta,
    }
    sendToMember(roomId, assigned.member.deviceId, message)
  }

  function notifyAssistResult(
    roomId: string,
    requestId: string,
    requesterId: string,
    ok: boolean,
    reason?: string,
  ): void {
    const message: StreamAssistResultMessage = {
      type: 'streamAssistResult',
      roomId,
      requestId,
      ok,
      ...(reason ? { reason } : {}),
    }
    sendToMember(roomId, requesterId, message)
  }

  function broadcastToRoom(roomId: string, message: unknown): void {
    for (const connection of connections.values()) {
      if (connection.roomId === roomId) {
        connection.send(message)
      }
    }
  }

  function sendToMember(roomId: string, deviceId: string, message: unknown): void {
    for (const connection of connections.values()) {
      if (connection.roomId === roomId && connection.deviceId === deviceId) {
        connection.send(message)
      }
    }
  }

  function completeMatchingAssistRequest(roomId: string, senderId: string, provider: string, trackId: string): void {
    const room = store.getRoom(roomId)
    if (!room) return
    for (const request of Object.values(room.assistRequests)) {
      if (request.status !== 'resolving') continue
      if (request.assignedMemberId !== senderId) continue
      if (request.provider !== provider) continue
      if (request.trackId !== trackId) continue
      store.completeAssistRequest({ roomId, requestId: request.requestId })
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
