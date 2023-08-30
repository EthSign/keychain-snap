import { AWS_API_ENDPOINT, ETHSIGN_API_URL } from '../constants';
import {
  ArweavePayload,
  RemoteLocation,
  StoragePayload,
  StorageResponse,
} from '../types';

export const postUploadToStorage = async (
  remoteLocation: RemoteLocation,
  data: StoragePayload,
  userPublicKey?: string,
): Promise<StorageResponse | undefined> => {
  if (remoteLocation === RemoteLocation.AWS) {
    if (!userPublicKey) {
      return undefined;
    }
    const response = await fetch(
      `${AWS_API_ENDPOINT}/users/pk_${userPublicKey}/passwords`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ upload: data }),
      },
    ).then((res) => res.json());
    if (response?.error) {
      return { message: 'failed', transaction: { message: 'failure' } };
    }
    return { message: 'success', transaction: { message: 'success' } };
  }
  let tx: any;
  try {
    await fetch(`${ETHSIGN_API_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .then((response) => {
        tx = { message: 'success', transaction: response };
      })
      .catch((err) => {
        tx = {
          message: 'failed',
          transaction: err as any,
        };
      });
  } catch (err) {
    tx = {
      message: 'failed',
      transaction: err as any,
    };
  }

  return tx as any;
};

export const postUploadBatchToStorage = async (
  remoteLocation: RemoteLocation,
  data: StoragePayload[],
  userPublicKey?: string,
): Promise<StorageResponse | undefined> => {
  if (remoteLocation === RemoteLocation.AWS) {
    if (!userPublicKey) {
      return undefined;
    }

    // Only upload up to 50 entries per request and set a 10s delay between requests.
    // AWS is programmed to allow a new request every 7 seconds, but the 10s delay
    // will account for any network delays or processing delays.
    for (let i = 0; i < Math.ceil(data.length / 50); i++) {
      const cont = await new Promise((resolve) => {
        setTimeout(
          async () => {
            const response = await fetch(
              `${AWS_API_ENDPOINT}/users/pk_${userPublicKey}/passwords/batch`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  batchedUploads: data.slice(i * 50, (i + 1) * 50),
                }),
              },
            ).then((res) => res.json());
            if (response?.error?.failures?.length > 0) {
              resolve(false);
            }
            resolve(true);
          },
          i === 0 ? 0 : 10000,
        );
      });
      if (!cont) {
        return {
          message: 'failed',
          transaction: { message: 'At least one upload failed' },
        };
      }
    }
    return { message: 'success', transaction: { message: 'success' } };
  }
  let tx: any;
  try {
    await fetch(`${ETHSIGN_API_URL}/uploadBatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batchedUploads: data }),
    })
      .then((res) => res.json())
      .then((response) => {
        tx = { message: 'success', transaction: response };
      })
      .catch((err) => {
        tx = {
          message: 'failed',
          transaction: err as any,
        };
      });
  } catch (err) {
    tx = {
      message: 'failed',
      transaction: err as any,
    };
  }

  return tx as any;
};

export const fetchTxOnArweave = async (
  txId: string,
): Promise<ArweavePayload> => {
  let ret: any;
  try {
    await fetch(`${ETHSIGN_API_URL}/transaction/${txId}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      },
    }).then((response: any) => (ret = response.json()));
  } catch (err) {
    // Do nothing.
  }

  return ret?.transaction ? ret.transaction : ret;
};

export const batchFetchTxOnArweave = async (
  txIds: string[],
): Promise<ArweavePayload[]> => {
  let ret: any = [];
  try {
    await fetch(`${ETHSIGN_API_URL}/transactions/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: txIds }),
    })
      .then((res) => res.json())
      .then((response) => (ret = response ?? []));
  } catch (err) {
    return [];
  }

  return ret?.transactions ? ret.transactions : ret;
};

export const fetchCachedTx = async (
  userPublicKey: string,
): Promise<ArweavePayload[]> => {
  let ret: any[] = [];
  try {
    await fetch(`${ETHSIGN_API_URL}/cached/${userPublicKey}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      },
    })
      .then((res) => res.json())
      .then((response) => {
        if (response?.set) {
          ret = response.set;
        }
      });
  } catch (err) {
    return ret;
  }

  return ret;
};
