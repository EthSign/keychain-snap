import { createHash } from 'crypto';
import { personalSign } from '@metamask/eth-sig-util';
import CryptoJS from 'crypto-js';
import {
  batchFetchTxOnArweave,
  fetchCachedTx,
  postUploadBatchToStorage,
  postUploadToStorage,
} from './misc/storage';
import { StoragePayload } from './types';
import { EthSignKeychainState, EthSignKeychainEntry } from '.';

/**
 * Encrypt an EthSignKeyChainState object using a provided key.
 *
 * @param object - EthSignKeychainState object to encrypt.
 * @param key - Key used to encrypt the password.
 * @returns Encrypted UTF-8 string of the object.
 */
export const getEncryptedStringFromBuffer = (
  object: EthSignKeychainState,
  key: string,
): string => {
  const encryptedString = CryptoJS.AES.encrypt(
    JSON.stringify(object),
    key,
  ).toString();
  return encryptedString;
};

/**
 * Decrypt an encrypted string using the provided key.
 *
 * @param encryptedString - Encrypted string to decrypt.
 * @param key - Key used to decrypt the string.
 * @returns JSON object representing the decrypted string.
 */
export const decryptDataArrayFromStringAES = (
  encryptedString: string,
  key = '',
): EthSignKeychainState => {
  const bytes = CryptoJS.AES.decrypt(encryptedString, key);
  const decrypted: EthSignKeychainState = JSON.parse(
    bytes.toString(CryptoJS.enc.Utf8),
  );
  return decrypted;
};

/**
 * Get the transaction response as a string given the user's public key, private key, and a list of decrypted entries.
 *
 * @param userPublicKey - User's public MetaMask key.
 * @param userPrivateKey - User's private MetaMask key.
 * @param entries - List of entries to parse.
 * @returns Transaction response JSON in a string format.
 */
export const getTransactionIdFromStorageUploadBatch = async (
  userPublicKey: string,
  userPrivateKey: string,
  entries: { type: string; payload: any }[],
): Promise<string> => {
  const batchedUploads: StoragePayload[] = [];
  for (const entry of entries) {
    // prepare message to sign before upload
    const encPayload = getEncryptedStringFromBuffer(
      entry.payload,
      userPrivateKey,
    );
    const messagePayload = {
      publicKey: userPublicKey,
      timestamp: new Date().toISOString(),
      version: '0.1',
      hash: createHash('sha256')
        .update(
          JSON.stringify({
            data: {
              type: entry.type,
              payload: encPayload,
            },
            tags: [
              { name: 'ID', value: userPublicKey },
              { name: 'Application', value: 'EthSignKeychain' },
            ],
          }),
        )
        .digest('hex'),
    };

    // messages converted to string before sign with statement prefix
    const message = `EthSign is requesting your signature to validate the data being uploaded. This action does not incur any gas fees.\n\n~\n\n${JSON.stringify(
      messagePayload,
      null,
      2,
    )}`;

    // sign signature with the messages in details
    const signature = personalSign({
      data: message,
      privateKey: Buffer.from(userPrivateKey.substring(2), 'hex'),
    });

    // payload to upload arweave storage
    const storagePayload: StoragePayload = {
      signature,
      message,
      data: JSON.stringify({
        type: entry.type,
        payload: encPayload,
      }),
      tags: [
        { name: 'ID', value: userPublicKey },
        { name: 'Application', value: 'EthSignKeychain' },
      ],
      shouldVerify: true,
    };
    batchedUploads.push(storagePayload);
  }

  // Response format:
  // { message: string; transaction: { transactions: { itemId: string; size: number }[]; message: string } }
  const response: any = await postUploadBatchToStorage(batchedUploads);

  return JSON.stringify(response);
};

/**
 * Get the transaction ID as a StorageResponse after uploading the payload to Arweave.
 *
 * @param userPublicKey - User's public MetaMask key.
 * @param userPrivateKey - User's private MetaMask key.
 * @param type - Type of entry we are parsing.
 * @param payload - Payload of entry we need to parse.
 * @returns StorageResponse in a string format.
 */
