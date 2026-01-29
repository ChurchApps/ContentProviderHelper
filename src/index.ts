/**
 * @churchapps/content-provider-helper
 * Helper classes for interacting with third party content providers
 */

export const VERSION = "0.0.1";

// Interfaces
export * from './interfaces';

// Utilities
export { detectMediaType } from './utils';

// Format conversion utilities
export * as FormatConverters from './FormatConverters';
export {
  presentationsToPlaylist,
  presentationsToInstructions,
  presentationsToExpandedInstructions,
  instructionsToPlaylist,
  expandedInstructionsToPlaylist,
  instructionsToPresentations,
  expandedInstructionsToPresentations,
  collapseInstructions,
  playlistToPresentations,
  playlistToInstructions,
  playlistToExpandedInstructions
} from './FormatConverters';

// Format resolver
export { FormatResolver, type FormatResolverOptions, type ResolvedFormatMeta } from './FormatResolver';

// Base class (for extending with custom providers)
export { ContentProvider } from './ContentProvider';

// Built-in providers
export { APlayProvider } from './providers/APlayProvider';
export { SignPresenterProvider } from './providers/SignPresenterProvider';
export { LessonsChurchProvider } from './providers/LessonsChurchProvider';
export { B1ChurchProvider } from './providers/b1church';
export { PlanningCenterProvider } from './providers/PlanningCenterProvider';
export { BibleProjectProvider } from './providers/bibleproject';

// Registry functions
export {
  getProvider,
  getAllProviders,
  registerProvider,
  getProviderConfig,
  getAvailableProviders,
} from './providers';
