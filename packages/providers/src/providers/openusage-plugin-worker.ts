import { OpenUsagePluginProvider } from "./openusage-plugin";
import type { OpenUsagePluginWorkerOptions } from "./openusage-plugin-refresh-worker";

declare var self: Worker;

// Call refreshInThread(). refresh() would spawn another worker for the default runtime.
self.onmessage = (event: MessageEvent<{ options: OpenUsagePluginWorkerOptions }>) => {
  const provider = new OpenUsagePluginProvider(event.data.options);
  void provider.refreshInThread().then(
    (records) => {
      self.postMessage({ ok: true, records, codexEventResult: provider.takeCodexEventResult() });
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ ok: false, error: message });
    },
  );
};
