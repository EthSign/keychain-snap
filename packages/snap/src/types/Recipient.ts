import { User } from './User';

export enum RecipientType {
  SIGNER = 'signer',
  VIEWER = 'viewer',
}

export type Recipient = {
  id: string;
  type: RecipientType;
  order?: number;
  user: User;
  signed: boolean;
};

export type SignerColor = {
  border: string;
  default: string;
  hover: string;
};
