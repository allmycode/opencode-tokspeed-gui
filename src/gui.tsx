import { createMemo, createSignal, Show } from "solid-js"
import { ComposerPill, Plugin, Slot } from "@opencode/plugin/gui"

/**
 * Live output speed (tok/s) for OpenCode Desktop.
 *
 * Measures the model's own streaming output: text, reasoning and the arguments
 * it writes for a tool call. Tool execution time is never part of the window.
 * On a finished step the provider-reported token count replaces the estimate.
 */

const WINDOW_MS = 2000
const GAP_MS = 30_000
const CHARS_PER_TOKEN = 4
const TICK_MS = 200

type Chunk = { t: number; chars: number }

type Stats = {
  active: boolean
  startedAt: number
  firstAt: number | null
  lastAt: number | null
  spanMs: number
  window: Chunk[]
  live: number | null
  last: number | null
  peak: number
  tokens: number
  chars: number
  ttft: number | null
}

const stats = new Map<string, Stats>()
const [rev, setRev] = createSignal(0)
let dirty = false

function begin(sessionID: string, at: number) {
  const next: Stats = {
    active: true,
    startedAt: at,
    firstAt: null,
    lastAt: null,
    spanMs: 0,
    window: [],
    live: null,
    last: null,
    peak: 0,
    tokens: 0,
    chars: 0,
    ttft: null,
  }
  const previous = stats.get(sessionID)
  if (previous && previous.last !== null) {
    next.last = previous.last
    next.peak = previous.peak
    next.tokens = previous.tokens
    next.ttft = previous.ttft
  }
  stats.set(sessionID, next)

  return next
}

function ensure(sessionID: string, at: number) {
  const found = stats.get(sessionID)

  if (found) return found

  return begin(sessionID, at)
}

function charsOf(text: unknown) {
  if (typeof text !== "string" || text.length === 0) return 0

  return [...text].length
}

function push(entry: Stats, at: number, chars: number) {
  if (chars <= 0) return

  if (entry.firstAt === null) {
    entry.firstAt = at
    entry.ttft = Math.max(0, at - entry.startedAt)
  }

  if (entry.lastAt !== null && at - entry.lastAt < GAP_MS) {
    entry.spanMs += at - entry.lastAt
  }

  entry.lastAt = at
  entry.chars += chars
  entry.window.push({ t: at, chars })

  const cutoff = at - WINDOW_MS
  while (entry.window.length > 0 && entry.window[0].t < cutoff) entry.window.shift()

  // The opening chunk carries time to first token, so it is counted in the
  // total but never in the rate: dividing it by the gap before it produced
  // five-digit readings.
  if (entry.window.length < 2) {
    entry.live = null
    return
  }

  const total = entry.window.slice(1).reduce((sum, item) => sum + item.chars, 0)
  const span = at - entry.window[0].t

  entry.live = span >= 300 ? total / CHARS_PER_TOKEN / (span / 1000) : null
}

function settle(entry: Stats) {
  entry.active = false
  entry.window = []
  entry.live = null

  if (entry.firstAt === null) return

  const span = Math.max(entry.spanMs, 300)
  const rate = entry.chars / CHARS_PER_TOKEN / (span / 1000)

  if (Number.isFinite(rate) && rate > 0) {
    entry.last = rate
    entry.peak = Math.max(entry.peak, rate)
  }
}

function unwrap(raw: any) {
  const data = raw?.properties ?? raw?.data ?? raw ?? {}
  const nested = data?.properties ?? data?.data ?? data

  return {
    type: String(raw?.type ?? nested?.type ?? ""),
    value: nested ?? {},
  }
}

function sessionIDOf(value: any) {
  return value?.sessionID ?? value?.properties?.sessionID ?? value?.data?.sessionID
}

function handle(raw: any) {
  const { type, value } = unwrap(raw)
  const sessionID = sessionIDOf(value)

  if (!type || !sessionID) return

  const at = Date.now()

  if (type === "session.execution.started") {
    begin(sessionID, at)
    dirty = true
    return
  }

  if (
    type === "session.execution.succeeded" ||
    type === "session.execution.failed" ||
    type === "session.execution.interrupted" ||
    type === "session.idle"
  ) {
    const entry = stats.get(sessionID)
    if (entry) settle(entry)
    dirty = true
    return
  }

  if (type === "session.step.started") {
    const entry = ensure(sessionID, at)
    entry.active = true
    dirty = true
    return
  }

  if (type === "session.step.ended" || type === "session.step.failed") {
    const entry = ensure(sessionID, at)
    const output = Number(value?.tokens?.output)
    const reasoning = Number(value?.tokens?.reasoning)
    const total = (Number.isFinite(output) ? output : 0) + (Number.isFinite(reasoning) ? reasoning : 0)

    if (total > 0) {
      entry.tokens = total

      if (entry.firstAt !== null) {
        const span = Math.max(entry.spanMs, 300)
        const rate = total / (span / 1000)

        if (Number.isFinite(rate) && rate > 0) {
          entry.last = rate
          entry.peak = Math.max(entry.peak, rate)
        }
      }
    }

    dirty = true
    return
  }

  if (type === "session.text.delta" || type === "session.reasoning.delta") {
    const entry = ensure(sessionID, at)
    entry.active = true
    push(entry, at, charsOf(value?.delta))
    dirty = true
    return
  }

  if (type === "session.tool.input.delta") {
    const entry = ensure(sessionID, at)
    entry.active = true
    push(entry, at, charsOf(value?.delta))
    dirty = true
  }
}

