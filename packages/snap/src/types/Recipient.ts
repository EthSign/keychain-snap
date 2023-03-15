import { User } from "./User";

export enum RecipientType {
  SIGNER = "signer",
  VIEWER = "viewer"
}

export interface Recipient {
  id: string;
  type: RecipientType;
  order?: number;
  user: User;
  signed: boolean;
}

export interface SignerColor {
  border: string;
  default: string;
  hover: string;
}
