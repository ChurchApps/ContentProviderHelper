/**
 * @churchapps/content-provider-helper
 * Helper classes for interacting with third party content providers
 */

export const VERSION = "0.0.1";

// Interfaces
export * from "./interfaces";

// Utilities
export { detectMediaType, createFolder, createFile } from "./utils";
export { parsePath, getSegment, buildPath, appendToPath } from "./pathUtils";

// Format conversion utilities
export * as FormatConverters from "./FormatConverters";
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
} from "./FormatConverters";

// Format resolver
export { FormatResolver, type FormatResolverOptions, type ResolvedFormatMeta } from "./FormatResolver";

// Base class (for extending with custom providers)
// @deprecated Use IProvider interface instead. ContentProvider will be removed in a future version.
export { ContentProvider } from "./ContentProvider";

// Helper classes (for standalone use or custom providers)
export { OAuthHelper, TokenHelper, DeviceFlowHelper, ApiHelper } from "./helpers";

// Built-in providers
export { APlayProvider } from "./providers/aPlay";
export { SignPresenterProvider } from "./providers/signPresenter";
export { LessonsChurchProvider } from "./providers/lessonsChurch";
export { B1ChurchProvider } from "./providers/b1Church";
export { PlanningCenterProvider } from "./providers/planningCenter";
export { BibleProjectProvider } from "./providers/bibleProject";
export { HighVoltageKidsProvider } from "./providers/highVoltage";

// Registry functions
export {
  getProvider,
  getAllProviders,
  registerProvider,
  getProviderConfig,
  getAvailableProviders,
} from "./providers";
