import { ArweavePayload, StoragePayload, StorageResponse } from '../types';

const ETHSIGN_API_URL = 'https://arweave-staging.ethsign.xyz';

export const postUploadToStorage = async (
  data: StoragePayload,
): Promise<StorageResponse | undefined> => {
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
  data: StoragePayload[],
): Promise<StorageResponse | undefined> => {
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
