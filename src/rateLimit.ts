export function createConnectionRateLimiter(input: {
  maxCommandsPerWindow: number
  windowMs: number
}) {
  const history = new Map<string, number[]>()

  return {
    accept(connectionId: string, now: number): boolean {
      const list = history.get(connectionId) ?? []
      const next = list.filter((time) => now - time < input.windowMs)
      next.push(now)
      history.set(connectionId, next)
      return next.length <= input.maxCommandsPerWindow
    },
    clear(connectionId: string): void {
      history.delete(connectionId)
    },
  }
}
