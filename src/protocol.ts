export type PlayMode = 'random' | 'sequence' | 'loop'
export type AssistProvider = 'netease' | 'qq'

export type TrackMeta = {
  title: string
  artist: string
  coverUrl: string
  durationMs: number
}

export type PlaybackState = {
  provider: string
  trackId: string
  trackMeta?: TrackMeta
  status: 'playing' | 'paused' | 'idle'
  positionMs: number
  startedAt: number | null
  streamUrl?: string
  revision?: number
  commandId?: string
  leaderId?: string
}

export type PlaybackCommandMessage = {
  type: 'playbackCommand'
  roomId: string
  commandId: string
  senderId: string
  baseRevision: number
  state: PlaybackState
}

export type QueueCommandMessage = {
  type: 'queueCommand'
  roomId: string
  commandId: string
  senderId: string
  baseVersion: number
  queue: unknown[] | null
  playMode?: PlayMode
}

export type PlaybackAcceptedMessage = {
  type: 'playbackAccepted'
  roomId: string
  commandId: string
  leaderId: string
  revision: number
  state: PlaybackState
}

export type QueueAcceptedMessage = {
  type: 'queueAccepted'
  roomId: string
  commandId: string
  leaderId: string
  version: number
  queue: unknown[] | null
  playMode?: PlayMode
}

export type CreateRoomMessage = {
  type: 'createRoom'
  requestId: string
  nickname: string
  deviceId: string
  roomName: string
}

export type JoinRoomMessage = {
  type: 'joinRoom'
  requestId: string
  roomId: string
  roomToken: string
  nickname: string
  deviceId: string
}

export type LeaveRoomMessage = {
  type: 'leaveRoom'
  roomId: string
  senderId: string
}

export type ShareCapabilitiesUpdateMessage = {
  type: 'shareCapabilitiesUpdate'
  roomId: string
  senderId: string
  providers: AssistProvider[]
}

export type StreamAssistRequestMessage = {
  type: 'streamAssistRequest'
  roomId: string
  requestId: string
  senderId: string
  provider: AssistProvider
  trackId: string
  trackMeta?: TrackMeta
  reason: 'trial' | 'blocked'
}

export type StreamAssistResolveMessage = {
  type: 'streamAssistResolve'
  roomId: string
  requestId: string
  requesterId: string
  targetMemberId: string
  provider: AssistProvider
  trackId: string
  trackMeta?: TrackMeta
}

export type StreamAssistFailedMessage = {
  type: 'streamAssistFailed'
  roomId: string
  requestId: string
  senderId: string
  provider: AssistProvider
  trackId: string
  reason: string
}

export type StreamAssistDeclinedMessage = {
  type: 'streamAssistDeclined'
  roomId: string
  requestId: string
  senderId: string
  provider: AssistProvider
  trackId: string
  reason?: string
}

export type StreamAssistResultMessage = {
  type: 'streamAssistResult'
  roomId: string
  requestId: string
  ok: boolean
  reason?: string
}

export type HeartbeatMessage = {
  type: 'heartbeat'
  roomId: string
  senderId: string
  provider?: string
  trackId?: string
  status: 'playing' | 'paused' | 'idle'
  positionMs: number
  durationMs: number
  reportedAt: number
}

export type RoomCreatedMessage = {
  type: 'roomCreated'
  requestId: string
  roomId: string
  roomToken: string
  snapshot: {
    playback?: PlaybackState
    queue: unknown[]
    playMode?: PlayMode
    members: unknown[]
    revision?: number
    queueVersion?: number
    leaderId?: string
  }
}

export type JoinedMessage = {
  type: 'joined'
  requestId: string
  roomId: string
  snapshot: {
    playback?: PlaybackState
    queue: unknown[]
    playMode?: PlayMode
    members: unknown[]
    revision?: number
    queueVersion?: number
    leaderId?: string
  }
}

export type MemberUpdateMessage = {
  type: 'memberUpdate'
  roomId: string
  members: unknown[]
}

export type RoomClosedMessage = {
  type: 'roomClosed'
  roomId: string
  reason: 'expired' | 'room-not-found'
}
