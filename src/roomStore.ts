import type { AssistProvider, TrackMeta } from './protocol.js'
import type { RoomSnapshot, RoomState, StreamAssistRequestState, SyncMember } from './roomTypes.js'

type CreateRoomInput = {
  roomName: string
  nickname: string
  deviceId: string
}

type JoinRoomInput = {
  roomId: string
  roomToken: string
  nickname: string
  deviceId: string
}

type LeaveRoomInput = {
  roomId: string
  deviceId: string
}

type TouchMemberHeartbeatInput = {
  roomId: string
  deviceId: string
  heartbeat: {
    status: 'playing' | 'paused' | 'idle'
    positionMs: number
    durationMs: number
  }
}

type RoomStoreOptions = {
  now: () => number
  emptyRoomTtlMs: number
  memberHeartbeatTimeoutMs?: number
  maxRoomMembers: number
  maxQueueItems: number
  roomIdFactory: () => string
  roomTokenFactory: () => string
  roomTokenHasher: (token: string) => string
}

type CreateRoomResult = {
  roomId: string
  roomToken: string
  snapshot: RoomSnapshot
}

type JoinRoomSuccess = {
  ok: true
  snapshot: RoomSnapshot
}

type JoinRoomFailure = {
  ok: false
  reason: 'room-not-found' | 'invalid-room-token' | 'room-full'
}

type RoomRecord = {
  room: RoomState
  roomTokenHash: string
}

type RoomStore = {
  createRoom(input: CreateRoomInput): CreateRoomResult
  joinRoom(input: JoinRoomInput): JoinRoomSuccess | JoinRoomFailure
  leaveRoom(input: LeaveRoomInput): void
  touchMemberHeartbeat(input: TouchMemberHeartbeatInput): void
  updateMemberSharedProviders(input: {
    roomId: string
    deviceId: string
    providers: AssistProvider[]
  }): RoomState | null
  createAssistRequest(input: {
    roomId: string
    requestId: string
    requesterId: string
    provider: AssistProvider
    trackId: string
    trackMeta?: TrackMeta
  }): StreamAssistRequestState | null
  getAssistRequest(roomId: string, requestId: string): StreamAssistRequestState | null
  assignNextAssistMember(input: {
    roomId: string
    requestId: string
  }): { request: StreamAssistRequestState; member: SyncMember } | null
  failAssistRequest(input: {
    roomId: string
    requestId: string
    senderId: string
  }): { request: StreamAssistRequestState; retriable: boolean } | null
  completeAssistRequest(input: {
    roomId: string
    requestId: string
  }): StreamAssistRequestState | null
  getRoom(roomId: string): RoomState | null
  getSnapshot(roomId: string): RoomSnapshot | null
  markInactiveMembersOffline(): string[]
  cleanupExpiredRooms(): string[]
}

