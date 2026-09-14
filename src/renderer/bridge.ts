import type { ScoutAgentEvent, ScoutState } from '../types/shared.js';

/**
 * The `window.scout` bridge injected by the Electron preload. In a plain
 * browser (Vite dev / preview) it is absent and demo mode drives the UI with
 * a scripted research run instead.
 */
export interface ScoutBridge {
  send(text: string): Promise<void>;
  abort(): Promise<void>;
  state(): Promise<ScoutState>;
  onEvent(cb: (event: ScoutAgentEvent) => void): () => void;
}

export function getBridge(): ScoutBridge | null {
  const candidate = (window as { scout?: ScoutBridge }).scout;
  return typeof candidate === 'object' && candidate !== null ? candidate : null;
}

export type { ScoutAgentEvent, ScoutState };
