import { ArweavePayload, StoragePayload, StorageResponse } from "../types";

const REACT_APP_ETHSIGN_API_URL = "23.22.197.174";

export const postUploadToStorage = async (data: StoragePayload): Promise<StorageResponse | undefined> => {
  // return BaseAPI.post(`${process.env.REACT_APP_ETHSIGN_API_URL}/upload`, data);
  let tx: any = undefined;
  await fetch(`${"https://localhost:4000"}/upload`, {
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

export const fetchTxOnArweave = async (txId: string): Promise<ArweavePayload> => {
  let ret: any = undefined;
  await fetch(`${"https://localhost:4000"}/transaction/${txId}`, {
    method: "GET"
  }).then((response: any) => (ret = response.json()));

  return ret;
};

export const fetchCachedTx = async (userPublicKey: string): Promise<ArweavePayload> => {
  let ret: any = undefined;
  await fetch(`${"https://localhost:4000"}/cached/${userPublicKey}`, {
    method: "GET"
  }).then((response: any) => (ret = response.json()));

  return ret;
};