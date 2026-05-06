export function createCleanupLoop(input: {
  intervalMs: number
  cleanup: () => string[]
}): { start: () => void; stop: () => void } {
  let timer: NodeJS.Timeout | null = null

  function tick() {
    input.cleanup()
  }

  return {
    start() {
      if (timer || input.intervalMs <= 0) return
      timer = setInterval(tick, input.intervalMs)
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
  }
}
