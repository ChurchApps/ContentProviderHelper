import { FeedVenueInterface } from '../../interfaces';
import { ArrangementKeyResponse } from './types';

/** Base URL for Lessons.church API */
export const LESSONS_API_BASE = 'https://api.lessons.church';

/** Base URL for ChurchApps Content API */
export const CONTENT_API_BASE = 'https://contentapi.churchapps.org';

/**
 * Fetch venue feed from Lessons.church API.
 */
export async function fetchVenueFeed(venueId: string): Promise<FeedVenueInterface | null> {
  try {
    const url = `${LESSONS_API_BASE}/venues/public/feed/${venueId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch arrangement key data from ChurchApps Content API.
 */
export async function fetchArrangementKey(
  churchId: string,
  arrangementId: string
): Promise<ArrangementKeyResponse | null> {
  try {
    const url = `${CONTENT_API_BASE}/arrangementKeys/presenter/${churchId}/${arrangementId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
