# B1Church Provider

The B1Church provider implements the `IProvider` interface to expose B1.Church service plans as browsable content. It supports aggregating content from multiple external providers (lessons.church, Proclaim, etc.) via an API proxy.

## Overview

This provider enables consuming applications to:
- Browse B1.Church ministries, plan types, and plans
- Retrieve presentations, instructions, and playlists from plans
- Transparently load content from external providers embedded in plan items

## Provider Configuration

```typescript
readonly id = "b1church";
readonly name = "B1.Church";

readonly capabilities: ProviderCapabilities = {
  browse: true,
  presentations: true,
  playlist: true,
  instructions: true,
  expandedInstructions: true,
  mediaLicensing: false
};

readonly authTypes: AuthType[] = ["oauth_pkce", "device_flow"];
```

## Data Types

### B1PlanItem

Plan items returned from the B1.Church API include provider metadata for external content:

```typescript
export interface B1PlanItem {
  id: string;
  label?: string;
  description?: string;
  seconds?: number;
  itemType?: string;
  relatedId?: string;
  churchId?: string;
  providerId?: string;         // External provider ID (e.g., "lessonschurch")
  providerPath?: string;       // Content path within external provider
  providerContentId?: string;  // Specific content ID within provider
  children?: B1PlanItem[];
}
```

