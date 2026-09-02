export type Segment = 'SMB' | 'Mid-Market' | 'Enterprise';
export type Region = 'NA' | 'EMEA' | 'APAC' | 'LATAM';
export type PlanTier = 'Starter' | 'Team' | 'Business' | 'Enterprise';

export interface Customer {
  customerId: string;
  name: string;
  segment: Segment;
  planTier: PlanTier;
  region: Region;
  signupMonth: string; // YYYY-MM
  churnMonth: string | null; // YYYY-MM
}

export interface MrrRow {
  customerId: string;
  month: string; // YYYY-MM
  mrr: number;
  isNew: boolean;
  isExpansion: boolean;
  isContraction: boolean;
  isChurned: boolean;
}

export interface CacPoint {
  month: string;
  cac: number;
}

export interface NorthbeamData {
  customers: Customer[];
  mrrRows: MrrRow[];
  cac: CacPoint[];
}
