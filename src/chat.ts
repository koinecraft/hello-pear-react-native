export type ChatLine = {
  id: string
  /** Display label: `system`, `you`, or a short peer id from the worker */
  from: string
  text: string
}

export type WorkerChatEvent =
  | { type: 'peers'; count: number }
  | { type: 'message'; from: string; text: string }
  | { type: 'ready' }

export function parseWorkerChatEvent(raw: string): WorkerChatEvent | null {
  if (!raw.startsWith('{')) return null
  try {
    const event = JSON.parse(raw) as WorkerChatEvent
    if (event.type === 'peers' && typeof event.count === 'number') return event
    if (
      event.type === 'message' &&
      typeof event.from === 'string' &&
      typeof event.text === 'string'
    ) {
      return event
    }
    if (event.type === 'ready') return event
  } catch {
    return null
  }
  return null
}

export function chatSendPayload(text: string): string {
  return JSON.stringify({ type: 'chat:send', text })
}
