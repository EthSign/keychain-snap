import CryptoJS from 'crypto-js';
// eslint-disable-next-line
import * as types from "@metamask/snaps-types";

import { Mutex } from 'async-mutex';
import { heading, panel, text } from '@metamask/snaps-ui';
import { getObjectsFromStorage, getTransactionIdFromStorageUploadBatch } from './arweave';

type EthSignKeychainBase = {
  address?: string;
  timestamp: number;
};

type EthSignKeychainConfig = {
  encryptionMethod: string; // currently only BIP-44
} & EthSignKeychainBase;

type EthSignKeychainEntry = {
  timestamp: number;
  url: string;
  username: string;
  password: string;
} & EthSignKeychainBase;

export type EthSignKeychainState = {
  config: EthSignKeychainConfig;
  pwState: {
    [key: string]: {
      timestamp: number;
      neverSave: boolean;
      logins: EthSignKeychainEntry[];
    };
  }; // unencrypted
  pendingEntries: EthSignKeychainEntry[]; // entries pending sync with Arweave if the network fails
  credentialAccess: string[];
} & EthSignKeychainBase;

const saveMutex = new Mutex();
const arweaveMutex = new Mutex();

// NOTE: This is duplicated in arweave.ts
const getEncryptedStringFromBuffer = (object: EthSignKeychainState, key: string): string => {
  const encryptedString = CryptoJS.AES.encrypt(JSON.stringify(object), key).toString();
  return encryptedString;
};

// NOTE: This is duplicated in arweave.ts
const decryptDataArrayFromStringAES = (encryptedString: string, key = ''): EthSignKeychainState => {
  const bytes = CryptoJS.AES.decrypt(encryptedString, key);
  const decrypted: EthSignKeychainState = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  return decrypted;
};

/**
 * Get the EthSignKeychainState stored in MetaMask.
 *
 * @returns EthSignKeychainState object representing local state.
 */
async function getEthSignKeychainState(): Promise<EthSignKeychainState> {
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  if (!ethNode?.privateKey) {
    return {
      address: '',
      timestamp: 0,
      config: {
        address: '',
        timestamp: 0,
        encryptionMethod: 'BIP-44',
      },
      pwState: {},
      pendingEntries: [],
      credentialAccess: []
    } as EthSignKeychainState;
  }

  const state = await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'get',
    },
  });

  if (
    !state ||
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    (typeof state === 'object' && state === undefined)
  ) {
    return {
      address: '',
      timestamp: 0,
      config: {
        address: '',
        timestamp: 0,
        encryptionMethod: 'BIP-44',
      },
      pwState: {},
      pendingEntries: [],
      credentialAccess: []
    } as EthSignKeychainState;
  }

  return (
    decryptDataArrayFromStringAES(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      (state?.ethsignKeychainState as string | undefined | null) ?? '',
      ethNode.privateKey,
    ) ?? {}
  );
}

/**
 * Save the new state to MetaMask encrypted with the user's private key.
 *
 * @param newState - New state to save in MetaMask's storage.
 */
async function savePasswords(newState: EthSignKeychainState) {
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  if (!ethNode?.privateKey) {
    return;
  }

  // The state is automatically encrypted behind the scenes by MetaMask using snap-specific keys
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: {
        ethsignKeychainState: getEncryptedStringFromBuffer(newState, ethNode.privateKey),
      },
    },
  });
}

/**
 * Sync the provided state with the remote state built from document retrieval on Arweave.
 *
 * @param state - Local state we are updating with fetched remote state.
 */
async function sync(state: EthSignKeychainState): Promise<void> {
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  if (!ethNode?.privateKey) {
    return;
  }

  // Get the remote state built on all remote objects
  const doc = await getObjectsFromStorage(ethNode.publicKey, ethNode.privateKey);
  // Merge local state with remote state and get a list of changes that we need to upload remotely
  const tmpState = await mergeStates(doc, state);

  // If config has never been initialized, initialize it
  if (!tmpState.config.address || tmpState.config.address === '') {
    tmpState.config = {
      address: ethNode.publicKey,
      encryptionMethod: 'BIP-44',
      timestamp: Math.floor(Date.now() / 1000),
    };

    await arweaveMutex.runExclusive(async () => {
      tmpState.pendingEntries.push({
        type: 'config',
        payload: {
          timestamp: tmpState.config.timestamp,
          address: tmpState.config.address,
          encryptionMethod: tmpState.config.encryptionMethod,
        },
      } as any);
    });
  }

  // Save passwords locally
  await savePasswords(tmpState);

  // Add changes to pendingState and call processPending()
  await processPending();
}

/**
 * Merge the two provided states into a single state that includes transactions that
 * need to be uploaded to update the remote state.
 *
 * @param remoteState - Remote state we are merging into local state.
 * @param localState - Local state we are modifying with remote state.
 */
