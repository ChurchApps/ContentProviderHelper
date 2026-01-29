/**
 * B1.Church API response types
 */

export interface B1Plan {
  id: string;
  churchId: string;
  name: string;
  serviceDate: string;
  contentType?: string;
  contentId?: string;
}

export interface B1PlanItem {
  id: string;
  label?: string;
  description?: string;
  seconds?: number;
  itemType?: string;
  relatedId?: string;
  churchId?: string;
  children?: B1PlanItem[];
}

export interface ArrangementKeyResponse {
  arrangementKey?: {
    id: string;
    keySignature?: string;
  };
  arrangement?: {
    id: string;
    name?: string;
    lyrics?: string;
  };
  song?: {
    id: string;
    dateAdded?: string;
    notes?: string;
  };
  songDetail?: {
    title?: string;
    artist?: string;
    seconds?: number;
    keySignature?: string;
  };
}
