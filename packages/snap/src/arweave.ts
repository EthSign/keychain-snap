import { fetchCachedTx, fetchTxOnArweave, postUploadToStorage } from "./misc/storage";
import { StoragePayload } from "./types";
import { decryptDataArrayFromStringAES, EthSignKeychainState, getEncryptedStringFromBuffer } from ".";
import { personalSign } from "@metamask/eth-sig-util";
import { createHash } from "crypto";
import _ from "lodash";

export const getTransactionIdFromStorageUpload = async (
  userPublicKey: string,
  userPrivateKey: string,
  type: "pwStateClear" | "pwStateDel" | "pwStateSet" | "config",
  payload: any
) => {
  // prepare message to sign before upload
  payload = getEncryptedStringFromBuffer(payload, userPrivateKey);
  const messagePayload = {
    publicKey: userPublicKey,
    timestamp: new Date().toISOString(),
    version: "0.1",
    hash: createHash("sha256")
      .update(
        JSON.stringify({
          data: {
            type: type,
            payload: payload
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
      type: type,
      payload: payload
    }),
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
  let ret: any = [];
  let newCount = 1;
  let cursor = undefined;
  let numIterations = 0;
  while (newCount > 0) {
    numIterations++;
    const query = `
      {
        transactions(sort: HEIGHT_DESC,
          tags: [
            { name: "PublicKey", values: ["${userPublicKey}"] },
            { name: "Application", values: ["EthSignKeychain"] }
          ],
          first: 100${cursor ? ', after: "' + cursor + '"' : ""}
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
    newCount = await new Promise((resolve) => {
      fetch("https://arweave.net/graphql", {
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

  for (const node of nodeList) {
    const file: any = await fetchTxOnArweave(node.node.id);
    const payload: any = decryptDataArrayFromStringAES(file.payload, userPrivateKey);
    /**
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
        /**
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
        /**
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
      case "pwStateSet":
        /**
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
          for (let idx = 0; idx < state.pwState[payload.url].logins.length; idx++) {
            if (state.pwState[payload.url].logins[idx].username === payload.username) {
              state.pwState[payload.url].logins[idx].password = payload.password;
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
        /**
         * payload: {
         *   address: string;
         *   encryptionMethod: string;
         *   timestamp: number;
         * }
         */
        state.config = payload;
        break;
    }
  }

  return nodeList;
};