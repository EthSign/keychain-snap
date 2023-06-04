// eslint-disable-next-line
import * as types from "@metamask/snaps-types";

import { Mutex } from 'async-mutex';
import { heading, panel, text } from '@metamask/snaps-ui';
import {
  decryptDataArrayFromStringAES,
  getEncryptedStringFromBuffer,
  getFilesForUser,
  getObjectsFromStorage,
  getTransactionIdFromStorageUploadBatch,
} from './arweave';
import { getAddress } from './misc/address';

type EthSignKeychainBase = {
  address?: string;
  timestamp: number;
};

type EthSignKeychainConfig = {
  encryptionMethod: string; // currently only BIP-44
} & EthSignKeychainBase;

type EthSignKeychainRegistry = {
  publicAddress: string;
  publicKey: string;
  timestamp: number;
};

export type EthSignKeychainEntry = {
  url: string;
  username: string;
  password: string;
  controlled: string | null;
} & EthSignKeychainBase;

type EthSignKeychainPasswordState = {
  timestamp: number;
  neverSave: boolean;
  logins: EthSignKeychainEntry[];
};

export type EthSignKeychainState = {
  registry: EthSignKeychainRegistry;
  config: EthSignKeychainConfig;
  pwState: {
    [key: string]: EthSignKeychainPasswordState;
  }; // unencrypted
  pendingEntries: { type: string; payload: EthSignKeychainEntry }[]; // entries pending sync with Arweave if the network fails
  credentialAccess: { [origin: string]: boolean };
} & EthSignKeychainBase;

// Create mutexes for changing our local state object (no dirty writes)
const saveMutex = new Mutex();
const arweaveMutex = new Mutex();

/**
 * Get the snap's complete stored state.
 *
 * @returns The complete snap's state.
 */
async function getSnapState(): Promise<any | null> {
  // Get the stored local snap state
  const state = await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'get',
    },
  });

  return state;
}

/**
 * Get the EthSignKeychainState stored in MetaMask.
 *
 * @returns EthSignKeychainState object representing local state.
 */
async function getEthSignKeychainState(): Promise<EthSignKeychainState> {
  // Get internal MetaMask keys
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  // Failed to get keys so return blank state
  if (!ethNode?.privateKey) {
    return {
      address: '',
      timestamp: 0,
      config: {
        address: '',
        timestamp: 0,
        encryptionMethod: 'BIP-44',
      },
      registry: {
        publicAddress: '',
        publicKey: '',
        timestamp: 0,
      },
      pwState: {},
      pendingEntries: [],
      credentialAccess: {},
    } as EthSignKeychainState;
  }

  // Get the stored local snap state
  const state = await getSnapState();

  // Local state doesn't exist or we encounted unexpected error. Return empty state.
  if (
    !state?.ethsignKeychainState ||
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
      registry: {
        publicAddress: '',
        publicKey: '',
        timestamp: 0,
      },
      pwState: {},
      pendingEntries: [],
      credentialAccess: {},
    } as EthSignKeychainState;
  }

  // Return decrypted state
  return (
    decryptDataArrayFromStringAES(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      (state.ethsignKeychainState[ethNode.publicKey] as
        | string
        | undefined
        | null) ?? '',
      ethNode.privateKey,
    ) ??
    ({
      address: '',
      timestamp: 0,
      config: {
        address: '',
        timestamp: 0,
        encryptionMethod: 'BIP-44',
      },
      registry: {
        publicAddress: '',
        publicKey: '',
        timestamp: 0,
      },
      pwState: {},
      pendingEntries: [],
      credentialAccess: {},
    } as EthSignKeychainState)
  );
}

/**
 * Save the new state to MetaMask encrypted with the user's private key.
 *
 * @param newState - New state to save in MetaMask's storage.
 */
