import { ContentProviderAuthData, FeedVenueInterface } from '../../interfaces';
import { ArrangementKeyResponse, B1Ministry, B1PlanType, B1Plan } from './types';

/** Base URLs for ChurchApps APIs */
export const API_BASE = 'https://api.churchapps.org';
export const LESSONS_API_BASE = 'https://api.lessons.church';
export const CONTENT_API_BASE = 'https://contentapi.churchapps.org';

/**
 * Make an authenticated API request.
 */
async function authFetch<T>(url: string, auth: ContentProviderAuthData | null | undefined): Promise<T | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth) {
      headers['Authorization'] = `Bearer ${auth.access_token}`;
    }
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch ministries (groups with "ministry" tag) from MembershipApi.
 */
export async function fetchMinistries(auth: ContentProviderAuthData | null | undefined): Promise<B1Ministry[]> {
  const result = await authFetch<B1Ministry[]>(`${API_BASE}/membership/groups/tag/ministry`, auth);
  return result || [];
}

/**
 * Fetch plan types for a ministry from DoingApi.
 */
export async function fetchPlanTypes(ministryId: string, auth: ContentProviderAuthData | null | undefined): Promise<B1PlanType[]> {
  const result = await authFetch<B1PlanType[]>(`${API_BASE}/doing/planTypes/ministryId/${ministryId}`, auth);
  return result || [];
}

/**
 * Fetch plans for a plan type from DoingApi.
 */
export async function fetchPlans(planTypeId: string, auth: ContentProviderAuthData | null | undefined): Promise<B1Plan[]> {
  const result = await authFetch<B1Plan[]>(`${API_BASE}/doing/plans/types/${planTypeId}`, auth);
  return result || [];
}

/**
 * Fetch venue feed from Lessons.church API (public, no auth).
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
 * Fetch arrangement key data from ChurchApps Content API (public, no auth).
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
