const Module = require("node:module")
const path = require("node:path")

const original = Module._load

Module._load = function (request, parent, isMain) {
  if (request === "solid-js") {
    return {
      createSignal(initial) {
        let value = initial
        return [
          () => value,
          (next) => {
            value = typeof next === "function" ? next(value) : next
          },
        ]
      },
      createMemo(fn) {
        return fn
      },
      Show(props) {
        const value = props.when()
        return value ? props.children(value) : null
      },
    }
  }

  if (request === "solid-js/web") {
    return {
      template: () => ({ firstChild: null }),
      insert: () => {},
      effect: () => {},
      setAttribute: () => {},
    }
  }

  if (request === "@opencode/plugin/gui") {
    return {
      Plugin: { define: (definition) => definition },
      ComposerPill: "pill",
      Slot: "slot",
    }
  }

  return original.call(this, request, parent, isMain)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const bundle = path.join(__dirname, "gui-experimental.cjs")
const definition = require(bundle).default

let pill
const errors = []

const ctx = {
  add(registry, item) {
    if (registry === "pill") pill = item
  },
  t: (key) => key,
  client: {
    event: {
      subscribe: () =>
        (async function* () {
          const now = Date.now()
          yield { type: "session.execution.started", properties: { sessionID: "ses_1", created: now } }
          yield { type: "session.step.started", properties: { sessionID: "ses_1", started: now } }
          await sleep(120)
          yield { type: "session.text.delta", properties: { sessionID: "ses_1", assistantMessageID: "msg_1", delta: "x".repeat(160) } }
          await sleep(300)
          yield { type: "session.text.delta", properties: { sessionID: "ses_1", assistantMessageID: "msg_1", delta: "y".repeat(160) } }
          await sleep(20)
          yield { type: "session.step.ended", properties: { sessionID: "ses_1", assistantMessageID: "msg_1", tokens: { output: 80, reasoning: 0 } } }
          yield { type: "session.idle", properties: { sessionID: "ses_1" } }
        })(),
    },
  },
}

try {
  definition.setup(ctx)
} catch (error) {
  errors.push(["setup", error])
}

async function main() {
  await sleep(600)

  const view = pill?.show({ session: { id: "ses_1" }, screen: {} })

  console.log(
    JSON.stringify(
      {
        registered: Boolean(pill),
        setupErrors: errors.map(([where, error]) => `${where}: ${error.message}`),
        pill: view,
      },
      null,
      2,
    ),
  )

  process.exit(0)
}

void main()
