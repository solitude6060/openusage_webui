// Placeholder so the red-phase tests fail on assertions instead of a missing module.
globalThis.__openusage_plugin = {
  id: "ollama",
  probe: function () {
    throw "not implemented"
  },
}
