import { createHash } from "crypto";
import { personalSign } from "@metamask/eth-sig-util";
import CryptoJS from "crypto-js";
import {
  batchFetchTxOnArweave,
  fetchCachedTx,
  fetchTxOnArweave,
  postUploadBatchToStorage,
  postUploadToStorage
} from "./misc/storage";
import { StoragePayload } from "./types";
import { EthSignKeychainState } from ".";

// NOTE: This is duplicated from index.ts
const getEncryptedStringFromBuffer = (object: EthSignKeychainState, key: string): string => {
  const encryptedString = CryptoJS.AES.encrypt(JSON.stringify(object), key).toString();
  return encryptedString;
};

// NOTE: This is duplicated from index.ts
const decryptDataArrayFromStringAES = (encryptedString: string, key = ""): EthSignKeychainState => {
  const bytes = CryptoJS.AES.decrypt(encryptedString, key);
  const decrypted: EthSignKeychainState = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  return decrypted;
};

export const getTransactionIdFromStorageUploadBatch = async (
  userPublicKey: string,
  userPrivateKey: string,
  entries: { type: string; payload: any }[]
): Promise<string> => {
  const batchedUploads: StoragePayload[] = [];
  for (const entry of entries) {
    // prepare message to sign before upload
    const encPayload = getEncryptedStringFromBuffer(entry.payload, userPrivateKey);
    const messagePayload = {
      publicKey: userPublicKey,
      timestamp: new Date().toISOString(),
      version: "0.1",
      hash: createHash("sha256")
        .update(
          JSON.stringify({
            data: {
              type: entry.type,
              payload: encPayload
            },
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
      data: JSON.stringify({
        type: entry.type,
        payload: encPayload
      }),
      tags: [
        { name: "PublicKey", value: userPublicKey },
        { name: "Application", value: "EthSignKeychain" }
      ]
    };
    batchedUploads.push(storagePayload);
  }

  // Response format:
  // { message: string; transaction: { transactions: { itemId: string; size: number }[]; message: string } }
  const response: any = await postUploadBatchToStorage(batchedUploads);

  return JSON.stringify(response); // .data.transaction.itemId;
};

export const getTransactionIdFromStorageUpload = async (
  userPublicKey: string,
  userPrivateKey: string,
  type: "pwStateNeverSaveSet" | "pwStateClear" | "pwStateDel" | "pwStateSet" | "config",
  payload: any
) => {
  // prepare message to sign before upload
  const encPayload = getEncryptedStringFromBuffer(payload, userPrivateKey);
  const messagePayload = {
    publicKey: userPublicKey,
    timestamp: new Date().toISOString(),
    version: "0.1",
    hash: createHash("sha256")
      .update(
        JSON.stringify({
          data: {
            type,
            payload: encPayload
          },
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
    data: JSON.stringify({
      type,
      payload: encPayload
    }),
    tags: [
      { name: "PublicKey", value: userPublicKey },
      { name: "Application", value: "EthSignKeychain" }
    ]
  };

  console.log("==== storagePayload ====", storagePayload);

  const response: any = await postUploadToStorage(storagePayload);

  return JSON.stringify(response); // .data.transaction.itemId;
};

const getObjectIdFromStorage = async (userPublicKey: string) => {
  let ret: any = [];
  let newCount = 1;
  let cursor;
  while (newCount > 0) {
    const query = `
      {
        transactions(sort: HEIGHT_DESC,
          tags: [
            { name: "PublicKey", values: ["${userPublicKey}"] },
            { name: "Application", values: ["EthSignKeychain"] }
          ],
          first: 100${cursor ? `, after: "${cursor}"` : ""}
        ) {
          edges {
            cursor
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
    // eslint-disable-next-line  no-loop-func
    newCount = await new Promise((resolve) => {
      fetch("https://arweave.net/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query
        })
      })
        .then((res) => res.json())
        .then((response) => {
          if (response?.data?.transactions?.edges && response.data.transactions.edges.length > 0) {
            cursor = response.data.transactions.edges[response.data.transactions.edges.length - 1].cursor;
            ret = ret.concat(response.data.transactions.edges);
            resolve(response.data.transactions.edges.length);
          } else {
            resolve(0);
          }
        })
        .catch(() => resolve(0));
    });
  }

  return ret;
};

export const getObjectsFromCache = async (userPublicKey: string): Promise<any | undefined> => {
  const response: any = await fetchCachedTx(userPublicKey);
  const objects: { cursor: string; node: { id: string; block?: { height: number }; timestamp?: number } }[] = [];
  for (let i = 0; i < response.length; i += 2) {
    objects.unshift({ cursor: "", node: { id: response[i], timestamp: response[i + 1] } });
  }

  return objects;
};

export const getObjectsFromStorage = async (
  userPublicKey: string,
  userPrivateKey: string
): Promise<any | undefined> => {
  const nodeList: { cursor: string; node: { id: string; block?: { height: number }; timestamp?: number } }[] = (
    await getObjectIdFromStorage(userPublicKey)
  ).concat(await getObjectsFromCache(userPublicKey));

  const state: EthSignKeychainState = {
    config: { address: userPublicKey, encryptionMethod: "BIP-44", timestamp: 0 },
    pendingEntries: [],
    pwState: {},
    address: userPublicKey,
    timestamp: 0
  };

  if (!nodeList || nodeList.length === 0) {
    return state;
  }

  const idList = nodeList.map((node) => node.node.id);

  const files: any = await batchFetchTxOnArweave(idList);

  for (const file of files) {
    const payload: any = decryptDataArrayFromStringAES(file.payload, userPrivateKey);
    /*
     * {
     *   type: string;
     *   payload: Object;
     * }
     */

    // Update global state timestamp
    if (state.timestamp < payload.timestamp) {
      state.timestamp = payload.timestamp;
    }

    switch (file.type) {
      case "pwStateClear":
        /*
         * payload: {
         *   url: string;
         *   timestamp: number;
         * }
         */
        if (state.pwState[payload.url]) {
          state.pwState[payload.url] = { timestamp: payload.timestamp, neverSave: true, logins: [] };
        }
        break;
      case "pwStateDel":
        /*
         * payload: {
         *   url: string;
         *   username: string;
         *   timestamp: number;
         * }
         */
        if (state.pwState[payload.url]) {
          for (let idx = 0; idx < state.pwState[payload.url].logins.length; idx++) {
            if (state.pwState[payload.url].logins[idx].username === payload.username) {
              state.pwState[payload.url].logins.splice(idx, 1);
              break;
            }
          }
        }

        break;
      case "pwStateNeverSaveSet":
        /*
         * payload: {
         *   url: string;
         *   neverSave: boolean;
         *   timestamp: number;
         * }
         */
        if (state.pwState[payload.url]) {
          state.pwState[payload.url].neverSave = payload.neverSave;
          state.pwState[payload.url].logins = [];
          state.pwState[payload.url].timestamp = payload.timestamp;
        } else {
          state.pwState[payload.url] = {
            timestamp: payload.timestamp,
            neverSave: payload.neverSave,
            logins: []
          };
        }

        break;
      case "pwStateSet":
        /*
         * payload: {
         *   url: string;
         *   username: string;
         *   password: string;
         *   timestamp: number;
         * }
         */
        if (state.pwState[payload.url]) {
          if (state.pwState[payload.url].neverSave) {
            state.pwState[payload.url].neverSave = false;
          }
          let found = false;
          for (const login of state.pwState[payload.url].logins) {
            if (login.username === payload.username) {
              login.password = payload.password;
              state.pwState[payload.url].timestamp = payload.timestamp;
              found = true;
              break;
            }
          }

          if (!found) {
            state.pwState[payload.url].logins.push({
              timestamp: payload.timestamp,
              url: payload.url,
              username: payload.username,
              password: payload.password,
              address: userPublicKey
            });
          }
        } else {
          state.pwState[payload.url] = {
            timestamp: payload.timestamp,
            neverSave: false,
            logins: [
              {
                timestamp: payload.timestamp,
                url: payload.url,
                username: payload.username,
                password: payload.password,
                address: userPublicKey
              }
            ]
          };
        }

        break;
      case "config":
        /*
         * payload: {
         *   address: string;
         *   encryptionMethod: string;
         *   timestamp: number;
         * }
         */
        state.config = payload;
        break;
      default:
        break;
    }
  }

  return state;
};
