import type {
  PlaybackAcceptedMessage,
  PlaybackCommandMessage,
  QueueAcceptedMessage,
  QueueCommandMessage,
} from './protocol.js'
import type { RoomCommandRecord, RoomState } from './roomTypes.js'

type JudgePlaybackInput = {
  room: RoomState
  now: number
  maxQueueItems?: number
  command: PlaybackCommandMessage
}

type JudgeQueueInput = {
  room: RoomState
  now: number
  maxQueueItems?: number
  command: QueueCommandMessage
}

type AcceptedPlaybackResult = {
  accepted: true
  room: RoomState
  message: PlaybackAcceptedMessage
}

type RejectedPlaybackResult = {
  accepted: false
  room: RoomState
  reason: 'sender-not-member' | 'stale-playback-revision'
}

type AcceptedQueueResult = {
  accepted: true
  room: RoomState
  message: QueueAcceptedMessage
}

type RejectedQueueResult = {
  accepted: false
  room: RoomState
  reason: 'sender-not-member' | 'stale-queue-version' | 'queue-too-large'
}

export function judgePlaybackCommand(input: JudgePlaybackInput): AcceptedPlaybackResult | RejectedPlaybackResult {
  const { room, now, command } = input
  if (!isCurrentMember(room, command.senderId)) {
    return {
      accepted: false,
      room: withRejectedCommand(room, command.commandId, {
        type: 'playbackCommand',
        status: 'rejected',
        reason: 'sender-not-member',
        payload: command,
        rejectedAt: now,
      }),
      reason: 'sender-not-member',
    }
  }

  const currentRevision = room.meta.revision
  const currentTrackId = room.playback?.trackId
  if (command.baseRevision < currentRevision && currentTrackId !== command.state.trackId) {
    return {
      accepted: false,
      room: withRejectedCommand(room, command.commandId, {
        type: 'playbackCommand',
        status: 'rejected',
        reason: 'stale-playback-revision',
        payload: command,
        rejectedAt: now,
      }),
      reason: 'stale-playback-revision',
    }
  }

  const nextRevision = currentRevision + 1
  const { streamUrl: _streamUrl, ...state } = command.state
  const message: PlaybackAcceptedMessage = {
    type: 'playbackAccepted',
    roomId: command.roomId,
    commandId: command.commandId,
    leaderId: command.senderId,
    revision: nextRevision,
    state: {
      ...state,
      startedAt: command.state.status === 'playing' ? now : command.state.startedAt,
      revision: nextRevision,
      commandId: command.commandId,
      leaderId: command.senderId,
    },
  }

  const nextRoom: RoomState = {
    ...room,
    meta: {
      ...room.meta,
      revision: nextRevision,
      updatedAt: now,
      expiresAt: null,
    },
    playback: {
      ...message.state,
      senderId: command.senderId,
      serverTime: now,
    },
    commands: {
      ...room.commands,
      [command.commandId]: {
        type: 'playbackCommand',
        status: 'accepted',
        payload: command,
        accepted: message,
      },
    },
  }

  return {
    accepted: true,
    room: nextRoom,
    message,
  }
}

export function judgeQueueCommand(input: JudgeQueueInput): AcceptedQueueResult | RejectedQueueResult {
  const { room, now, command } = input
  if (!isCurrentMember(room, command.senderId)) {
    return {
      accepted: false,
      room: withRejectedCommand(room, command.commandId, {
        type: 'queueCommand',
        status: 'rejected',
        reason: 'sender-not-member',
        payload: command,
        rejectedAt: now,
      }),
      reason: 'sender-not-member',
    }
  }

  const currentVersion = room.meta.queueVersion
  if (command.baseVersion < currentVersion) {
    return {
      accepted: false,
      room: withRejectedCommand(room, command.commandId, {
        type: 'queueCommand',
        status: 'rejected',
        reason: 'stale-queue-version',
        payload: command,
        rejectedAt: now,
      }),
      reason: 'stale-queue-version',
    }
  }

  if (Array.isArray(command.queue) && input.maxQueueItems != null && command.queue.length > input.maxQueueItems) {
    return {
      accepted: false,
      room: withRejectedCommand(room, command.commandId, {
        type: 'queueCommand',
        status: 'rejected',
        reason: 'queue-too-large',
        payload: command,
        rejectedAt: now,
      }),
      reason: 'queue-too-large',
    }
  }

  const nextVersion = currentVersion + 1
  const message: QueueAcceptedMessage = {
    type: 'queueAccepted',
    roomId: command.roomId,
    commandId: command.commandId,
    leaderId: command.senderId,
    version: nextVersion,
    queue: command.queue,
    playMode: command.playMode ?? room.queue.playMode,
  }

  const nextRoom: RoomState = {
    ...room,
    meta: {
      ...room.meta,
      queueVersion: nextVersion,
      updatedAt: now,
      expiresAt: null,
    },
    queue: {
      items: Array.isArray(command.queue) ? command.queue : room.queue.items,
      playMode: message.playMode ?? room.queue.playMode,
      queueVersion: nextVersion,
      commandId: command.commandId,
      senderId: command.senderId,
      serverTime: now,
    },
    commands: {
      ...room.commands,
      [command.commandId]: {
        type: 'queueCommand',
        status: 'accepted',
        payload: command,
        accepted: message,
      },
    },
  }

  return {
    accepted: true,
    room: nextRoom,
    message,
  }
}

function isCurrentMember(room: RoomState, senderId: string): boolean {
  return Boolean(room.members[senderId])
}

function withRejectedCommand(room: RoomState, commandId: string, command: RoomCommandRecord): RoomState {
  return {
    ...room,
    commands: {
      ...room.commands,
      [commandId]: command,
    },
  }
}