async function mergeStates(remoteState: EthSignKeychainState, localState: EthSignKeychainState) {
  // Compare configs
  if (localState.config.timestamp < remoteState.config.timestamp) {
    localState.config.timestamp = remoteState.config.timestamp;
    localState.config.address = remoteState.config.address;
    localState.config.encryptionMethod = remoteState.config.encryptionMethod;
  } else if (localState.config.timestamp !== remoteState.config.timestamp) {
    if (localState.pendingEntries.findIndex((entry: any) => entry.type === 'config') < 0) {
      await arweaveMutex.runExclusive(async () => {
        localState.pendingEntries.push({
          type: 'config',
          payload: {
            timestamp: localState.config.timestamp,
            address: localState.config.address,
            encryptionMethod: localState.config.encryptionMethod,
          },
        } as any);
      });
    }
  }

  // Iterate through local state. Update existing pwStates with remote object (if timestamp greater)
  // and remove the pwStates from the remote object.
  for (const key of Object.keys(localState.pwState)) {
    // / Start by checking if there is a difference in neverSave entries
    if (remoteState.pwState[key] && remoteState.pwState[key].timestamp > localState.pwState[key].timestamp) {
      // Remote state is newer
      if (remoteState.pwState[key].neverSave) {
        // Clear local state
        localState.pwState[key].logins = [];
      } else if (localState.pwState[key]?.neverSave) {
        localState.pwState[key].neverSave = false;
      }
    } else {
      // Local state is newer
      // eslint-disable-next-line no-lonely-if
      if (
        localState.pwState[key].neverSave &&
        localState.pwState[key].neverSave !== remoteState.pwState[key]?.neverSave &&
        localState.pendingEntries.findIndex(
          (entry: any) => entry.type === 'pwStateClear' && entry.payload.url === key,
        ) < 0
      ) {
        // Trigger login removal for key
        await arweaveMutex.runExclusive(async () => {
          localState.pendingEntries.push({
            type: 'pwStateClear',
            payload: {
              url: key,
              timestamp: localState.pwState[key].timestamp,
            },
          } as any);
        });
      }
    }

    // / Check entry by entry for mismatches

    // Iterate through localState's login entries and check them one by one for updates or removals
    const idxToRemove: number[] = [];
    for (let idx = 0; idx < localState.pwState[key].logins.length; idx++) {
      const localEntry = localState.pwState[key].logins[idx];
      let found = false;
      if (remoteState.pwState[key]) {
        for (const obj of remoteState.pwState[key].logins) {
          if (obj.username === localEntry.username) {
            found = true;
            if (obj.timestamp > localEntry.timestamp) {
              // Remote entry is newer
              localEntry.password = obj.password;
              localEntry.address = obj.address;
              localEntry.timestamp = obj.timestamp;
              localEntry.url = obj.url;
            } else if (obj.timestamp !== localEntry.timestamp) {
              // Local entry is newer
              await arweaveMutex.runExclusive(async () => {
                localState.pendingEntries.push({
                  type: 'pwStateSet',
                  payload: localEntry,
                } as any);
              });
            }
          }
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          obj.parsed = true;
        }
      } else {
        // TODO: Upload state remotely
        // Somehow we have a local state that does not exist remotely, likely with no pending entries
        // (shouldn't happen unless something magically breaks)
      }

      // If we did not find the entry and the localState is stale, remove entry from local state
      if (!found && remoteState.timestamp > localState.timestamp) {
        idxToRemove.unshift(idx);
      }
    }

    // Remove all stale entries (highest index first)
    for (const idx of idxToRemove) {
      localState.pwState[key].logins.splice(idx, 1);
    }

    // Parse remote object for entries that do not exist locally. Add them to local pwState if timestamp
    // greater than local state's global timestamp.
    if (remoteState.pwState[key]?.logins) {
      for (const remoteEntry of remoteState.pwState[key].logins) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (!remoteEntry.parsed) {
          // We do not have remoteEntry in our localState, so add it
          localState.pwState[key].logins.push({
            timestamp: remoteEntry.timestamp,
            address: remoteEntry.address,
            username: remoteEntry.username,
            password: remoteEntry.password,
            url: remoteEntry.url,
          });
        }
      }
    }
  }

  return localState;
}

/**
 * Exclusively process all pending transactions.
 */
async function processPending() {
  return await arweaveMutex.runExclusive(async () => {
    const state = await getEthSignKeychainState();
    const ethNode: any = await snap.request({
      method: 'snap_getBip44Entropy',
      params: {
        coinType: 60,
      },
    });

    if (!ethNode?.privateKey) {
      return;
    }

    const ret: any = JSON.parse(
      (await getTransactionIdFromStorageUploadBatch(
        ethNode.publicKey,
        ethNode.privateKey,
        state.pendingEntries as any,
      )) ?? '{}',
    );

    if (ret?.transaction?.message === 'success') {
      state.pendingEntries = [];
      await savePasswords(state);
    }
  });
}

