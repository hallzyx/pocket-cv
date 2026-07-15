// ---------------------------------------------------------------------------
// Provider abstraction — factory and registry
// ---------------------------------------------------------------------------

import type { ChatProvider } from "./types";
import { DeepSeekProvider } from "./deepseek";

export type ProviderName = "deepseek";

const providerConstructors: Record<
  ProviderName,
  () => ChatProvider
> = {
  deepseek: () => new DeepSeekProvider(),
};

/**
 * Extra provider factories registered by tests or runtime extensions.
 * Checked before the built-in constructors so tests can inject fakes.
 */
const extraProviders = new Map<string, () => ChatProvider>();

/**
 * Register a custom (e.g. test fake) provider factory.
 * When the name matches, createProvider returns the custom provider.
 */
export function registerProvider(name: string, factory: () => ChatProvider): void {
  extraProviders.set(name, factory);
}

/**
 * Create a ChatProvider by name.
 * Checks extra (registered) providers first, then built-in constructors.
 * Throws if the name is unknown or if provider validation fails.
 */
export function createProvider(name: string): ChatProvider {
  const extra = extraProviders.get(name);
  if (extra) return extra();

  const factory = providerConstructors[name as ProviderName];
  if (!factory) {
    throw new Error(`Unknown provider: ${name}. Valid: ${[...extraProviders.keys(), ...Object.keys(providerConstructors)].join(", ")}`);
  }
  return factory();
}

/** List of registered provider names */
export function listProviders(): ProviderName[] {
  return Object.keys(providerConstructors) as ProviderName[];
}
