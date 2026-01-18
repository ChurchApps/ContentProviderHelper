/**
 * @churchapps/content-provider-helper
 * Helper classes for interacting with third party content providers
 */

export const VERSION = "0.0.1";

// Interfaces
export * from './interfaces';

// Base class (for extending with custom providers)
export { ContentProvider } from './ContentProvider';

// Built-in providers
export { APlayProvider } from './providers/APlayProvider';
export { SignPresenterProvider } from './providers/SignPresenterProvider';
export { LessonsChurchProvider } from './providers/LessonsChurchProvider';

// Registry functions
export {
  getProvider,
  getAllProviders,
  registerProvider,
  getProviderConfig,
  getAvailableProviders,
} from './providers';