**Code Reference**: [types.ts:27-39](types.ts#L27-L39)

### B1Plan

Plans can have an associated provider content (e.g., a lessons.church venue):

```typescript
export interface B1Plan {
  id: string;
  churchId: string;
  ministryId?: string;
  planTypeId?: string;
  name: string;
  serviceDate: string;
  contentType?: string;
  contentId?: string;
  providerId?: string;       // Associated provider ID (e.g., "lessonschurch")
  providerPlanId?: string;   // Content path for associated lesson
  providerPlanName?: string; // Display name of associated lesson
}
```

When a plan has `providerId` and `providerPlanId` set but no planItems, the provider will automatically fetch content from the associated provider.

**Code Reference**: [types.ts:16-28](types.ts#L16-L28)

## Browse Hierarchy

The provider exposes a hierarchical browse structure:

```
/ministries
    └─► /ministries/{ministryId}
            └─► /ministries/{ministryId}/{planTypeId}
                    └─► /ministries/{ministryId}/{planTypeId}/{planId}  [isLeaf: true]
```

| Depth | Path Pattern | Returns |
|-------|--------------|---------|
| 0 | `/` | Root "Ministries" folder |
| 1 | `/ministries` | List of ministry folders |
| 2 | `/ministries/{ministryId}` | Plan types for ministry |
| 3 | `/ministries/{ministryId}/{planTypeId}` | Plans (leaf items) |

**Code Reference**: [B1ChurchProvider.ts:62-115](B1ChurchProvider.ts#L62-L115)

## Content Retrieval Flow

When a consuming application calls `getPresentations()`, `getInstructions()`, or `getPlaylist()`, the provider:

1. Fetches plan items from the B1.Church API
2. **If no planItems exist** but plan has `providerId` and `providerPlanId` set:
   - Fetches content directly from the associated provider via proxy
   - Returns the full content from that provider (e.g., all presentations from a lessons.church venue)
3. Otherwise, iterates through each item and its children:
   - Determines if each item is "external" (from another provider)
   - For external items: proxies the request to the external provider
     - If `providerContentId` is set: filters to return only that specific content
     - Otherwise: returns all content from the external provider
   - For native items: processes directly using venue feed data

### Determining External Provider Items

An item is considered "external" when:
1. It has a `providerId` that is NOT "b1church"
2. It has a `providerPath` set

**Code Reference**: [B1ChurchProvider.ts:9-17](B1ChurchProvider.ts#L9-L17)

```typescript
function isExternalProviderItem(item: B1PlanItem): boolean {
  if (!item.providerId || item.providerId === "b1church") return false;
  if (item.providerPath) return true;
  const itemType = item.itemType || "";
  return itemType.startsWith("provider");
}
```

## External Provider Proxy

External provider content is fetched via `fetchFromProviderProxy()`, which calls the B1.Church API proxy endpoint.

### Proxy Endpoint

```
POST /doing/providerProxy/{method}

Body: {
  ministryId: string,
  providerId: string,
  path: string,
  resolution?: number  // Optional, for playlist
}
```

### Supported Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `browse` | `ContentItem[]` | Browse external provider hierarchy |
| `getPresentations` | `Plan` | Get presentations from external content |
| `getPlaylist` | `ContentFile[]` | Get media files for playback |
| `getInstructions` | `Instructions` | Get instruction items |
| `getExpandedInstructions` | `Instructions` | Get fully expanded instructions |

**Code Reference**: [api.ts:68-100](api.ts#L68-L100)

```typescript
export async function fetchFromProviderProxy<M extends ProxyMethod>(
  method: M,
  ministryId: string,
  providerId: string,
  path: string,
  authData?: ContentProviderAuthData | null,
  resolution?: number
): Promise<ProxyResult<M> | null> {
  const url = `${API_BASE}/doing/providerProxy/${method}`;
  const body = { ministryId, providerId, path, resolution };
  // ... fetch with auth headers
}
```

## Processing Flow Diagrams

### getPresentations()

```
getPresentations(path, authData)
    │
    ├─► Parse path to get ministryId, planTypeId, planId
    │
    ├─► Fetch plan details to get churchId, venueId
    │
    ├─► Fetch plan items: GET /planFeed/presenter/{churchId}/{planId}
    │
    ├─► Fetch venue feed (if venueId exists)
    │
    └─► For each section and child item:
        │
        ├─► isExternalProviderItem(child)?
        │   │
        │   ├─► YES: fetchFromProviderProxy("getPresentations", ...)
        │   │       │
        │   │       ├─► child.providerContentId set?
        │   │       │   └─► Find matching presentation, use only that one
        │   │       │
        │   │       └─► Otherwise merge all external presentations
        │   │
        │   └─► NO: planItemToPresentation(child, venueFeed)
        │
        └─► Return Plan { sections, allFiles }
```

**Code Reference**: [B1ChurchProvider.ts:117-196](B1ChurchProvider.ts#L117-L196)

### getInstructions() / getExpandedInstructions()

```
getInstructions(path, authData)
    │
    ├─► Parse path, fetch plan items
    │
    └─► processInstructionItems(planItems, ministryId, authData)
        │
        └─► For each item:
            │
            ├─► Convert to InstructionItem via planItemToInstruction()
            │
            ├─► isExternalProviderItem(item)?
            │   │
            │   ├─► YES: fetchFromProviderProxy("getExpandedInstructions", ...)
            │   │       │
            │   │       ├─► item.providerContentId set?
            │   │       │   └─► Find matching item, use only its children
            │   │       │
            │   │       └─► Otherwise use all external items as children
            │   │
            │   └─► NO: Recursively process children
            │
            └─► Return Instructions { venueName, items }
```

**Code Reference**: [B1ChurchProvider.ts:237-279](B1ChurchProvider.ts#L237-L279)

### Using providerContentId

When `providerContentId` is set on a plan item, the provider filters the external content to only include that specific item. This applies to all three methods:

**For getInstructions()**: Finds the matching instruction item and uses only its children:

```typescript
if (item.providerContentId) {
  const matchingItem = this.findItemById(externalInstructions.items, item.providerContentId);
  if (matchingItem?.children) {
    instructionItem.children = matchingItem.children;
  }
}
```

**For getPresentations() and getPlaylist()**: Finds the matching presentation and uses only that one:

```typescript
if (child.providerContentId) {
  const matchingPresentation = this.findPresentationById(externalPlan, child.providerContentId);
  if (matchingPresentation) {
    presentations.push(matchingPresentation);
    allFiles.push(...matchingPresentation.files);
  }
}
```

This enables a plan to reference a specific action/presentation from an external lesson rather than the entire lesson.

### Helper Methods

The provider uses two private helper methods for finding specific items:

- **findItemById()**: Recursively searches instruction items by `id` or `relatedId`
- **findPresentationById()**: Searches presentations across all sections by `id`

**Code Reference**: [B1ChurchProvider.ts:281-301](B1ChurchProvider.ts#L281-L301)

### getPlaylist()

```
getPlaylist(path, authData, resolution?)
    │
    ├─► Parse path, fetch plan items, fetch venue feed
    │
    └─► For each section and child item:
        │
        ├─► isExternalProviderItem(child)?
        │   │
        │   ├─► YES:
        │   │   │
        │   │   ├─► child.providerContentId set?
        │   │   │   └─► fetchFromProviderProxy("getPresentations", ...)
        │   │   │       └─► Find matching presentation, use its files
        │   │   │
        │   │   └─► Otherwise: fetchFromProviderProxy("getPlaylist", ..., resolution)
        │   │       └─► Merge all external files into playlist
        │   │
        │   └─► NO: getFilesFromVenueFeed(venueFeed, itemType, relatedId)
        │
        └─► Return ContentFile[]
```

**Code Reference**: [B1ChurchProvider.ts:303-381](B1ChurchProvider.ts#L303-L381)

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /membership/groups/tag/ministry` | Fetch ministries |
| `GET /doing/planTypes/ministryId/{id}` | Fetch plan types |
| `GET /doing/plans/types/{planTypeId}` | Fetch plans |
| `GET /planFeed/presenter/{churchId}/{planId}` | Fetch plan items |
| `POST /doing/providerProxy/{method}` | Proxy to external providers |

**Code Reference**: [api.ts](api.ts)

## Authentication

The provider supports two authentication methods:
- **OAuth PKCE**: For web applications
- **Device Flow**: For devices without browser input

Auth tokens are passed to:
- Direct B1.Church API calls via `Authorization: Bearer` header
- Proxy calls (the proxy uses stored credentials for external providers)

## Item Type Mapping

Native B1.Church item types map to standard instruction types:

| B1 Item Type | Standard Type |
|--------------|---------------|
| `section`, `lessonSection` | Section (expandable) |
| `action`, `lessonAction` | Action/Presentation |
| `addon`, `lessonAddOn` | Add-on/File |
| `song` | Song presentation |
| `video` | Video presentation |

## File Structure

```
b1Church/
├── B1ChurchProvider.ts   # Main provider implementation
├── api.ts                # API fetch functions and proxy
├── auth.ts               # OAuth and device flow auth
├── converters.ts         # Type conversion utilities
├── types.ts              # B1-specific type definitions
└── README.md             # This documentation
```
