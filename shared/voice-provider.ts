export const VOICE_PROVIDERS = ['openai', 'mistral', 'custom'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export const voiceProviderLabel = (provider: VoiceProvider) =>
  provider === 'mistral'
    ? 'Mistral · Voxtral 3'
    : provider === 'custom'
      ? 'Fournisseur personnalisé · Realtime'
      : 'OpenAI · GPT Live';
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'openai' || value === 'mistral' || value === 'custom';
}