export function createRoomStore(options: RoomStoreOptions): RoomStore {
  const settings = {
    now: options.now,
    emptyRoomTtlMs: options.emptyRoomTtlMs,
    memberHeartbeatTimeoutMs: options.memberHeartbeatTimeoutMs ?? 12_000,
    maxRoomMembers: options.maxRoomMembers ?? 8,
    maxQueueItems: options.maxQueueItems ?? 500,
    roomIdFactory: options.roomIdFactory,
    roomTokenFactory: options.roomTokenFactory,
    roomTokenHasher: options.roomTokenHasher,
  }
  const rooms = new Map<string, RoomRecord>()

  function createRoom(input: CreateRoomInput): CreateRoomResult {
    const now = settings.now()
    const roomId = settings.roomIdFactory()
    const roomToken = settings.roomTokenFactory()
    const member = createMember({
      deviceId: input.deviceId,
      nickname: input.nickname,
      now,
      isOwner: true,
    })
    const room: RoomState = {
      meta: {
        roomId,
        name: input.roomName,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
        revision: 0,
        queueVersion: 0,
        roomTokenHash: settings.roomTokenHasher(roomToken),
      },
      members: {
        [input.deviceId]: member,
      },
      queue: {
        items: [],
        playMode: 'sequence',
        queueVersion: 0,
      },
      commands: {},
      assistRequests: {},
      assistCursors: {},
    }

    rooms.set(roomId, {
      room,
      roomTokenHash: room.meta.roomTokenHash,
    })

    return {
      roomId,
      roomToken,
      snapshot: toSnapshot(room),
    }
  }

  function joinRoom(input: JoinRoomInput): JoinRoomSuccess | JoinRoomFailure {
    const record = rooms.get(input.roomId)
    if (!record) return { ok: false, reason: 'room-not-found' }
    const normalizedToken = input.roomToken.trim()
    if (normalizedToken && record.roomTokenHash !== settings.roomTokenHasher(normalizedToken)) {
      return { ok: false, reason: 'invalid-room-token' }
    }
    const memberIds = Object.keys(record.room.members)
    if (!record.room.members[input.deviceId] && memberIds.length >= settings.maxRoomMembers) {
      return { ok: false, reason: 'room-full' }
    }

    const now = settings.now()
    const existingMember = record.room.members[input.deviceId]
    record.room.members[input.deviceId] = {
      ...createMember({
        deviceId: input.deviceId,
        nickname: input.nickname,
        now,
        isOwner: existingMember?.isOwner ?? false,
      }),
      ...(existingMember ?? {}),
      nickname: input.nickname,
      online: true,
      isOwner: existingMember?.isOwner ?? false,
      lastSeenAt: now,
    }
    record.room.meta.updatedAt = now
    record.room.meta.expiresAt = null

    return {
      ok: true,
      snapshot: toSnapshot(record.room),
    }
  }

  function leaveRoom(input: LeaveRoomInput): void {
    const record = rooms.get(input.roomId)
    if (!record) return
    const member = record.room.members[input.deviceId]
    if (!member) return

    const now = settings.now()
    record.room.members[input.deviceId] = {
      ...member,
      online: false,
      lastSeenAt: now,
    }
    record.room.meta.updatedAt = now
    if (!hasOnlineMembers(record.room)) {
      record.room.meta.expiresAt = now + settings.emptyRoomTtlMs
    }
  }

  function getRoom(roomId: string): RoomState | null {
    const record = rooms.get(roomId)
    return record?.room ?? null
  }

  function updateMemberSharedProviders(input: {
    roomId: string
    deviceId: string
    providers: AssistProvider[]
  }): RoomState | null {
    const record = rooms.get(input.roomId)
    if (!record) return null
    const member = record.room.members[input.deviceId]
    if (!member) return null
    const now = settings.now()
    record.room.members[input.deviceId] = {
      ...member,
      sharedProviders: dedupeProviders(input.providers),
      lastSeenAt: now,
    }
    record.room.meta.updatedAt = now
    return record.room
  }

  function createAssistRequest(input: {
    roomId: string
    requestId: string
    requesterId: string
    provider: AssistProvider
    trackId: string
    trackMeta?: TrackMeta
  }): StreamAssistRequestState | null {
    const record = rooms.get(input.roomId)
    if (!record) return null
    const now = settings.now()
    const request: StreamAssistRequestState = {
      requestId: input.requestId,
      roomId: input.roomId,
      requesterId: input.requesterId,
      provider: input.provider,
      trackId: input.trackId,
      trackMeta: input.trackMeta,
      status: 'pending',
      attemptedMemberIds: [],
      createdAt: now,
      expiresAt: now + 15_000,
    }
    record.room.assistRequests[input.requestId] = request
    record.room.meta.updatedAt = now
    return request
  }

  function getAssistRequest(roomId: string, requestId: string): StreamAssistRequestState | null {
    const record = rooms.get(roomId)
    if (!record) return null
    return record.room.assistRequests[requestId] ?? null
  }

  function assignNextAssistMember(input: {
    roomId: string
    requestId: string
  }): { request: StreamAssistRequestState; member: SyncMember } | null {
    const record = rooms.get(input.roomId)
    if (!record) return null
    const request = record.room.assistRequests[input.requestId]
    if (!request) return null

    const candidates = Object.values(record.room.members).filter((member) => {
      if (!member.online) return false
      if (member.deviceId === request.requesterId) return false
      if (request.attemptedMemberIds.includes(member.deviceId)) return false
      return !!member.sharedProviders?.includes(request.provider)
    })
    if (!candidates.length) {
      request.status = 'failed'
      request.assignedMemberId = undefined
      record.room.meta.updatedAt = settings.now()
      return null
    }

    const cursor = record.room.assistCursors[request.provider] ?? 0
    const selectedIndex = cursor % candidates.length
    const member = candidates[selectedIndex]
    request.status = 'resolving'
    request.assignedMemberId = member.deviceId
    if (!request.attemptedMemberIds.includes(member.deviceId)) {
      request.attemptedMemberIds.push(member.deviceId)
    }
    record.room.assistCursors[request.provider] = (selectedIndex + 1) % candidates.length
    record.room.meta.updatedAt = settings.now()
    return { request, member }
  }

  function failAssistRequest(input: {
    roomId: string
    requestId: string
    senderId: string
  }): { request: StreamAssistRequestState; retriable: boolean } | null {
    const record = rooms.get(input.roomId)
    if (!record) return null
    const request = record.room.assistRequests[input.requestId]
    if (!request) return null
    if (request.assignedMemberId !== input.senderId) return null
    request.assignedMemberId = undefined
    request.status = 'pending'
    const retriable = Object.values(record.room.members).some((member) => {
      if (!member.online) return false
      if (member.deviceId === request.requesterId) return false
      if (request.attemptedMemberIds.includes(member.deviceId)) return false
      return !!member.sharedProviders?.includes(request.provider)
    })
    if (!retriable) request.status = 'failed'
    record.room.meta.updatedAt = settings.now()
    return { request, retriable }
  }

  function completeAssistRequest(input: {
    roomId: string
    requestId: string
  }): StreamAssistRequestState | null {
    const record = rooms.get(input.roomId)
    if (!record) return null
    const request = record.room.assistRequests[input.requestId]
    if (!request) return null
    request.status = 'completed'
    request.assignedMemberId = undefined
    record.room.meta.updatedAt = settings.now()
    return request
  }

  function touchMemberHeartbeat(input: TouchMemberHeartbeatInput): void {
    const record = rooms.get(input.roomId)
    if (!record) return
    const member = record.room.members[input.deviceId]
    if (!member) return

    const now = settings.now()
    record.room.members[input.deviceId] = {
      ...member,
      online: true,
      lastSeenAt: now,
      playbackStatus: input.heartbeat.status,
      playbackPositionMs: input.heartbeat.positionMs,
      playbackUpdatedAt: now,
    }
    record.room.meta.updatedAt = now
    record.room.meta.expiresAt = null
  }

  function getSnapshot(roomId: string): RoomSnapshot | null {
    const record = rooms.get(roomId)
    return record ? toSnapshot(record.room) : null
  }

  function markInactiveMembersOffline(): string[] {
    const now = settings.now()
    const affectedRoomIds = new Set<string>()

    for (const [roomId, record] of rooms.entries()) {
      let changed = false
      for (const [deviceId, member] of Object.entries(record.room.members)) {
        if (member.online === false) continue
        const lastSeenAt = typeof member.lastSeenAt === 'number' ? member.lastSeenAt : member.joinedAt ?? now
        if (now - lastSeenAt < settings.memberHeartbeatTimeoutMs) continue
        record.room.members[deviceId] = {
          ...member,
          online: false,
          lastSeenAt,
        }
        changed = true
      }
      if (!changed) continue
      record.room.meta.updatedAt = now
      if (!hasOnlineMembers(record.room)) {
        record.room.meta.expiresAt = now + settings.emptyRoomTtlMs
      }
      affectedRoomIds.add(roomId)
    }

    return [...affectedRoomIds]
  }

  function cleanupExpiredRooms(): string[] {
    const now = settings.now()
    const removed: string[] = []
    for (const [roomId, record] of rooms.entries()) {
      const expiresAt = record.room.meta.expiresAt
      if (typeof expiresAt === 'number' && expiresAt <= now && !hasOnlineMembers(record.room)) {
        rooms.delete(roomId)
        removed.push(roomId)
      }
    }
    return removed
  }

  return {
    createRoom,
    joinRoom,
    leaveRoom,
    touchMemberHeartbeat,
    updateMemberSharedProviders,
    createAssistRequest,
    getAssistRequest,
    assignNextAssistMember,
    failAssistRequest,
    completeAssistRequest,
    getRoom,
    getSnapshot,
    markInactiveMembersOffline,
    cleanupExpiredRooms,
  }
}

function createMember(input: { deviceId: string; nickname: string; now: number; isOwner: boolean }): SyncMember {
  return {
    deviceId: input.deviceId,
    nickname: input.nickname,
    isOwner: input.isOwner,
    online: true,
    joinedAt: input.now,
    lastSeenAt: input.now,
  }
}

function toSnapshot(room: RoomState): RoomSnapshot {
  return {
    playback: room.playback,
    queue: room.queue.items,
    playMode: room.queue.playMode,
    members: Object.values(room.members),
    revision: room.meta.revision,
    queueVersion: room.meta.queueVersion,
    leaderId: room.playback?.leaderId,
  }
}

function hasOnlineMembers(room: RoomState): boolean {
  return Object.values(room.members).some((member) => member.online)
}

function dedupeProviders(providers: AssistProvider[]) {
  return [...new Set(providers.filter((provider) => provider === 'netease' || provider === 'qq'))]
}
