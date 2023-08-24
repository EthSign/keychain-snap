// import { getBIP44AddressKeyDeriver } from '@metamask/key-tree';
import { PrivateKey } from 'eciesjs';
// import { JsonBip44Node } from '../types';
import publicKeyToAddress from 'ethereum-public-key-to-address';

/**
 * Gets the entropy-generated address of the current user.
 *
 * @returns The address of the current user.
 */
export async function getEntropyAddress() {
  return (await getKeys()).address;
}

/**
 * Get the generated keys of the current user using their account's entropy value.
 *
 * @returns Key information (private, public) as a BIP-44 node.
 */
export async function getKeys(): Promise<{
  publicKey: string;
  privateKey: string;
  address: string;
}> {
  const input = await snap.request({
    method: 'snap_getEntropy',
    params: {
      version: 1,
      salt: 'xyz.ethsign.keychain',
    },
  });

  const privateKey = PrivateKey.fromHex(input);

  return {
    publicKey: `0x${privateKey.publicKey.toHex(false)}`,
    privateKey: privateKey.toHex(),
    address: publicKeyToAddress(privateKey.publicKey.toHex()),
  };
}
