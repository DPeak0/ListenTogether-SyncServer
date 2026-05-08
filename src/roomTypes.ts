import type {
  AssistProvider,
  PlaybackAcceptedMessage,
  PlaybackCommandMessage,
  PlaybackState,
  PlayMode,
  QueueAcceptedMessage,
  QueueCommandMessage,
} from './protocol.js'

export type SyncMember = {
  deviceId: string
  nickname: string
  isOwner: boolean
  online: boolean
  sharedProviders?: AssistProvider[]
  latencyMs?: number
  playbackPositionMs?: number
  playbackStatus?: 'playing' | 'paused' | 'idle'
  playbackUpdatedAt?: number
  joinedAt?: number
  lastSeenAt?: number
}

export type StreamAssistRequestState = {
  requestId: string
  roomId: string
  requesterId: string
  provider: AssistProvider
  trackId: string
  trackMeta?: PlaybackState['trackMeta']
  status: 'pending' | 'resolving' | 'failed' | 'completed'
  attemptedMemberIds: string[]
  assignedMemberId?: string
  createdAt: number
  expiresAt: number
}

export type RoomMeta = {
  roomId: string
  name: string
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  revision: number
  queueVersion: number
  roomTokenHash: string
}

export type RoomPlayback = PlaybackState & {
  serverTime?: number
  senderId?: string
}

export type RoomQueue = {
  items: unknown[]
  playMode: PlayMode
  queueVersion: number
  commandId?: string
  senderId?: string
  serverTime?: number
}

export type RoomCommandRecord =
  | {
      type: 'playbackCommand'
      status: 'accepted' | 'rejected'
      reason?: string
      payload: PlaybackCommandMessage
      accepted?: PlaybackAcceptedMessage
      rejectedAt?: number
    }
  | {
      type: 'queueCommand'
      status: 'accepted' | 'rejected'
      reason?: string
      payload: QueueCommandMessage
      accepted?: QueueAcceptedMessage
      rejectedAt?: number
    }

export type RoomState = {
  meta: RoomMeta
  members: Record<string, SyncMember>
  playback?: RoomPlayback
  queue: RoomQueue
  commands: Record<string, RoomCommandRecord>
  assistRequests: Record<string, StreamAssistRequestState>
  assistCursors: Partial<Record<AssistProvider, number>>
}

export type RoomCloseReason = 'expired' | 'room-not-found'

export type RoomSnapshot = {
  playback?: RoomPlayback
  queue: unknown[]
  playMode?: PlayMode
  members: SyncMember[]
  revision?: number
  queueVersion?: number
  leaderId?: string
}