async function originHasAccess(origin: string, state: EthSignKeychainState) {
  if(!state || !state.credentialAccess || !state.credentialAccess.includes(`${origin}`)) {
    const showPassword = await snap.request({
      method: 'snap_dialog',
      params: {
        type: 'confirmation',
        content: panel([
          heading('Security Alert'),
          text(`"${origin}" is requesting access to your credentials. Would you like to proceed?`),
        ]),
      },
    });

    if(showPassword) {
      // Update our local approved origin list
      state.credentialAccess.push(origin);
      await savePasswords(state);
    } else {
      return false;
    }

    return state.credentialAccess;
  } else {
    return true
  }
}

async function setNeverSave(state: EthSignKeychainState, website: string, neverSave: boolean) {
  let timestamp: number;
  await saveMutex.runExclusive(async () => {
    timestamp = Math.floor(Date.now() / 1000);
    const newPwState = Object.assign({}, state.pwState);
    if (newPwState[website]) {
      newPwState[website].logins = [];
      newPwState[website].neverSave = neverSave;
      newPwState[website].timestamp = timestamp;
    } else {
      newPwState[website] = {
        timestamp,
        neverSave,
        logins: [],
      };
    }

    state.timestamp = timestamp;
    state.pwState = newPwState;
  });

  await arweaveMutex.runExclusive(async () => {
    state.pendingEntries.push({
      type: 'pwStateNeverSaveSet',
      payload: {
        timestamp,
        url: website,
        neverSave,
      },
    } as any);
  });
  await savePasswords(state);
  await processPending();
}

async function setPassword(state: EthSignKeychainState, website: string, username: string, password: string) {
  let timestamp: number;
  await saveMutex.runExclusive(async () => {
    timestamp = Math.floor(Date.now() / 1000);
    const newPwState = Object.assign({}, state.pwState);
    let idx = -2;
    if (newPwState[website]) {
      // idx = _.findIndex(newPwState[website].logins, (e: EthSignKeychainEntry) => e.username === username);
      idx = newPwState[website].logins.findIndex((e) => e.username === username);
    }

    if (idx === -2) {
      newPwState[website] = {
        timestamp,
        neverSave: false,
        logins: [{ address: '', url: website, username, password, timestamp }],
      };
    } else if (idx < 0) {
      // Add username/password pair to current credential entry
      newPwState[website].logins.push({
        url: website,
        timestamp,
        username,
        password,
      });
    } else {
      // Update password for current credential entry pair
      newPwState[website].logins[idx].password = password;
      newPwState[website].timestamp = timestamp;
    }

    state.timestamp = timestamp;
    state.pwState = newPwState;
  });

  await arweaveMutex.runExclusive(async () => {
    state.pendingEntries.push({
      type: 'pwStateSet',
      payload: {
        timestamp,
        url: website,
        username,
        password,
      },
    } as any);
  });

  await savePasswords(state);
  await processPending();
}

async function removePassword(state: EthSignKeychainState, website: string, username: string) {
  let timestamp: number;
  await saveMutex.runExclusive(async () => {
    timestamp = Math.floor(Date.now() / 1000);
    const newPwState = Object.assign({}, state.pwState);
    let idx = -2;
    if (newPwState[website]) {
      idx = newPwState[website].logins.findIndex((e) => e.username === username);
    }

    if (idx >= 0) {
      newPwState[website].logins.splice(idx, 1);
    }

    state.timestamp = timestamp;
    state.pwState = newPwState;
  });

  await arweaveMutex.runExclusive(async () => {
    state.pendingEntries.push({
      type: 'pwStateDel',
      payload: {
        timestamp,
        url: website,
        username,
      },
    } as any);
  });

  await savePasswords(state);
  await processPending();
}

module.exports.onRpcRequest = async ({ origin, request }: any) => {
  // Get the local state for this snap
  const state = await getEthSignKeychainState();
  
  // Make sure the current origin has explicit access to use this snap
  const oha = await originHasAccess(origin, state)
  if(!oha) {
    throw new Error("Access denied.")
  }

  // If this origin was just added to the origin access list, oha will be
  // the string array of all origins that have access. Update our state variable
  // to have this updated list.
  if(typeof(oha) !== "boolean") {
    state.credentialAccess = oha;
  }

  // Call respective function depending on RPC method
  let website: string, username: string, password: string, neverSave: boolean;
  switch (request.method) {
    case 'sync':
      await sync(state);
      return 'OK';

    case 'set_neversave':
      ({ website, neverSave } = request.params);
      await setNeverSave(state, website, neverSave);
      return 'OK';

    case 'set_password':
      ({ website, username, password } = request.params);
      await setPassword(state, website, username, password);
      return 'OK';

    case 'get_password':
      ({ website } = request.params);
      return state.pwState[website];
      
    case 'remove_password':
      ({ website, username } = request.params);
      await removePassword(state, website, username);
      return 'OK';
      
    default:
      throw new Error('Method not found.');
  }
};
