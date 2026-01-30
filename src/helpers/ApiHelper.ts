import { ContentProviderAuthData, ContentProviderConfig } from "../interfaces";

export class ApiHelper {
  createAuthHeaders(auth: ContentProviderAuthData | null | undefined): Record<string, string> | null {
    if (!auth) return null;
    return { Authorization: `Bearer ${auth.access_token}`, Accept: "application/json" };
  }

  async apiRequest<T>(config: ContentProviderConfig, providerId: string, path: string, auth?: ContentProviderAuthData | null, method: "GET" | "POST" = "GET", body?: unknown): Promise<T | null> {
    try {
      const url = `${config.apiBase}${path}`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (auth) headers["Authorization"] = `Bearer ${auth.access_token}`;
      if (body) headers["Content-Type"] = "application/json";

      console.log(`${providerId} API request: ${method} ${url}`);
      console.log(`${providerId} API auth present: ${!!auth}`);

      const options: RequestInit = { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) };
      const response = await fetch(url, options);

      console.log(`${providerId} API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${providerId} API request failed: ${response.status} - ${errorText}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error(`${providerId} API request error:`, error);
      return null;
    }
  }
}
