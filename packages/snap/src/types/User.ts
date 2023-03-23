export type User = {
  address: string;
  alias?: string | null;
  nickname?: string;
  email?: string;
  avatar?: string;
  isValid?: boolean;
  oneTapEnabled: boolean;
  regKey: string | null;
};
