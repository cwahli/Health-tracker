import { logSessionStorage, sessionDebugLogs, globalDebugLogs } from './server.js';
import { attachSseJsonResponder } from './server_sse_json.js';

export function initializeAnalysisRun(req: any, res: any) {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }

  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;
  const sessionId = logSessionStorage.getStore() || "global";
  const initialLogCount = (sessionDebugLogs[sessionId] || globalDebugLogs).length;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    hasSentHeaders = true;
    attachSseJsonResponder(res);
    // R-13.2: SSE comment keepalive on the loopback analyze stream. The
    // serverJobs loopback fetch aborts at 180s; without traffic a proxy
    // (orange-cloud) kills the silent connection with a 524 first.
    // Same 15s idiom as the debug live-stream in server.ts.
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch {
        clearInterval(pingInterval);
      }
    }, 15000);
    if (typeof (pingInterval as any).unref === 'function') (pingInterval as any).unref();
    const stopSsePing = () => clearInterval(pingInterval);
    if (typeof req?.on === 'function') req.on('close', stopSsePing);
    if (typeof (res as any)?.on === 'function') {
      (res as any).on('finish', stopSsePing);
      (res as any).on('error', stopSsePing);
    }
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  return { isStream, hasSentHeaders, sessionId, initialLogCount, sendStreamEvent };
}
