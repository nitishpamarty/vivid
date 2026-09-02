export type Segment = 'SMB' | 'Mid-Market' | 'Enterprise';
export type Region = 'NA' | 'EMEA' | 'APAC' | 'LATAM';
export type PlanTier = 'Starter' | 'Team' | 'Business' | 'Enterprise';
export type AcquisitionChannel = 'Paid' | 'Organic' | 'Referral' | 'Partner';
export type ContractType = 'Monthly' | 'Annual';

export interface Customer {
  customerId: string;
  name: string;
  segment: Segment;
  planTier: PlanTier;
  region: Region;
  channel: AcquisitionChannel;
  contractType: ContractType;
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

export type Department = 'Engineering' | 'Sales' | 'Customer Success' | 'Marketing' | 'Product' | 'People' | 'Finance';

export interface Employee {
  employeeId: string;
  department: Department;
  region: Region;
  hireMonth: string; // YYYY-MM
  termMonth: string | null; // YYYY-MM
}

export interface PeopleData {
  employees: Employee[];
}

export interface ReportDef {
  reportId: string;
  name: string;
  ownerTeam: Department;
  createdMonth: string; // YYYY-MM
}

export interface ReportViewRow {
  reportId: string;
  month: string; // YYYY-MM
  views: number;
  uniqueViewers: number;
  engagementScore: number; // 0-100
}

export interface ActivityCell {
  weekday: string;
  hourBucket: string;
  views: number;
}

export interface UsageData {
  reports: ReportDef[];
  views: ReportViewRow[];
  activity: ActivityCell[];
}
