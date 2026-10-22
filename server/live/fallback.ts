import type { LiveAudioConnection, LiveConnection, LiveGateway, LiveHandlers } from './gateway.js';
import type { MediaSessionConfig, SessionConfig } from 'openai/resources/live/live';

/** Uses the fallback only when the custom provider cannot start a new session. */
export function withGatewayFallback(
  primary: LiveGateway,
  fallback: LiveGateway | null,
): LiveGateway {
  if (!fallback) return primary;
  const fallbackIds = new Set<string>();
  return {
    provider: primary.provider,
    serverAudio: primary.serverAudio,
    async prewarm() {
      try {
        await primary.prewarm?.();
      } catch {
        await fallback.prewarm?.();
      }
    },
    async create(config: MediaSessionConfig, sdp: string, signal?: AbortSignal) {
      try {
        return await primary.create(config, sdp, signal);
      } catch {
        const created = await fallback.create(config, sdp, signal);
        fallbackIds.add(created.session.id);
        return created;
      }
    },
    attach(id: string, handlers: LiveHandlers): LiveConnection {
      return (fallbackIds.delete(id) ? fallback : primary).attach(id, handlers);
    },
    async hangup(id: string) {
      await primary.hangup?.(id).catch(async () => fallback.hangup?.(id));
    },
    connect(
      session: SessionConfig,
      handlers: LiveHandlers,
      welcomeMessage?: string,
    ): LiveAudioConnection {
      if (primary.connect) return primary.connect(session, handlers, welcomeMessage);
      if (!fallback.connect) throw new Error('Fournisseur de secours indisponible.');
      return fallback.connect(session, handlers, welcomeMessage);
    },
  };
}
