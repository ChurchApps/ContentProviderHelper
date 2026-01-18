import { ContentProvider } from '../ContentProvider';
import { ProviderInfo } from '../interfaces';
import { APlayProvider } from './APlayProvider';
import { SignPresenterProvider } from './SignPresenterProvider';
import { LessonsChurchProvider } from './LessonsChurchProvider';

export { APlayProvider } from './APlayProvider';
export { SignPresenterProvider } from './SignPresenterProvider';
export { LessonsChurchProvider } from './LessonsChurchProvider';

// Provider registry - singleton instances
const providerRegistry: Map<string, ContentProvider> = new Map();

// Register built-in providers
function initializeProviders() {
  const aplay = new APlayProvider();
  const signPresenter = new SignPresenterProvider();
  const lessonsChurch = new LessonsChurchProvider();

  providerRegistry.set(aplay.id, aplay);
  providerRegistry.set(signPresenter.id, signPresenter);
  providerRegistry.set(lessonsChurch.id, lessonsChurch);
}

// Initialize on module load
initializeProviders();

/**
 * Get a provider by ID.
 */
export function getProvider(providerId: string): ContentProvider | null {
  return providerRegistry.get(providerId) || null;
}

/**
 * Get all registered providers.
 */
export function getAllProviders(): ContentProvider[] {
  return Array.from(providerRegistry.values());
}

/**
 * Register a custom provider.
 */
export function registerProvider(provider: ContentProvider): void {
  providerRegistry.set(provider.id, provider);
}

/**
 * Get provider configuration by ID (for backward compatibility).
 */
export function getProviderConfig(providerId: string) {
  const provider = getProvider(providerId);
  return provider?.config || null;
}

/**
 * Get list of available providers with their info including logos and auth types.
 */
export function getAvailableProviders(): ProviderInfo[] {
  return getAllProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    logos: provider.logos,
    requiresAuth: provider.requiresAuth(),
    authTypes: provider.getAuthTypes(),
  }));
}
