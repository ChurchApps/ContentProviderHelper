/**
 * B1.Church API response types
 */

/** A ministry is a group with the "ministry" tag */
export interface B1Ministry {
  id: string;
  churchId: string;
  name: string;
  photoUrl?: string;
  tags?: string;
}

/** Plan type within a ministry */
export interface B1PlanType {
  id: string;
  churchId: string;
  ministryId: string;
  name: string;
}

/** A plan/service within a plan type */
export interface B1Plan {
  id: string;
  churchId: string;
  ministryId?: string;
  planTypeId?: string;
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