async function savePasswords(newState: EthSignKeychainState) {
  let state = await getSnapState();
  if (!state) {
    state = { ethsignKeychainState: {} };
  }

  // Get internal MetaMask keys
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  // Error retrieving user keys, so return
  if (!ethNode?.privateKey) {
    return;
  }

  state.ethsignKeychainState[ethNode.publicKey] = getEncryptedStringFromBuffer(
    newState,
    ethNode.privateKey,
  );

  // The state is automatically encrypted behind the scenes by MetaMask using snap-specific keys
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: state,
    },
  });
}

/**
 * Get the registry information for a given user address.
 *
 * @param address - The address of the user we are retrieving the registry entry for.
 * @returns User registry object or undefined.
 */
async function registry(
  address: string,
): Promise<{ publicAddress: string; publicKey: string }> {
  if (!address) {
    return {
      publicAddress: '',
      publicKey: '',
    };
  }

  let files: any = await getFilesForUser(address.toLowerCase());
  files = files.filter((file: any) => file.type === 'registry');

  const state: EthSignKeychainState = await getObjectsFromStorage(
    files,
    '',
    '',
  );

  return {
    publicAddress: state.registry.publicAddress,
    publicKey: state.registry.publicKey,
  };
}

/**
 * Sync the provided state with the remote state built from document retrieval on Arweave.
 *
 * @param state - Local state we are updating with fetched remote state.
 */
