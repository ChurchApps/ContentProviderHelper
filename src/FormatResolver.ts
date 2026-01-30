import type { IProvider, ContentFile, ContentFolder, ContentProviderAuthData, Plan, Instructions } from './interfaces';
import * as Converters from './FormatConverters';

export interface FormatResolverOptions {
  allowLossy?: boolean;
}

export interface ResolvedFormatMeta {
  isNative: boolean;
  sourceFormat?: 'playlist' | 'presentations' | 'instructions' | 'expandedInstructions';
  isLossy: boolean;
}

export class FormatResolver {
  private provider: IProvider;
  private options: Required<FormatResolverOptions>;

  constructor(provider: IProvider, options: FormatResolverOptions = {}) {
    this.provider = provider;
    this.options = { allowLossy: options.allowLossy ?? true };
  }

  getProvider(): IProvider {
    return this.provider;
  }

  async getPlaylist(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentFile[] | null> {
    const caps = this.provider.capabilities;

    if (caps.playlist && this.provider.getPlaylist) {
      const result = await this.provider.getPlaylist(folder, auth);
      if (result && result.length > 0) return result;
    }

    if (caps.presentations) {
      const plan = await this.provider.getPresentations(folder, auth);
      if (plan) return Converters.presentationsToPlaylist(plan);
    }

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const expanded = await this.provider.getExpandedInstructions(folder, auth);
      if (expanded) return Converters.instructionsToPlaylist(expanded);
    }

    if (this.options.allowLossy && caps.instructions && this.provider.getInstructions) {
      const instructions = await this.provider.getInstructions(folder, auth);
      if (instructions) return Converters.instructionsToPlaylist(instructions);
    }

    return null;
  }

  async getPlaylistWithMeta(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<{ data: ContentFile[] | null; meta: ResolvedFormatMeta }> {
    const caps = this.provider.capabilities;

    if (caps.playlist && this.provider.getPlaylist) {
      const result = await this.provider.getPlaylist(folder, auth);
      if (result && result.length > 0) {
        return { data: result, meta: { isNative: true, isLossy: false } };
      }
    }

    if (caps.presentations) {
      const plan = await this.provider.getPresentations(folder, auth);
      if (plan) return { data: Converters.presentationsToPlaylist(plan), meta: { isNative: false, sourceFormat: 'presentations', isLossy: false } };
    }

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const expanded = await this.provider.getExpandedInstructions(folder, auth);
      if (expanded) return { data: Converters.instructionsToPlaylist(expanded), meta: { isNative: false, sourceFormat: 'expandedInstructions', isLossy: false } };
    }

    if (this.options.allowLossy && caps.instructions && this.provider.getInstructions) {
      const instructions = await this.provider.getInstructions(folder, auth);
      if (instructions) return { data: Converters.instructionsToPlaylist(instructions), meta: { isNative: false, sourceFormat: 'instructions', isLossy: true } };
    }

    return { data: null, meta: { isNative: false, isLossy: false } };
  }

  async getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const caps = this.provider.capabilities;

