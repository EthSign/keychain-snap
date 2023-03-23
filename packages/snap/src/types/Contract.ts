import { Recipient } from './Recipient';

// SIGN
// VIEW
// COMPLETED
// EXPIRED
// maybe DRAFT later ???

export enum ContractStatus {
  SIGN = 'SIGN',
  VIEW = 'VIEW',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
}

export enum ContractProgress {
  NONE = 'NONE',
  INITIATED = 'INITIATED',
  INITIATING_FAILED = 'INITIATING_FAILED',
  ENCRYPTING_FILE = 'ENCRYPTING_FILE',
  UPLOADING_TO_ARWEAVE = 'UPLOADING_TO_ARWEAVE',
  UPLOADING_FAILED = 'UPLOADING_FAILED',
  AWAITING_TRANSACION = 'AWAITING_TRANSACION',
  WAITING_FOR_CONFIRMATIONS = 'WAITING_FOR_CONFIRMATIONS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export type Contract = {
  id: string;
  name: string;
  expiry: number;
  recipients: Recipient[];
  network: string;
  date: string;
  birth: number;
  encrypted: EncryptMethod;
  pdfTxId: string;
  signatureTxId: string;
  signed: boolean;
  expired: boolean;
  meta: {
    hasSignPermission: boolean;
    hasAccountSigned: boolean;
    numPendingSigners: number;
    numSigned: number;
    status: ContractStatus;
    expiredAt: string;
  };
};

export enum EncryptMethod {
  DEFAULT = 0,
  ONETAP = 1,
  PASSWORD = 2,
}

export type ArweavePayload = {
  recipientKeys: {
    [key: string]: string;
  }[];
  fileStr: string;
  fdfString: string;
  meta: {
    version: string;
  };
};

export type StoragePayload = {
  signature: string;
  message: string;
  data: string;
  tags: { name: string; value: string }[];
};

export type StorageResponse = {
  input?: unknown;
  message: string;
  transaction: {
    itemId: string;
  };
};
