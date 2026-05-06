export type PlayMode = 'random' | 'sequence' | 'loop'

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
