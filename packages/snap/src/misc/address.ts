import { getBIP44AddressKeyDeriver } from '@metamask/key-tree';
import { JsonBip44Node } from '../types';

/**
 * Gets the address of the current user.
 *
 * @returns The address of the current user.
 */
export async function getAddress() {
  return (await getKeys()).address;
}

/**
 * Get BIP-44 address key deriver for the current user.
 *
 * @returns BIP44AddressKeyDeriver for the current user.
 */
export async function getKeyDeriver() {
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  return await getBIP44AddressKeyDeriver(ethNode);
}

/**
 * Get the keys of the current user at a given index.
 *
 * @param index - Number from 0 to 5.
 * @returns Key information (private, public) as a BIP-44 node.
 */
export async function getKeys(index = 0): Promise<JsonBip44Node | any> {
  return (await getKeyDeriver())(index);
}
