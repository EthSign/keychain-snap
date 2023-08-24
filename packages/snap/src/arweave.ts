import { createHash } from 'crypto';
import { extractPublicKey, personalSign } from '@metamask/eth-sig-util';
import publicKeyToAddress from 'ethereum-public-key-to-address';
import nacl from 'tweetnacl';
import {
  batchFetchTxOnArweave,
  fetchCachedTx,
  postUploadBatchToStorage,
  postUploadToStorage,
} from './misc/storage';
import { ArweavePayload, RemoteLocation, StoragePayload } from './types';
import {
  generateNonce,
  stringToUint8Array,
  uint8ArrayToString,
} from './misc/binary';
import { AWS_API_ENDPOINT } from './constants';
import { EthSignKeychainState, EthSignKeychainEntry } from '.';

/**
 * Encrypt a JSON object using a provided key.
 *
 * @param object - JSON object to encrypt.
 * @param object.timestamp - Timestamp used for encryption nonce creation. Current timestamp used if object.timestamp is 0.
 * @param privateKey - Key used to encrypt the password.
 * @param password - User's password. Can be null.
 * @returns Encrypted UTF-8 string of the object.
 */
export const getEncryptedStringFromBuffer = (
  object: { timestamp: number; [key: string]: any },
  privateKey: string,
  password: string | null,
): string => {
  if (!object.timestamp && object.timestamp !== 0) {
    throw new Error('Error encrypting object. Timestamp not available.');
  }
  const nonce = generateNonce(
    object.timestamp === 0 ? Math.floor(Date.now() / 1000) : object.timestamp,
  );
  // First layer of encryption is based on the user's private key
  let key = privateKey;
  let encryptedString = nacl.secretbox(
    Buffer.from(JSON.stringify(object)),
    nonce,
    Uint8Array.from(Buffer.from(key.substring(2), 'hex')),
  );

  // Second (optional) layer of encryption is based on the user's entered password
  if (password) {
    key = createHash('sha256')
      .update(
        JSON.stringify({
          key: privateKey,
          password,
          nonce: uint8ArrayToString(nonce),
        }),
      )
      .digest('hex');

    encryptedString = nacl.secretbox(
      encryptedString,
      nonce,
      Uint8Array.from(Buffer.from(key, 'hex')),
    );
  }
  return JSON.stringify({
    nonce: uint8ArrayToString(nonce),
    data: uint8ArrayToString(encryptedString),
  });
};

/**
 * Decrypt an encrypted string using the provided key.
 *
 * @param encryptedString - Encrypted string to decrypt.
 * @param privateKey - Key used to decrypt the string.
 * @param password - User's password. Can be null.
 * @returns JSON object representing the decrypted string.
 */
export const decryptDataArrayFromString = (
  encryptedString: string,
  privateKey: string,
  password: string | null,
): EthSignKeychainState | undefined => {
  try {
    const obj = JSON.parse(encryptedString);

    // Decrypt second (optional) layer of encryption based on user's entered password
    let buffer: Uint8Array | null = stringToUint8Array(obj.data);
    let key = privateKey;
    if (password) {
      key = createHash('sha256')
        .update(JSON.stringify({ key: privateKey, password, nonce: obj.nonce }))
        .digest('hex');
      const tmpBuf = nacl.secretbox.open(
        buffer,
        stringToUint8Array(obj.nonce),
        Uint8Array.from(Buffer.from(key, 'hex')),
      );
      // In case an entry is not dual-encrypted (decryption failed), we will leave the buffer alone
      // and try to decrypt again using just the user's private key.
      if (tmpBuf) {
        buffer = tmpBuf;
      }
    }

    // Decrypt first layer of encryption based on user's private key
    key = privateKey;
    let decrypted: EthSignKeychainState | null | undefined = null;
    buffer = nacl.secretbox.open(
      buffer,
      stringToUint8Array(obj.nonce),
      Uint8Array.from(Buffer.from(key.substring(2), 'hex')),
    );
    decrypted = buffer ? JSON.parse(Buffer.from(buffer).toString()) : undefined;
    return decrypted ?? undefined;
  } catch (err) {
    return undefined;
  }
};