async function sync(
  state: EthSignKeychainState,
): Promise<EthSignKeychainState> {
  // Get internal MetaMask keys
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  // Failed to get internal keys, so return
  if (!ethNode?.privateKey) {
    return state;
  }

  const files = await getFilesForUser(ethNode.publicKey);

  // Get the remote state built on all remote objects
  const localState = await getObjectsFromStorage(
    files,
    ethNode.publicKey,
    ethNode.privateKey,
    state,
  );

  const remoteState = await getObjectsFromStorage(
    files,
    ethNode.publicKey,
    ethNode.privateKey,
  );
  // Merge local state with remote state and get a list of changes that we need to upload remotely
  // const tmpState = await mergeStates(doc, state);
  const tmpState = await checkRemoteStatus(localState, remoteState);
  const addr = await getAddress();

  // If registry has never been initialized, initialize it
  if (
    !tmpState.registry.publicAddress ||
    tmpState.registry.publicAddress === ''
  ) {
    tmpState.registry = {
      publicAddress: addr,
      publicKey: ethNode.publicKey,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Add config set pending entry (for remote Arweave update)
    await arweaveMutex.runExclusive(async () => {
      const amidx = localState.pendingEntries.findIndex(
        (e: any) =>
          e.type === 'registry' &&
          e.payload.timestamp === tmpState.registry.timestamp &&
          e.payload.publicAddress === tmpState.registry.publicAddress &&
          e.payload.publicKey === tmpState.registry.publicKey,
      );
      if (amidx < 0) {
        tmpState.pendingEntries.push({
          type: 'registry',
          payload: {
            timestamp: tmpState.registry.timestamp,
            publicAddress: tmpState.registry.publicAddress,
            publicKey: tmpState.registry.publicKey,
          },
        } as any);
      }
    });
  }

  // If config has never been initialized, initialize it
  if (!tmpState.config.address || tmpState.config.address === '') {
    tmpState.config = {
      address: ethNode.publicKey,
      encryptionMethod: 'BIP-44',
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Add config set pending entry (for remote Arweave update)
    await arweaveMutex.runExclusive(async () => {
      const amidx = localState.pendingEntries.findIndex(
        (e: any) =>
          e.type === 'config' &&
          e.payload.timestamp === tmpState.config.timestamp &&
          e.payload.address === tmpState.config.address &&
          e.payload.encryptionMethod === tmpState.config.encryptionMethod,
      );
      if (amidx < 0) {
        tmpState.pendingEntries.push({
          type: 'config',
          payload: {
            timestamp: tmpState.config.timestamp,
            address: tmpState.config.address,
            encryptionMethod: tmpState.config.encryptionMethod,
          },
        } as any);
      }
    });
  }

  // Save passwords locally
  await savePasswords(tmpState);

  // Process the pending state and update our local state variable as needed
  return await processPending();
}

/**
 * Create pending entries on the provided local state so that the resulting entries will update the remote state to equivalency.
 *
 * @param localState - Our local EthSignKeychainState which has already been updated from the remote state event logs.
 * @param remoteState - The remote EthSignKeychainState we loaded from Arweave's event logs.
 * @returns A modified local state with pending entries needed to update the remote state.
 */
async function checkRemoteStatus(
  localState: EthSignKeychainState,
  remoteState: EthSignKeychainState,
) {
  // Check registries
  if (
    localState.registry.timestamp > remoteState.registry.timestamp ||
    localState.registry.publicAddress !== remoteState.registry.publicAddress
  ) {
    const amidx = localState.pendingEntries.findIndex(
      (e: any) =>
        e.type === 'registry' &&
        e.payload.timestamp === localState.registry.timestamp &&
        e.payload.publicAddress === localState.registry.publicAddress &&
        e.payload.publicKey === localState.registry.publicKey,
    );
    if (amidx < 0) {
      localState.pendingEntries.push({
        type: 'registry',
        payload: {
          timestamp: localState.registry.timestamp,
          publicAddress: localState.registry.publicAddress,
          publicKey: localState.registry.publicKey,
        },
      } as any);
    }
  }

  // Check configs
  if (
    localState.config.timestamp > remoteState.config.timestamp ||
    localState.config.address !== remoteState.config.address
  ) {
    const amidx = localState.pendingEntries.findIndex(
      (e: any) =>
        e.type === 'config' &&
        e.payload.timestamp === localState.config.timestamp &&
        e.payload.address === localState.config.address &&
        e.payload.encryptionMethod === localState.config.encryptionMethod,
    );
    if (amidx < 0) {
      localState.pendingEntries.push({
        type: 'config',
        payload: {
          timestamp: localState.config.timestamp,
          address: localState.config.address,
          encryptionMethod: localState.config.encryptionMethod,
        },
      } as any);
    }
  }

  // Check pwStates
  for (const key of Object.keys(localState.pwState)) {
    // Check if local entry is set to never save. If remote state is not set to neverSave,
    // we will create a pending entry to set it remotely.
    if (
      localState.pwState[key].neverSave &&
      (!remoteState.pwState[key] ||
        remoteState.pwState[key].neverSave === false)
    ) {
      localState.pendingEntries.push({
        type: 'pwStateNeverSaveSet',
        payload: {
          timestamp: localState.pwState[key].timestamp,
          url: key,
          neverSave: localState.pwState[key].neverSave,
        },
      } as any);
    }

    // Check if key exists on remote.
    if (remoteState.pwState[key]) {
      // If local key exists on remote, check each login entry for existence remotely.
      for (const entry of localState.pwState[key].logins) {
        const idx = remoteState.pwState[key].logins.findIndex(
          (e) => e.username === entry.username,
        );
        if (idx >= 0) {
          // Found. Check timestamps to see if local is newer than remote.
          if (
            remoteState.pwState[key].logins[idx].timestamp < entry.timestamp
          ) {
            // Local is newer. Update the remote entry.
            await arweaveMutex.runExclusive(async () => {
              const amidx = localState.pendingEntries.findIndex(
                (e) =>
                  e.type === 'pwStateSet' &&
                  e.payload.username === entry.username &&
                  e.payload.password === entry.password &&
                  e.payload.timestamp === entry.timestamp,
              );
              if (amidx < 0) {
                localState.pendingEntries.push({
                  type: 'pwStateSet',
                  payload: entry,
                });
              }
            });
          }
        } else {
          // Not found remotely, but our local version has it. Add it to remote state.
          // Since our local state was already updated using the remote event logs,
          // our local state will always be newer, so we always need to add a new entry.
          await arweaveMutex.runExclusive(async () => {
            const amidx = localState.pendingEntries.findIndex(
              (e) =>
                e.type === 'pwStateSet' &&
                e.payload.username === entry.username &&
                e.payload.password === entry.password &&
                e.payload.timestamp === entry.timestamp,
            );
            if (amidx < 0) {
              localState.pendingEntries.push({
                type: 'pwStateSet',
                payload: entry,
              });
            }
          });
        }
      }
    } else {
      // If key does not exist on remote, add each password entry to remote state.
      for (const entry of localState.pwState[key].logins) {
        await arweaveMutex.runExclusive(async () => {
          const amidx = localState.pendingEntries.findIndex(
            (e) =>
              e.type === 'pwStateSet' &&
              e.payload.username === entry.username &&
              e.payload.password === entry.password &&
              e.payload.timestamp === entry.timestamp,
          );
          if (amidx < 0) {
            localState.pendingEntries.push({
              type: 'pwStateSet',
              payload: entry,
            });
          }
        });
      }
    }
  }

  return localState;
}

/**
 * Exclusively process all pending transactions and upload them to Arweave in batch.
 *
 * @returns Promise of void.
 */
async function processPending() {
  return await arweaveMutex.runExclusive(
    async (): Promise<EthSignKeychainState> => {
      const state = await getEthSignKeychainState();
      const ethNode: any = await snap.request({
        method: 'snap_getBip44Entropy',
        params: {
          coinType: 60,
        },
      });

      if (!ethNode?.privateKey) {
        return state;
      }

      if (!state?.pendingEntries || state.pendingEntries.length === 0) {
        return state;
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

      return state;
    },
  );
}

/**
 * Checks if origin has access to our snap. Prompts user for access confirmation if none exists prior.
 *
 * @param origin - Origin string from where RPC messages were sent.
 * @param state - EthSignKeychainState to process.
 * @param elevated - True if the origin is requesting a password for an external (different) origin.
 * @param global - Determines if the origin should have access to passwords for all sites (global) or only the current site (local).
 * @returns Boolean representing access for provided origin, or the current array of origin strings
 * if the current origin was just approved by the user.
 */
async function originHasAccess(
  origin: string,
  state: EthSignKeychainState,
  elevated: boolean,
  global: boolean,
) {
  const access = state?.credentialAccess
    ? state.credentialAccess[origin]
    : undefined;
  if (access === undefined || (elevated && !access)) {
    const showPassword = await snap.request({
      method: 'snap_dialog',
      params: {
        type: 'confirmation',
        content: panel([
          heading('Security Alert'),
          text(
            `"${origin}" is requesting access to your credentials ${
              global || elevated ? 'for all sites' : 'for the current site'
            }. Would you like to proceed?`,
          ),
        ]),
      },
    });

    if (showPassword) {
      // Update our local approved origin list
      // eslint-disable-next-line require-atomic-updates
      state.credentialAccess[origin] = global || elevated;
      await savePasswords(state);
    } else {
      return false;
    }

    return state.credentialAccess;
  }

  return true;
}

/**
 * Update snap state for website provided value for neverSave.
 *
 * @param state - EthSignKeychainState used for updating.
 * @param website - Website we are setting neverSave on.
 * @param neverSave - Boolean value representing whether or not to allow password saving.
 */
async function setNeverSave(
  state: EthSignKeychainState,
  website: string,
  neverSave: boolean,
) {
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

/**
 * Update snap state for the website provided value for username and password.
 *
 * @param state - EthSignKeychainState used for updating.
 * @param website - Website we are updating the password on.
 * @param username - Username we are setting.
 * @param password - Password we are setting.
 * @param controlled - Null if entry is not controlled. Origin of API that created this entry if controlled.
 */
async function setPassword(
  state: EthSignKeychainState,
  website: string,
  username: string,
  password: string,
  controlled: string | null,
) {
  let timestamp: number;
  await saveMutex.runExclusive(async () => {
    timestamp = Math.floor(Date.now() / 1000);
    const newPwState = Object.assign({}, state.pwState);
    let idx = -2;
    if (newPwState[website]) {
      idx = newPwState[website].logins.findIndex(
        (e) => e.username === username,
      );
    }

    if (idx === -2) {
      newPwState[website] = {
        timestamp,
        neverSave: false,
        logins: [
          {
            address: state?.address ?? '',
            url: website,
            username,
            password,
            timestamp,
            controlled,
          },
        ],
      };
    } else if (idx < 0) {
      // Add username/password pair to current credential entry
      newPwState[website].logins.push({
        url: website,
        timestamp,
        username,
        password,
        controlled,
      });
    } else {
      // Update password for current credential entry pair
      newPwState[website].logins[idx].password = password;
      newPwState[website].logins[idx].timestamp = timestamp;
      newPwState[website].logins[idx].controlled = controlled;
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
        controlled,
      },
    } as any);
  });

  await savePasswords(state);
  await processPending();
}

/**
 * Removes a password entry in the snap state for a website provided a username.
 *
 * @param state - EthSignKeychainState used for updating.
 * @param website - Website we are removing a password entry from.
 * @param username - Username for password entry we are removing.
 */
async function removePassword(
  state: EthSignKeychainState,
  website: string,
  username: string,
) {
  let timestamp: number;
  await saveMutex.runExclusive(async () => {
    timestamp = Math.floor(Date.now() / 1000);
    const newPwState = Object.assign({}, state.pwState);
    let idx = -2;
    if (newPwState[website]) {
      idx = newPwState[website].logins.findIndex(
        (e) => e.username === username,
      );
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

const checkAccess = async (
  origin: string,
  state: EthSignKeychainState,
  elevated: boolean,
  request: any,
) => {
  // Make sure the current origin has explicit access to use this snap
  const oha = await originHasAccess(
    origin,
    state,
    elevated,
    request?.params?.global ?? false,
  );
  if (!oha) {
    throw new Error('Access denied.');
  }

  return oha;
};

/**
 * RPC request listener.
 *
 * @param options0 - Options given to the function when RPC request is made.
 * @param options0.origin - String representing the origin of the request.
 * @param options0.request - Object containing request data. Pass in `global: true` to params to force an elevated permission request (if elevated permissions are not already granted).
 */
module.exports.onRpcRequest = async ({ origin, request }: any) => {
  // Get the local state for this snap
  const state = await getEthSignKeychainState();

  // Grab relevant values from the request params object.
  const address: string = request.params?.address ?? '';
  const website: string = request.params?.website ?? '';
  const username: string = request.params?.username ?? '';
  const password: string = request.params?.password ?? '';
  const neverSave: boolean = request.params?.neverSave ?? false;
  const controlled: boolean = request.params?.controlled ?? false;

  // Make sure the current origin has explicit access to use this snap.
  // "sync" is not an elevated call (no data is exposed). All other calls are
  // elevated if the requested data does not lie within the request origin.
  const oha = await checkAccess(
    origin,
    state,
    request.method === 'sync' ? false : website !== origin,
    request,
  );
  if (!oha) {
    throw new Error('Access denied.');
  }

  // If this origin was just added to the origin access list, oha will be
  // the string array of all origins that have access. Update our state variable
  // to have this updated list.
  if (typeof oha !== 'boolean') {
    state.credentialAccess = oha;
  }

  // Call respective function depending on RPC method
  switch (request.method) {
    case 'sync':
      await sync(state);
      return 'OK';

    case 'set_neversave':
      await setNeverSave(state, website, neverSave);
      return 'OK';

    case 'set_password':
      await setPassword(
        state,
        website,
        username,
        password,
        controlled ? origin : null,
      );
      return 'OK';

    case 'get_password':
      return state.pwState[website];

    case 'remove_password':
      await removePassword(state, website, username);
      return 'OK';

    case 'registry':
      return await registry(address);

    default:
      throw new Error('Method not found.');
  }
};
