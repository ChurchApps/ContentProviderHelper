import { ContentProvider } from '../ContentProvider';
import { ProviderInfo, ProviderLogos } from '../interfaces';
import { APlayProvider } from './APlayProvider';
import { SignPresenterProvider } from './SignPresenterProvider';
import { LessonsChurchProvider } from './LessonsChurchProvider';
import { B1ChurchProvider } from './B1ChurchProvider';
import { PlanningCenterProvider } from './PlanningCenterProvider';

export { APlayProvider } from './APlayProvider';
export { SignPresenterProvider } from './SignPresenterProvider';
export { LessonsChurchProvider } from './LessonsChurchProvider';
export { B1ChurchProvider } from './B1ChurchProvider';
export { PlanningCenterProvider } from './PlanningCenterProvider';

// Provider registry - singleton instances
const providerRegistry: Map<string, ContentProvider> = new Map();

// Unimplemented providers (coming soon)
interface UnimplementedProvider {
  id: string;
  name: string;
  logos: ProviderLogos;
}

const unimplementedProviders: UnimplementedProvider[] = [
  {
    id: 'freeshow',
    name: 'FreeShow',
    logos: {
      light: 'https://freeshow.app/images/favicon.png',
      dark: 'https://freeshow.app/images/favicon.png',
    },
  },
  {
    id: 'gocurriculum',
    name: 'Go Curriculum',
    logos: {
      light: 'https://gocurriculum.com/wp-content/uploads/go-logo-curriculum-v2.png',
      dark: 'https://gocurriculum.com/wp-content/uploads/go-logo-curriculum-v2.png',
    },
  },
  {
    id: 'lifechurch',
    name: 'LifeChurch',
    logos: {
      light: 'https://cdn.brandfetch.io/idRrA6pM45/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1668042253613',
      dark: 'https://cdn.brandfetch.io/idRrA6pM45/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1668042253613',
    },
  },
  {
    id: 'awana',
    name: 'Awana',
    logos: {
      light: 'https://www.awana.org/wp-content/uploads/2025/04/awana-logo-black.svg',
      dark: 'https://www.awana.org/wp-content/uploads/2025/04/awana-logo-white.svg',
    },
  },
  {
    id: 'iteachchurch',
    name: 'iTeachChurch',
    logos: {
      light: 'https://iteachchurch.com/wp-content/uploads/2022/05/iTeachChurch_Artboard-1-copy-3@2x.png',
      dark: 'https://iteachchurch.com/wp-content/uploads/2022/05/iTeachChurch_Artboard-1-copy-3@2x.png',
    },
  },
  {
    id: 'ministrystuff',
    name: 'MinistryStuff',
    logos: {
      light: '',
      dark: '',
    },
  },
  {
    id: 'highvoltagekids',
    name: 'High Voltage Kids',
    logos: {
      light: 'https://highvoltagekids.com/wp-content/uploads/2023/10/logo-300x300-1.webp',
      dark: 'https://highvoltagekids.com/wp-content/uploads/2023/10/logo-300x300-1.webp',
    },
  },
];

// Register built-in providers
function initializeProviders() {
  const aplay = new APlayProvider();
  const signPresenter = new SignPresenterProvider();
  const lessonsChurch = new LessonsChurchProvider();
  const b1Church = new B1ChurchProvider();
  const planningCenter = new PlanningCenterProvider();

  providerRegistry.set(aplay.id, aplay);
  providerRegistry.set(signPresenter.id, signPresenter);
  providerRegistry.set(lessonsChurch.id, lessonsChurch);
  providerRegistry.set(b1Church.id, b1Church);
  providerRegistry.set(planningCenter.id, planningCenter);
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
 * Includes both implemented providers and coming soon providers.
 */
export function getAvailableProviders(): ProviderInfo[] {
  // Implemented providers
  const implemented: ProviderInfo[] = getAllProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    logos: provider.logos,
    implemented: true,
    requiresAuth: provider.requiresAuth(),
    authTypes: provider.getAuthTypes(),
    capabilities: provider.getCapabilities(),
  }));

  // Coming soon providers
  const comingSoon: ProviderInfo[] = unimplementedProviders.map((p) => ({
    id: p.id,
    name: p.name,
    logos: p.logos,
    implemented: false,
    requiresAuth: false,
    authTypes: [],
    capabilities: { browse: false, presentations: false, playlist: false, instructions: false, expandedInstructions: false, mediaLicensing: false },
  }));

  return [...implemented, ...comingSoon];
}
