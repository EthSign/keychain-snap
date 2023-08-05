export type JsonBip44Node = {
  depth: number;
  parentFingerprint: number;
  index: number;
  privateKey: string;
  publicKey: string;
  chainCode: string;
};