const EVENTS = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.text.delta",
  "session.reasoning.delta",
  "session.tool.input.delta",
  "session.idle",
] as const

function format(rate: number | null) {
  if (rate === null || !Number.isFinite(rate)) return "–"

  if (rate >= 100) return String(Math.round(rate))

  return rate.toFixed(1)
}

function tone(rate: number | null) {
  if (rate === null) return undefined

  if (rate < 10) return "danger" as const
  if (rate < 30) return "warning" as const

  return "success" as const
}

function rows(entry: Stats, sessionID: string, t: (key: string) => string) {
  return [
    { id: "live", label: t("row.live"), detail: `${format(entry.active ? entry.live : entry.last)} tok/s` },
    { id: "peak", label: t("row.peak"), detail: `${format(entry.peak || null)} tok/s` },
    {
      id: "ttft",
      label: t("row.ttft"),
      detail: entry.ttft === null ? "–" : `${(entry.ttft / 1000).toFixed(1)} s`,
    },
    { id: "tokens", label: t("row.tokens"), detail: entry.tokens > 0 ? String(entry.tokens) : "–" },
    {
      id: "reset",
      label: t("row.reset"),
      icon: "arrow-down-to-line" as const,
      run: () => {
        stats.delete(sessionID)
        setRev((value) => value + 1)
      },
    },
  ]
}

let entryKey = ""

export default Plugin.define({
  i18n: {
    en: {
      "pill.title": "Generation speed",
      "row.live": "Now",
      "row.peak": "Peak",
      "row.ttft": "Time to first token",
      "row.tokens": "Tokens in last step",
      "row.reset": "Reset",
    },
    ru: {
      "pill.title": "Скорость генерации",
      "row.live": "Сейчас",
      "row.peak": "Пик",
      "row.ttft": "Первый токен",
      "row.tokens": "Токенов в шаге",
      "row.reset": "Сбросить",
    },
  },
  setup(ctx) {
    const controller = new AbortController()

    const tick = setInterval(() => {
      if (!dirty) return
      dirty = false
      setRev((value) => value + 1)
    }, TICK_MS)

    const consume = async () => {
      while (!controller.signal.aborted) {
        try {
          const stream = (ctx.client as any).event.subscribe({
            types: EVENTS,
            signal: controller.signal,
          })

          for await (const event of stream) {
            if (controller.signal.aborted) return
            handle(event)
          }
        } catch {
          if (controller.signal.aborted) return
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    void consume()

    const current = (sessionID: string) => {
      rev()
      return stats.get(sessionID)
    }

    ctx.add(ComposerPill, {
      id: "tok-speed",
      order: 20,
      show: (input) => {
        const entry = current(input.session.id)

        if (!entry) return undefined

        const rate = entry.active ? entry.live : entry.last

        if (rate === null) return undefined

        return {
          label: `${format(rate)} tok/s`,
          icon: "waveform",
          tone: tone(rate),
          title: ctx.t("pill.title"),
          rows: rows(entry, input.session.id, (key) => ctx.t(key)) as any,
        }
      },
    })

    // A quieter readout in the timeline's title row, so the number is visible
    // even while the composer is scrolled out of view.
    ctx.add(Slot, {
      at: "session.header",
      order: 20,
      render: (input) => {
        const rate = createMemo(() => {
          const entry = current(input.session.id)

          if (!entry) return null

          return entry.active ? entry.live : entry.last
        })

        return (
          <Show when={rate()}>
            {(value) => (
              <span
                title={ctx.t("pill.title")}
                style={{
                  "font-size": "12px",
                  opacity: 0.7,
                  "font-variant-numeric": "tabular-nums",
                  "white-space": "nowrap",
                }}
              >
                {format(value())} tok/s
              </span>
            )}
          </Show>
        )
      },
    })

    return () => {
      clearInterval(tick)
      controller.abort()
    }
  },
})
