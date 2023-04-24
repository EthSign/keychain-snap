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
  shouldVerify?: boolean;
};

export type StorageResponse = {
  input?: unknown;
  message: string;
  transaction: {
    itemId: string;
  };
};