export const getTransactionIdFromStorageUpload = async (
  userPublicKey: string,
  userPrivateKey: string,
  type:
    | 'pwStateNeverSaveSet'
    | 'pwStateClear'
    | 'pwStateDel'
    | 'pwStateSet'
    | 'config',
  payload: any,
) => {
  // prepare message to sign before upload
  const encPayload = getEncryptedStringFromBuffer(payload, userPrivateKey);
  const messagePayload = {
    publicKey: userPublicKey,
    timestamp: new Date().toISOString(),
    version: '0.1',
    hash: createHash('sha256')
      .update(
        JSON.stringify({
          data: {
            type,
            payload: encPayload,
          },
          tags: [
            { name: 'ID', value: userPublicKey },
            { name: 'Application', value: 'EthSignKeychain' },
          ],
        }),
      )
      .digest('hex'),
  };

  // messages converted to string before sign with statement prefix
  const message = `EthSign is requesting your signature to validate the data being uploaded. This action does not incur any gas fees.\n\n~\n\n${JSON.stringify(
    messagePayload,
    null,
    2,
  )}`;

  // sign signature with the messages in details
  const signature = personalSign({
    data: message,
    privateKey: Buffer.from(userPrivateKey.substring(2), 'hex'),
  });

  // payload to upload arweave storage
  const storagePayload: StoragePayload = {
    signature,
    message,
    data: JSON.stringify({
      type,
      payload: encPayload,
    }),
    tags: [
      { name: 'ID', value: userPublicKey },
      { name: 'Application', value: 'EthSignKeychain' },
    ],
    shouldVerify: true,
  };

  const response: any = await postUploadToStorage(storagePayload);

  return JSON.stringify(response);
};

/**
 * Get a list of transactions given the user's public MetaMask key.
 *
 * @param userPublicKey - User's public MetaMask key.
 * @returns List of transactions that correspond to the user's public key.
 */
