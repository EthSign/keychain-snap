import { ArweavePayload, StoragePayload, StorageResponse } from "../types";

const REACT_APP_ETHSIGN_API_URL = "23.22.197.174";
const REACT_APP_NO_FEE_API_KEY = "909faeebe45c19aadf9d20adceb8db4d564353cb80e2abe456472f10a9b308da";

export const postUploadToStorage = async (data: StoragePayload): Promise<StorageResponse | undefined> => {
  // return BaseAPI.post(`${process.env.REACT_APP_ETHSIGN_API_URL}/upload`, data);
  let tx: any = undefined;
  await fetch(`http://ip.jsontest.com/`, {
    method: "POST",
    headers: {
      "X-API-KEY": REACT_APP_NO_FEE_API_KEY ?? "",
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

  return data as any;
};

export const fetchTxOnArweave = async (txId: string): Promise<ArweavePayload> => {
  let ret: any = undefined;
  await fetch(`${REACT_APP_ETHSIGN_API_URL}/${txId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  }).then((response: any) => (ret = response.data.transaction));

  return ret;
};
