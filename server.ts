import { Plugin } from "@opencode/plugin"

/**
 * The measurement lives in the GUI bundle (`gui-experimental.cjs`, built from
 * `src/gui.tsx`). This server half only registers the plugin so the desktop app
 * can read that bundle; it adds no tools and no hooks.
 */
export default Plugin.define({
  id: "opencode-tokspeed-gui",
  setup() {},
})
