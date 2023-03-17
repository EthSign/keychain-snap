import { fetchTxOnArweave, postUploadToStorage } from "./misc/storage";
import { ArweavePayload, StoragePayload } from "./types";
import { ethers } from "ethers";
import { EthSignKeychainState } from ".";
import { personalSign } from "@metamask/eth-sig-util";
import { createHash } from "crypto";

export const getTransactionIdFromStorageUpload = async (
  userPublicKey: string,
  userPrivateKey: string,
  payload: ArweavePayload
) => {
  // prepare message to sign before upload
  const messagePayload = {
    publicKey: userPublicKey,
    timestamp: new Date().toISOString(),
    version: "0.1",
    hash: createHash("sha256")
      .update(
        JSON.stringify({
          data: payload,
          tags: [
            { name: "PublicKey", value: userPublicKey },
            { name: "Application", value: "EthSignKeychain" }
          ]
        })
      )
      .digest("hex")
  };

  // messages converted to string before sign with statement prefix
  const message = `EthSign Keychain is requesting your signature to validate the data being uploaded. This action does not incur any gas fees.\n\n~\n\n${JSON.stringify(
    messagePayload,
    null,
    2
  )}`;

  // sign signature with the messages in details
  const signature = personalSign({ data: message, privateKey: Buffer.from(userPrivateKey.substring(2), "hex") });

  // payload to upload arweave storage
  const storagePayload: StoragePayload = {
    signature,
    message,
    data: JSON.stringify(payload),
    tags: [
      { name: "PublicKey", value: userPublicKey },
      { name: "Application", value: "EthSignKeychain" }
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
          { name: "PublicKey", values: ["${userPublicKey}"] },
          { name: "Application", values: ["EthSignKeychain"] }
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
