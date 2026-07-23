import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { app } from "electron";

let logProvider: LoggerProvider | null = null;
let traceProvider: NodeTracerProvider | null = null;

function config(): { key: string; host: string } | null {
  if (process.env.ANALYTICS_ENABLED === "false") return null;
  const key =
    process.env.PIPPER_POSTHOG_KEY ?? process.env.POSTHOG_KEY ?? import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return null;
  const host =
    process.env.PIPPER_POSTHOG_HOST ??
    process.env.POSTHOG_HOST ??
    import.meta.env.VITE_POSTHOG_HOST ??
    "https://us.i.posthog.com";
  return { key, host: host.replace(/\/$/, "") };
}

/**
 * Export main-process logs and operation spans through OTLP. Renderer telemetry
 * intentionally stays out of this module: it cannot safely access the project
 * token and instead reports uncaught errors through the IPC boundary.
 */
export function initializeTelemetry(): void {
  if (logProvider || traceProvider) return;
  const settings = config();
  if (!settings) return;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "pipper-desktop-main",
    [ATTR_SERVICE_VERSION]: app.getVersion(),
    "service.instance.id": `${process.platform}-${process.pid}`,
  });
  const headers = { Authorization: `Bearer ${settings.key}` };

  logProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${settings.host}/i/v1/logs`, headers }),
      }),
    ],
  });
  logs.setGlobalLoggerProvider(logProvider);

  traceProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${settings.host}/i/v1/traces`, headers }),
      ),
    ],
  });
  traceProvider.register();
}

export function logTelemetryError(message: string, attributes: Record<string, string> = {}): void {
  logs.getLogger("pipper-desktop-main").emit({
    severityText: "ERROR",
    body: message,
    attributes,
  });
  trace.getTracer("pipper-desktop-main").startActiveSpan("desktop.error", (span) => {
    span.setAttributes({ "error.message": message, ...attributes });
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.end();
  });
}

/** Flush queued OTLP logs and traces without shutting their exporters down. */
export async function flushTelemetry(): Promise<void> {
  await Promise.all([logProvider?.forceFlush(), traceProvider?.forceFlush()]);
}

export async function shutdownTelemetry(): Promise<void> {
  await Promise.all([logProvider?.shutdown(), traceProvider?.shutdown()]);
  logProvider = null;
  traceProvider = null;
}
