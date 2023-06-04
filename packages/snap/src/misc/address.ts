import { getBIP44AddressKeyDeriver } from '@metamask/key-tree';

/**
 * Gets the address of the current user.
 *
 * @returns The address of the current user.
 */
export async function getAddress() {
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  return (await (await getBIP44AddressKeyDeriver(ethNode))(0)).address;
}