    if (caps.presentations) {
      const result = await this.provider.getPresentations(folder, auth);
      if (result) return result;
    }

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const expanded = await this.provider.getExpandedInstructions(folder, auth);
      if (expanded) return Converters.instructionsToPresentations(expanded, folder.id);
    }

    if (caps.instructions && this.provider.getInstructions) {
      const instructions = await this.provider.getInstructions(folder, auth);
      if (instructions) return Converters.instructionsToPresentations(instructions, folder.id);
    }

    if (this.options.allowLossy && caps.playlist && this.provider.getPlaylist) {
      const playlist = await this.provider.getPlaylist(folder, auth);
      if (playlist && playlist.length > 0) {
        return Converters.playlistToPresentations(playlist, folder.title);
      }
    }

    return null;
  }

  async getPresentationsWithMeta(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<{ data: Plan | null; meta: ResolvedFormatMeta }> {
    const caps = this.provider.capabilities;

    if (caps.presentations) {
      const result = await this.provider.getPresentations(folder, auth);
      if (result) {
        return { data: result, meta: { isNative: true, isLossy: false } };
      }
    }

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const expanded = await this.provider.getExpandedInstructions(folder, auth);
      if (expanded) return { data: Converters.instructionsToPresentations(expanded, folder.id), meta: { isNative: false, sourceFormat: 'expandedInstructions', isLossy: false } };
    }

    if (caps.instructions && this.provider.getInstructions) {
      const instructions = await this.provider.getInstructions(folder, auth);
      if (instructions) return { data: Converters.instructionsToPresentations(instructions, folder.id), meta: { isNative: false, sourceFormat: 'instructions', isLossy: true } };
    }

    if (this.options.allowLossy && caps.playlist && this.provider.getPlaylist) {
      const playlist = await this.provider.getPlaylist(folder, auth);
      if (playlist && playlist.length > 0) return { data: Converters.playlistToPresentations(playlist, folder.title), meta: { isNative: false, sourceFormat: 'playlist', isLossy: true } };
    }

    return { data: null, meta: { isNative: false, isLossy: false } };
  }

  async getInstructions(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const caps = this.provider.capabilities;

    if (caps.instructions && this.provider.getInstructions) {
      const result = await this.provider.getInstructions(folder, auth);
      if (result) return result;
    }

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const expanded = await this.provider.getExpandedInstructions(folder, auth);
      if (expanded) return Converters.collapseInstructions(expanded);
    }

    if (caps.presentations) {
      const plan = await this.provider.getPresentations(folder, auth);
      if (plan) return Converters.presentationsToInstructions(plan);
    }

    if (this.options.allowLossy && caps.playlist && this.provider.getPlaylist) {
      const playlist = await this.provider.getPlaylist(folder, auth);
      if (playlist && playlist.length > 0) {
        return Converters.playlistToInstructions(playlist, folder.title);
      }
    }

    return null;
  }

  async getInstructionsWithMeta(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<{ data: Instructions | null; meta: ResolvedFormatMeta }> {
    const caps = this.provider.capabilities;

    if (caps.instructions && this.provider.getInstructions) {
      const result = await this.provider.getInstructions(folder, auth);
      if (result) {
        return { data: result, meta: { isNative: true, isLossy: false } };
      }
    }

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const expanded = await this.provider.getExpandedInstructions(folder, auth);
      if (expanded) return { data: Converters.collapseInstructions(expanded), meta: { isNative: false, sourceFormat: 'expandedInstructions', isLossy: true } };
    }

    if (caps.presentations) {
      const plan = await this.provider.getPresentations(folder, auth);
      if (plan) return { data: Converters.presentationsToInstructions(plan), meta: { isNative: false, sourceFormat: 'presentations', isLossy: false } };
    }

    if (this.options.allowLossy && caps.playlist && this.provider.getPlaylist) {
      const playlist = await this.provider.getPlaylist(folder, auth);
      if (playlist && playlist.length > 0) return { data: Converters.playlistToInstructions(playlist, folder.title), meta: { isNative: false, sourceFormat: 'playlist', isLossy: true } };
    }

    return { data: null, meta: { isNative: false, isLossy: false } };
  }

  async getExpandedInstructions(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const caps = this.provider.capabilities;

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const result = await this.provider.getExpandedInstructions(folder, auth);
      if (result) return result;
    }

    if (caps.presentations) {
      const plan = await this.provider.getPresentations(folder, auth);
      if (plan) return Converters.presentationsToExpandedInstructions(plan);
    }

    if (caps.instructions && this.provider.getInstructions) {
      const instructions = await this.provider.getInstructions(folder, auth);
      if (instructions) return instructions;
    }

    if (this.options.allowLossy && caps.playlist && this.provider.getPlaylist) {
      const playlist = await this.provider.getPlaylist(folder, auth);
      if (playlist && playlist.length > 0) {
        return Converters.playlistToInstructions(playlist, folder.title);
      }
    }

    return null;
  }

  async getExpandedInstructionsWithMeta(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<{ data: Instructions | null; meta: ResolvedFormatMeta }> {
    const caps = this.provider.capabilities;

    if (caps.expandedInstructions && this.provider.getExpandedInstructions) {
      const result = await this.provider.getExpandedInstructions(folder, auth);
      if (result) {
        return { data: result, meta: { isNative: true, isLossy: false } };
      }
    }

    if (caps.presentations) {
      const plan = await this.provider.getPresentations(folder, auth);
      if (plan) return { data: Converters.presentationsToExpandedInstructions(plan), meta: { isNative: false, sourceFormat: 'presentations', isLossy: false } };
    }

    if (caps.instructions && this.provider.getInstructions) {
      const instructions = await this.provider.getInstructions(folder, auth);
      if (instructions) return { data: instructions, meta: { isNative: false, sourceFormat: 'instructions', isLossy: true } };
    }

    if (this.options.allowLossy && caps.playlist && this.provider.getPlaylist) {
      const playlist = await this.provider.getPlaylist(folder, auth);
      if (playlist && playlist.length > 0) return { data: Converters.playlistToInstructions(playlist, folder.title), meta: { isNative: false, sourceFormat: 'playlist', isLossy: true } };
    }

    return { data: null, meta: { isNative: false, isLossy: false } };
  }
}
