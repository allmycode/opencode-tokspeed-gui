# opencode-tokspeed-gui

Live token generation speed for **OpenCode Desktop**.

A pill above the composer shows how fast the model is writing right now — the
same number you would otherwise guess at. A small readout also sits in the
session header. Click the pill for the current rate, peak, time to first token,
tokens in the last step, and a reset action.

```
waveform  42.0 tok/s
```

> OpenCode has no built-in `tok/s` readout (see
> [#5374](https://github.com/anomalyco/opencode/issues/5374),
> [#47914](https://github.com/anomalyco/opencode/issues/47914)). This plugin adds
> one to the desktop app, where the GUI plugin API first appeared in 2.2.0.

---

## How the number is measured

The plugin subscribes to the server's event stream in the window
(`ctx.client.event.subscribe`) and counts only what the model itself writes:

| counted | not counted |
| --- | --- |
| `session.text.delta` | tool execution time |
| `session.reasoning.delta` | queueing, compaction, synthetic items |
| `session.tool.input.delta` (tool-call arguments) | user prompts |

- The live rate is a rolling 2 second window timed by the host's timestamps.
- The **first chunk is excluded from the rate** — it includes time to first
  token, and dividing it by the gap before it is what produces five-digit
  readings elsewhere.
- A silence longer than 30 seconds is treated as a dropped stream and is not
  counted as model time.
- When a step ends, the estimate is replaced by the provider-reported
  `tokens.output + tokens.reasoning` divided by the measured stream span.
- If the provider reports no token counts, the settled rate is the character
  estimate, not a guess dressed up as an exact one.

TTFT is measured from `session.execution.started` to the first delta.

## Requirements

- **OpenCode Desktop 2.2.0 or newer.** The plugin uses the `Slot` and
  `ComposerPill` GUI APIs from `@opencode/plugin/gui`.
- The plugin must be listed in the **global** `opencode.json(c)`. The desktop
  app reads only that file, not `cli.json`.

## Install

Clone the repository somewhere and point the global config at the directory:

```sh
git clone https://github.com/allmycode/opencode-tokspeed-gui.git
```

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    "file:///C:/Users/you/opencode-tokspeed-gui"
  ]
}
```

On macOS or Linux the path is `file:///Users/you/opencode-tokspeed-gui` and so
on. Restart OpenCode Desktop once after adding the entry. After that, a rebuild
of the bundle reloads the GUI in every open window.

Check **Settings → Extensions → Plugins**: the row `opencode-tokspeed-gui` has a
switch that turns the GUI off without removing the plugin.

`gui-experimental.cjs` is committed on purpose. OpenCode does not build GUI
parts; it loads the prebuilt CommonJS bundle, so a fresh clone works without a
build step.

## Build

```sh
npm install
npm run build     # writes gui-experimental.cjs
npm run watch     # rebuild on change; each rebuild reloads the GUI
```

The bundle is built with the official Vite preset:

```ts
gui({ entry: "src/gui.tsx", outFile: "gui-experimental.cjs" })
```

## Development

`node test-harness.cjs` loads the bundle with stubbed `solid-js` and
`@opencode/plugin/gui` modules, feeds it a synthetic stream of events, and
prints the pill the host would render. No OpenCode install is needed.

```
{
  "registered": true,
  "pill": {
    "label": "259 tok/s",
    "icon": "waveform",
    "tone": "success",
    "rows": [ ... ]
  }
}
```

## Layout

| file | role |
| --- | --- |
| `src/gui.tsx` | event subscription, measurement, pill and header slot |
| `server.ts` | empty server half: registers the plugin so the desktop can read the bundle |
| `gui-experimental.cjs` | built bundle loaded by the app |
| `test-harness.cjs` | offline check with stubbed host modules |

A server half is present even though all logic is in the GUI: the loader only
publishes a local directory's `./gui-experimental` bundle when the package is an
active plugin with a name and a `server` (or `index`) entry at its root.

## Limitations

- Pill positions, the composer row and the header slot belong to the app, so
  spacing follows OpenCode's own layout.
- Subagent sessions have no composer, so they show only the header readout.
- The GUI plugin API is experimental; a future OpenCode release may change it.
- Measurements are local to this machine and are not persisted across restarts.

## License

MIT. Not built by the OpenCode team and not affiliated with OpenCode.

---

## По-русски

Плагин показывает скорость генерации токенов в OpenCode Desktop: пилл над
композером (`42.0 tok/s`) и мелкий индикатор в заголовке сессии. Клик по пиллу —
текущая скорость, пик, время до первого токена, токены последнего шага и сброс.

Считается только вывод модели: текст, reasoning и аргументы tool-call. Время
инструментов в знаменатель не попадает; по завершении шага оценка заменяется
точным числом токенов от провайдера.

Установка: склонировать репозиторий и добавить путь к каталогу в глобальный
`~/.config/opencode/opencode.jsonc` (`plugins`), затем один раз перезапустить
Desktop. Нужен OpenCode Desktop 2.2.0+.
