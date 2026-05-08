import crypto from 'node:crypto'

export type AppServerConfig = {
  host: string
  port: number
  emptyRoomTtlMs: number
  memberHeartbeatTimeoutMs: number
  maxRoomMembers: number
  maxQueueItems: number
  maxCommandsPerWindow: number
  rateLimitWindowMs: number
  maxRoomOpsPerWindow: number
  roomOpsRateLimitWindowMs: number
  maxMessageBytes: number
  cleanupIntervalMs: number
  now: () => number
  roomIdFactory: () => string
  roomTokenFactory: () => string
  roomTokenHasher: (token: string) => string
}

export function createConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number.parseInt(env.PORT ?? '8787', 10),
    emptyRoomTtlMs: Number.parseInt(env.ROOM_EMPTY_TTL_MS ?? `${30 * 60 * 1000}`, 10),
    memberHeartbeatTimeoutMs: Number.parseInt(env.MEMBER_HEARTBEAT_TIMEOUT_MS ?? '12000', 10),
    maxRoomMembers: Number.parseInt(env.MAX_ROOM_MEMBERS ?? '8', 10),
    maxQueueItems: Number.parseInt(env.MAX_QUEUE_ITEMS ?? '500', 10),
    maxCommandsPerWindow: Number.parseInt(env.MAX_COMMANDS_PER_WINDOW ?? '20', 10),
    rateLimitWindowMs: Number.parseInt(env.RATE_LIMIT_WINDOW_MS ?? '1000', 10),
    maxRoomOpsPerWindow: Number.parseInt(env.MAX_ROOM_OPS_PER_WINDOW ?? '6', 10),
    roomOpsRateLimitWindowMs: Number.parseInt(env.ROOM_OPS_RATE_LIMIT_WINDOW_MS ?? '10000', 10),
    maxMessageBytes: Number.parseInt(env.MAX_MESSAGE_BYTES ?? '65536', 10),
    cleanupIntervalMs: Number.parseInt(env.CLEANUP_INTERVAL_MS ?? '1000', 10),
    now: () => Date.now(),
    roomIdFactory: () => randomDigits(8),
    roomTokenFactory: () => crypto.randomBytes(24).toString('base64url'),
    roomTokenHasher: (token: string) => crypto.createHash('sha256').update(token).digest('hex'),
  }
}

function randomDigits(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('')
}
