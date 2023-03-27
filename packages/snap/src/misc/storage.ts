import { ArweavePayload, StoragePayload, StorageResponse } from "../types";

const REACT_APP_ETHSIGN_API_URL = "https://localhost:4000";

export const postUploadToStorage = async (data: StoragePayload): Promise<StorageResponse | undefined> => {
  // return BaseAPI.post(`${process.env.REACT_APP_ETHSIGN_API_URL}/upload`, data);
  let tx: any;
  await fetch(`${REACT_APP_ETHSIGN_API_URL}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  })
    .then((res) => res.json())
    .then((response) => {
      tx = { message: "success", transaction: response };
    })
    .catch((err) => {
      tx = {
        message: "failed",
        transaction: err as any
      };
    });

  return tx as any;
};

export const postUploadBatchToStorage = async (data: StoragePayload[]): Promise<StorageResponse | undefined> => {
  // return BaseAPI.post(`${process.env.REACT_APP_ETHSIGN_API_URL}/upload`, data);
  let tx: any;
  await fetch(`${REACT_APP_ETHSIGN_API_URL}/uploadBatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ batchedUploads: data })
  })
    .then((res) => res.json())
    .then((response) => {
      tx = { message: "success", transaction: response };
    })
    .catch((err) => {
      tx = {
        message: "failed",
        transaction: err as any
      };
    });

  return tx as any;
};

export const fetchTxOnArweave = async (txId: string): Promise<ArweavePayload> => {
  let ret: any;
  await fetch(`${REACT_APP_ETHSIGN_API_URL}/transaction/${txId}`, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache"
    }
  }).then((response: any) => (ret = response.json()));

  return ret?.transaction ? ret.transaction : ret;
};

export const batchFetchTxOnArweave = async (txIds: string[]): Promise<ArweavePayload[]> => {
  let ret: any = [];
  await fetch(`${REACT_APP_ETHSIGN_API_URL}/transactions/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids: txIds })
  })
    .then((res) => res.json())
    .then((response) => (ret = response ?? []));

  return ret?.transactions ? ret.transactions : ret;
};

export const fetchCachedTx = async (userPublicKey: string): Promise<ArweavePayload> => {
  let ret: any;
  await fetch(`${REACT_APP_ETHSIGN_API_URL}/cached/${userPublicKey}`, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache"
    }
  }).then((response: any) => (ret = response.json()));

  return ret;
};
