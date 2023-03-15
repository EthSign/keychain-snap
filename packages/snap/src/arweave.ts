import { fetchTxOnArweave, postUploadToStorage } from "./misc/storage";
import { ArweavePayload, StoragePayload } from "./types";
import { ethers } from "ethers";
import { EthSignKeychainState } from ".";

export const getTransactionIdFromStorageUpload = async (
  userPublicKey: string,
  userPrivateKey: string,
  payload: ArweavePayload
) => {
  // prepare message to sign before upload
  const messagePayload = {
    address: userPublicKey,
    timestamp: new Date().toISOString(),
    version: "1.0",
    hash: ethers.utils.hashMessage(JSON.stringify(payload))
  };

  // messages converted to string before sign with statement prefix
  const message = `EthSignKeychain is signing on your behalf to validate the data being uploaded. This does not incur any gas fees.\n\n~\n\n${JSON.stringify(
    messagePayload,
    null,
    2
  )}`;

  // sign signature with the messages in details
  const wallet = new ethers.Wallet(userPrivateKey);
  const signature = await wallet.signMessage(message);

  // payload to upload arweave storage
  const storagePayload: StoragePayload = {
    signature,
    message,
    data: JSON.stringify(payload),
    tags: [
      { name: "address", value: userPublicKey },
      { name: "app", value: "EthSignKeychain" }
    ]
  };

  console.log("==== storagePayload ====", storagePayload);

  const response: any = await postUploadToStorage(storagePayload);

  return JSON.stringify(response); //.data.transaction.itemId;
};

const getObjectIdFromStorage = async (userPublicKey: string) => {
  const query = `
    {
      transactions(sort: HEIGHT_DESC,
        tags: [
          { name: "address", values: ["${userPublicKey}"] },
          { name: "app", values: ["EthSignKeychain"] }
        ]
      ) {
        edges {
          node {
            id
            block {
              height
            }
          }
        }
      }
    }
  `;

  let ret: any = undefined;
  await fetch("https://arweave.net/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: query
    })
  })
    .then((res) => res.json())
    .then((response) => {
      ret = response;
    });

  if (ret?.transactions?.edges?.nodes?.length > 0) {
    ret = ret.transactions.edges.nodes[0].id;
  } else {
    ret = undefined;
  }

  return ret;
};

export const getObjectFromStorage = async (userPublicKey: string): Promise<any | undefined> => {
  const id = await getObjectIdFromStorage(userPublicKey);

  if (!id) {
    return undefined;
  }

  const file = await fetchTxOnArweave(id);

  return file;
};