/**
 * Decrypt an encrypted string using the provided key.
 *
 * @param encryptedString - Encrypted string to decrypt.
 * @param queryAddress - Address that was used to query for a registry entry.
 * @returns JSON object representing the decrypted string.
 */
export const verifyRegistrySignature = (
  encryptedString: string,
  queryAddress = '',
): boolean => {
  const qAddress = queryAddress.toLowerCase();
  const obj = JSON.parse(encryptedString);
  if (obj?.signature) {
    const publicKey = extractPublicKey({
      data: obj.message,
      signature: obj.signature,
    });
    const address = publicKeyToAddress(
      `${publicKey.substring(0, 2)}04${publicKey.substring(2)}`,
    ).toLowerCase();
    return address === qAddress;
  }

  return false;
};

/**
 * Get the transaction response as a string given the user's public key, private key, and a list of decrypted entries.
 *
 * @param remoteLocation - The RemoteLocation we are uploading entries to.
 * @param userPublicKey - User's public MetaMask key.
 * @param userPrivateKey - User's private MetaMask key.
 * @param password - User's password. Can be null.
 * @param entries - List of entries to parse.
 * @returns Transaction response JSON in a string format.
 */
export const getTransactionIdFromStorageUploadBatch = async (
  remoteLocation: RemoteLocation,
  userPublicKey: string,
  userPrivateKey: string,
  password: string | null,
  entries: { type: string; payload: any }[],
): Promise<string> => {
  const batchedUploads: StoragePayload[] = [];
  for (const entry of entries) {
    const tags = [
      { name: 'ID', value: userPublicKey },
      { name: 'Application', value: 'EthSignKeychain' },
    ];
    // prepare message to sign before upload
    let encPayload: string;
    if (entry.type === 'registry') {
      // messages converted to string before sign with statement prefix
      const message = `EthSign is requesting your signature to validate the data being uploaded. This action does not incur any gas fees.\n\n~\n\n${JSON.stringify(
        entry.payload,
        null,
        2,
      )}`;

      // sign signature with the messages in details
      const signature = personalSign({
        data: message,
        privateKey: Buffer.from(userPrivateKey.substring(2), 'hex'),
      });

      encPayload = JSON.stringify({ ...entry.payload, signature, message });
      tags.push({ name: 'ID', value: entry.payload.publicAddress ?? '' });
    } else {
      encPayload = getEncryptedStringFromBuffer(
        entry.payload,
        userPrivateKey,
        password,
      );
    }

    const timestampIso = new Date().toISOString();
    const messagePayload = {
      publicKey: userPublicKey,
      timestamp: timestampIso,
      version: '0.1',
      hash: createHash('sha256')
        .update(
          JSON.stringify({
            data: {
              type: entry.type,
              payload: encPayload,
            },
            tags,
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
      tags,
      shouldVerify: true,
      timestamp:
        remoteLocation === RemoteLocation.AWS ? timestampIso : undefined,
    };
    batchedUploads.push(storagePayload);
  }

  // Response format:
  // { message: string; transaction: { transactions: { itemId: string; size: number }[]; message: string } }
  const response: any = await postUploadBatchToStorage(
    remoteLocation,
    batchedUploads,
    userPublicKey,
  );

  return JSON.stringify(response);
};

/**
 * Get the transaction ID as a StorageResponse after uploading the payload to Arweave.
 *
 * @param remoteLocation - The RemoteLocation we are uploading entries to.
 * @param userPublicKey - User's public MetaMask key.
 * @param userPrivateKey - User's private MetaMask key.
 * @param password - User's password. Can be null.
 * @param type - Type of entry we are parsing.
 * @param payload - Payload of entry we need to parse.
 * @returns StorageResponse in a string format.
 */
export const getTransactionIdFromStorageUpload = async (
  remoteLocation: RemoteLocation,
  userPublicKey: string,
  userPrivateKey: string,
  password: string | null,
  type:
    | 'pwStateNeverSaveSet'
    | 'pwStateClear'
    | 'pwStateDel'
    | 'pwStateSet'
    | 'config'
    | 'registry',
  payload: any,
) => {
  const tags = [
    { name: 'ID', value: userPublicKey },
    { name: 'Application', value: 'EthSignKeychain' },
  ];
  // prepare message to sign before upload
  let encPayload: string;
  if (type === 'registry') {
    // messages converted to string before sign with statement prefix
    const message = `EthSign is requesting your signature to validate the data being uploaded. This action does not incur any gas fees.\n\n~\n\n${JSON.stringify(
      payload,
      null,
      2,
    )}`;

    // sign signature with the messages in details
    const signature = personalSign({
      data: message,
      privateKey: Buffer.from(userPrivateKey.substring(2), 'hex'),
    });

    encPayload = JSON.stringify({ ...payload, signature, message });
    tags.push({ name: 'ID', value: payload.publicAddress ?? '' });
  } else {
    encPayload = getEncryptedStringFromBuffer(
      payload,
      userPrivateKey,
      password,
    );
  }

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
          tags,
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
    tags,
    shouldVerify: true,
  };

  const response: any = await postUploadToStorage(
    remoteLocation,
    storagePayload,
    userPublicKey,
  );

  return JSON.stringify(response);
};

/**
 * Load a user's files from AWS endpoint given their public key.
 *
 * @param userPublicKey - Public key of user to retrieve files for.
 * @returns Array of files.
 */
const getFilesFromAWS = async (
  userPublicKey: string,
): Promise<ArweavePayload[]> => {
  const response = await fetch(
    `${AWS_API_ENDPOINT}/users/pk_${userPublicKey}/passwords`,
  ).then((res) => res.json());
  // Data needs to be parsed from the stringified version.
  if (response?.data) {
    return response.data.map((item: string) => JSON.parse(item));
  }
  return [];
};

/**
 * Load a user's files from AWS endpoint given their public key.
 *
 * @param userPublicAddress - Public address of user to retrieve files for.
 * @returns Array of files.
 */
export const getRegistryFromAWS = async (
  userPublicAddress: string,
): Promise<ArweavePayload[]> => {
  const response = await fetch(
    `${AWS_API_ENDPOINT}/passwords?tagName=ID&tagValue=${userPublicAddress}`,
  ).then((res) => res.json());
  // Data needs to be parsed from the stringified version.
  if (response?.data) {
    return response.data.map((item: string) => JSON.parse(item));
  }
  return [];
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
        transactions(sort: HEIGHT_ASC,
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
    objects.push({
      cursor: '',
      node: { id: response[i], timestamp: response[i + 1] },
    });
  }

  return objects;
};

/**
 * Get files for a user at a given remote location.
 *
 * @param userPublicKey - User's public key to retrieve files for.
 * @param remoteLocation - Location to retrieve files from.
 * @returns List of files.
 */
export const getFilesForUser = async (
  userPublicKey: string,
  remoteLocation: RemoteLocation | null,
): Promise<ArweavePayload[]> => {
  // Generate a node list for all of the password state entries we need to parse from Arweave and Redis
  let nodeList: {
    cursor: string;
    node: { id: string; block?: { height: number }; timestamp?: number };
  }[] = [];
  if (remoteLocation === RemoteLocation.ARWEAVE) {
    nodeList = (await getObjectIdFromStorage(userPublicKey)).concat(
      await getObjectsFromCache(userPublicKey),
    );

    // No nodes to parse (empty state)
    if (!nodeList || nodeList.length === 0) {
      return [];
    }

    // Get ids for all of the nodes we need to parse
    const idList = nodeList.map((node) => node.node.id);

    // Retrieve all files from arweave given the node idList
    const files = await batchFetchTxOnArweave(idList);

    return files;
  } else if (remoteLocation === RemoteLocation.AWS || remoteLocation === null) {
    // Get node list (or list of payloads) directly from AWS
    const files = await getFilesFromAWS(userPublicKey);
    return files;
  }

  return [];
};

/**
 * Ensures that the signed message's values match the payload's values for a given registry payload.
 *
 * @param payload - Registry payload to verify.
 * @returns True if values match. False otherwise.
 */
const isValidMessage = (payload: any) => {
  const pl = JSON.parse(payload);
  const msgPayload = JSON.parse(pl.message.slice(119));
  return (
    msgPayload.publicKey === pl.publicKey &&
    msgPayload.publicAddress === pl.publicAddress &&
    msgPayload.timestamp === pl.timestamp
  );
};

/**
 * Get a list of objects corresponding to the current user from Arweave and Redis.
 *
 * @param files - List of files {type: string, payload: Object} we retrieved for the userPublicKey.
 * @param userPublicKey - User's public MetaMask key.
 * @param userPrivateKey - User's private MetaMask key.
 * @param userAddress - Address for validating unencrypted registry entries.
 * @param password - User's password. Can be null.
 * @param startingState - The EthSignKeychainState to start building on.
 * @returns List of objects from Arweave and Redis.
 */
export const getObjectsFromStorage = async (
  files: any[],
  userPublicKey: string,
  userPrivateKey: string,
  userAddress: string,
  password: string | null,
  startingState = {
    config: {
      address: userPublicKey,
      encryptionMethod: 'BIP-44',
      timestamp: 0,
    },
    registry: {
      publicAddress: '',
      publicKey: '',
      timestamp: 0,
    },
    pendingEntries: [],
    pwState: {},
    address: userPublicKey,
    timestamp: 0,
    credentialAccess: {},
    password: null,
    remoteLocation: null,
    awsInitFailure: null,
  } as EthSignKeychainState,
): Promise<any | undefined> => {
  // Decrypt each payload using user's private key and build our local keychain state
  for (const file of files) {
    /*
     * Files are in this format:
     * {
     *   type: string;
     *   payload: Object;
     * }
     */

    // Verify we have a valid file object and skip if invalid
    if (!file?.type || !file.payload) {
      continue;
    }

    const payload: any =
      // eslint-disable-next-line no-nested-ternary
      file.type === 'registry'
        ? verifyRegistrySignature(file.payload, userAddress) &&
          isValidMessage(file.payload)
          ? JSON.parse(file.payload)
          : undefined
        : decryptDataArrayFromString(file.payload, userPrivateKey, password);

    if (!payload) {
      continue;
    }

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
         *   controlled: boolean;
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
              if (login.timestamp < payload.timestamp) {
                login.controlled = payload.controlled;
                login.password = payload.password;
                login.timestamp = payload.timestamp;

                if (
                  startingState.pwState[payload.url].timestamp <
                  payload.timestamp
                ) {
                  startingState.pwState[payload.url].timestamp =
                    payload.timestamp;
                }
              }
              found = true;
              break;
            }
          }

          // If it is not found, we push the entry
          if (!found) {
            startingState.pwState[payload.url].logins.push({
              timestamp: payload.timestamp,
              url: payload.url,
              username: payload.username,
              password: payload.password,
              address: userPublicKey,
              controlled: payload.controlled,
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
                controlled: payload.controlled,
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
      case 'registry':
        /*
         * payload: {
         *   publicAddress: string;
         *   publicKey: string;
         *   timestamp: number;
         * }
         */
        if (startingState.registry.timestamp < payload.timestamp) {
          startingState.registry = payload;
        }
        break;
      default:
        break;
    }
  }

  return startingState;
};