const getObjectIdFromStorage = async (userPublicKey: string) => {
  let ret: any = [];
  let newCount = 1;
  let cursor;
  // Keep retrieving documents until we run out of new documents to retrieve.
  while (newCount > 0) {
    const query = `
      {
        transactions(sort: HEIGHT_DESC,
          tags: [
            { name: "ID", values: ["${userPublicKey}"] },
            { name: "Application", values: ["EthSignKeychain"] }
          ],
          first: 100${cursor ? `, after: "${cursor}"` : ''}
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
      try {
        fetch('https://arweave.net/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
          }),
        })
          .then((res) => res.json())
          .then((response) => {
            if (
              response?.data?.transactions?.edges &&
              response.data.transactions.edges.length > 0
            ) {
              // Update our cursor object for retrieving the next set of consecutive data
              cursor =
                response.data.transactions.edges[
                  response.data.transactions.edges.length - 1
                ].cursor;
              // Concatenate the transaction edges to our return object
              ret = ret.concat(response.data.transactions.edges);
              // Return the data to newCount
              resolve(response.data.transactions.edges.length);
            } else {
              // No new data
              resolve(0);
            }
          })
          .catch(() => resolve(0));
      } catch (err) {
        // Error retrieving data, so return nothing
        resolve(0);
      }
    });
  }

  return ret;
};

/**
 * Retrieve objects from our Redis cache that are not yet on Arweave.
 *
 * @param userPublicKey - User's public MetaMask key.
 * @returns List of objects from Redis.
 */
export const getObjectsFromCache = async (
  userPublicKey: string,
): Promise<any | undefined> => {
  const response: any = await fetchCachedTx(userPublicKey);
  const objects: {
    cursor: string;
    node: { id: string; block?: { height: number }; timestamp?: number };
  }[] = [];
  for (let i = 0; i < response.length; i += 2) {
    objects.unshift({
      cursor: '',
      node: { id: response[i], timestamp: response[i + 1] },
    });
  }

  return objects;
};

/**
 * Get a list of objects corresponding to the current user from Arweave and Redis.
 *
 * @param userPublicKey - User's public MetaMask key.
 * @param userPrivateKey - User's private MetaMask key.
 * @param startingState - The EthSignKeychainState to start building on.
 * @returns List of objects from Arweave and Redis.
 */
export const getObjectsFromStorage = async (
  userPublicKey: string,
  userPrivateKey: string,
  startingState = {
    config: {
      address: userPublicKey,
      encryptionMethod: 'BIP-44',
      timestamp: 0,
    },
    pendingEntries: [],
    pwState: {},
    address: userPublicKey,
    timestamp: 0,
    credentialAccess: [],
  } as EthSignKeychainState,
): Promise<any | undefined> => {
  // Generate a node list for all of the password state entries we need to parse from Arweave and Redis
  const nodeList: {
    cursor: string;
    node: { id: string; block?: { height: number }; timestamp?: number };
  }[] = (await getObjectIdFromStorage(userPublicKey)).concat(
    await getObjectsFromCache(userPublicKey),
  );

  // No nodes to parse (empty state)
  if (!nodeList || nodeList.length === 0) {
    return startingState;
  }

  // Get ids for all of the nodes we need to parse
  const idList = nodeList.map((node) => node.node.id);

  // Retrieve all files from arweave given the node idList
  const files: any = await batchFetchTxOnArweave(idList);

  // Decrypt each payload using user's private key and build our local keychain state
  for (const file of files) {
    /*
     * Files are in this format:
     * {
     *   type: string;
     *   payload: Object;
     * }
     */

    const payload: any = decryptDataArrayFromStringAES(
      file.payload,
      userPrivateKey,
    );

    // Update global state timestamp
    if (startingState.timestamp < payload.timestamp) {
      startingState.timestamp = payload.timestamp;
    }

    switch (file.type) {
      case 'pwStateClear':
        /*
         * payload: {
         *   url: string;
         *   timestamp: number;
         * }
         */
        if (
          startingState.pwState[payload.url] &&
          startingState.pwState[payload.url].timestamp < payload.timestamp
        ) {
          // Remove all entries that existed prior to the pwStateClear event. If there
          // are 0 entries remaining, then we set neverSave to true because we cleared
          // the entire state and there are no updates since.
          const filtered = startingState.pwState[payload.url].logins.filter(
            (entry) => entry.timestamp > payload.timestamp,
          );
          startingState.pwState[payload.url] = {
            timestamp: payload.timestamp,
            neverSave: filtered.length === 0,
            logins: filtered,
          };
        }
        break;
      case 'pwStateDel':
        /*
         * payload: {
         *   url: string;
         *   username: string;
         *   timestamp: number;
         * }
         */
        if (startingState.pwState[payload.url]) {
          for (
            let idx = 0;
            idx < startingState.pwState[payload.url].logins.length;
            idx++
          ) {
            // Delete the entry if we find the username and its timestamp is older
            // than the deletion event.
            if (
              startingState.pwState[payload.url].logins[idx].username ===
                payload.username &&
              startingState.pwState[payload.url].logins[idx].timestamp <
                payload.timestamp
            ) {
              startingState.pwState[payload.url].logins.splice(idx, 1);
              // Update the payload url's timestamp in localState if payload has a newer timestamp.
              if (
                startingState.pwState[payload.url].timestamp < payload.timestamp
              ) {
                startingState.pwState[payload.url].timestamp =
                  payload.timestamp;
              }
              break;
            }
          }
        }

        break;
      case 'pwStateNeverSaveSet':
        /*
         * payload: {
         *   url: string;
         *   neverSave: boolean;
         *   timestamp: number;
         * }
         */
        if (startingState.pwState[payload.url]) {
          let filtered: EthSignKeychainEntry[] = [];
          if (payload.neverSave) {
            filtered = startingState.pwState[payload.url].logins.filter(
              (entry) => entry.timestamp > payload.timestamp,
            );
          }
          startingState.pwState[payload.url].neverSave = payload.neverSave;
          startingState.pwState[payload.url].logins = filtered;
          // Update payload.url's pwState timestamp if payload's timestamp is newer.
          if (
            payload.timestamp > startingState.pwState[payload.url].timestamp
          ) {
            startingState.pwState[payload.url].timestamp = payload.timestamp;
          }
        } else {
          // Entry does not exist in local state, so we simply need to set it.
          startingState.pwState[payload.url] = {
            timestamp: payload.timestamp,
            neverSave: payload.neverSave,
            logins: [],
          };
        }

        break;
      case 'pwStateSet':
        /*
         * payload: {
         *   url: string;
         *   username: string;
         *   password: string;
         *   timestamp: number;
         * }
         */
        if (startingState.pwState[payload.url]) {
          // State exists locally. Check timestamps.
          if (
            startingState.pwState[payload.url].timestamp < payload.timestamp
          ) {
            // Clear neverSave if it is set to true on localState's older entry.
            if (startingState.pwState[payload.url].neverSave) {
              startingState.pwState[payload.url].neverSave = false;
            }
          }

          // Find the current password (if it exists).
          let found = false;
          for (const login of startingState.pwState[payload.url].logins) {
            if (login.username === payload.username) {
              // Update local entry if it has an older timestamp.
              if (login.timestamp < payload.username) {
                login.password = payload.password;
                startingState.pwState[payload.url].timestamp =
                  payload.timestamp;
              }
              found = true;
              break;
            }
          }

          if (!found) {
            startingState.pwState[payload.url].logins.push({
              timestamp: payload.timestamp,
              url: payload.url,
              username: payload.username,
              password: payload.password,
              address: userPublicKey,
            });
          }
        } else {
          // Locally, the pwState for payload.url does not exist, so we need to create it.
          startingState.pwState[payload.url] = {
            timestamp: payload.timestamp,
            neverSave: false,
            logins: [
              {
                timestamp: payload.timestamp,
                url: payload.url,
                username: payload.username,
                password: payload.password,
                address: userPublicKey,
              },
            ],
          };
        }

        break;
      case 'config':
        /*
         * payload: {
         *   address: string;
         *   encryptionMethod: string;
         *   timestamp: number;
         * }
         */
        if (startingState.config.timestamp < payload.timestamp) {
          startingState.config = payload;
        }
        break;
      default:
        break;
    }
  }

  return startingState;
};
