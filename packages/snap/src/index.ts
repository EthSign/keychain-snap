// eslint-disable-next-line
import * as types from "@metamask/snaps-types";

import { Mutex } from 'async-mutex';
import { heading, panel, text } from '@metamask/snaps-ui';
import {
  decryptDataArrayFromStringAES,
  getEncryptedStringFromBuffer,
  getObjectsFromStorage,
  getTransactionIdFromStorageUploadBatch,
} from './arweave';

type EthSignKeychainBase = {
  address?: string;
  timestamp: number;
};

type EthSignKeychainConfig = {
  encryptionMethod: string; // currently only BIP-44
} & EthSignKeychainBase;

export type EthSignKeychainEntry = {
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

// Create mutexes for changing our local state object (no dirty writes)
const saveMutex = new Mutex();
const arweaveMutex = new Mutex();

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
      pwState: {},
      pendingEntries: [],
      credentialAccess: [],
    } as EthSignKeychainState;
  }

  // Get the stored local snap state
  const state = await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'get',
    },
  });

  // Local state doesn't exist or we encounted unexpected error. Return empty state.
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
      credentialAccess: [],
    } as EthSignKeychainState;
  }

  // Return decrypted state
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

  // The state is automatically encrypted behind the scenes by MetaMask using snap-specific keys
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: {
        ethsignKeychainState: getEncryptedStringFromBuffer(
          newState,
          ethNode.privateKey,
        ),
      },
    },
  });
}

/**
 * Sfdsaf.
 */
async function getKey() {
  const ethNode: any = await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: 60,
    },
  });

  return ethNode;
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

  // Get the remote state built on all remote objects
  const localState = await getObjectsFromStorage(
    ethNode.publicKey,
    ethNode.privateKey,
    state,
  );

  const remoteState = await getObjectsFromStorage(
    ethNode.publicKey,
    ethNode.privateKey,
  );
  // Merge local state with remote state and get a list of changes that we need to upload remotely
  // const tmpState = await mergeStates(doc, state);
  const tmpState = await checkRemoteStatus(localState, remoteState);

  // If config has never been initialized, initialize it
  if (!tmpState.config.address || tmpState.config.address === '') {
    tmpState.config = {
      address: ethNode.publicKey,
      encryptionMethod: 'BIP-44',
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Add config set pending entry (for remote Arweave update)
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
  // Check configs
  if (
    localState.config.timestamp > remoteState.config.timestamp ||
    localState.config.address !== remoteState.config.address
  ) {
    localState.pendingEntries.push({
      type: 'config',
      payload: {
        timestamp: localState.config.timestamp,
        address: localState.config.address,
        encryptionMethod: localState.config.encryptionMethod,
      },
    } as any);
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
              localState.pendingEntries.push({
                type: 'pwStateSet',
                payload: entry,
              } as any);
            });
          }
        } else {
          // Not found remotely, but our local version has it. Add it to remote state.
          // Since our local state was already updated using the remote event logs,
          // our local state will always be newer, so we always need to add a new entry.
          await arweaveMutex.runExclusive(async () => {
            localState.pendingEntries.push({
              type: 'pwStateSet',
              payload: entry,
            } as any);
          });
        }
      }
    } else {
      // If key does not exist on remote, add each password entry to remote state.
      for (const entry of localState.pwState[key].logins) {
        await arweaveMutex.runExclusive(async () => {
          localState.pendingEntries.push({
            type: 'pwStateSet',
            payload: entry,
          } as any);
        });
      }
    }
  }

  return localState;
}

/**
 * Merge the two provided states into a single state that includes transactions that
 * need to be uploaded to update the remote state.
 *
 * @param remoteState - Remote state we are merging into local state.
 * @param localState - Local state we are modifying with remote state.
 */
// async function mergeStates(
//   remoteState: EthSignKeychainState,
//   localState: EthSignKeychainState,
// ) {
//   // Compare configs
//   if (localState.config.timestamp < remoteState.config.timestamp) {
//     // Update local main timestamp variable if remote config is newer
//     if (localState.timestamp < remoteState.config.timestamp) {
//       localState.timestamp = remoteState.config.timestamp;
//     }

//     localState.config.timestamp = remoteState.config.timestamp;
//     localState.config.address = remoteState.config.address;
//     localState.config.encryptionMethod = remoteState.config.encryptionMethod;
//   } else if (localState.config.timestamp !== remoteState.config.timestamp) {
//     // Add config set pending entry (for remote Arweave update) if it doesn't exist yet
//     if (
//       localState.pendingEntries.findIndex(
//         (entry: any) => entry.type === 'config',
//       ) < 0
//     ) {
//       await arweaveMutex.runExclusive(async () => {
//         localState.pendingEntries.push({
//           type: 'config',
//           payload: {
//             timestamp: localState.config.timestamp,
//             address: localState.config.address,
//             encryptionMethod: localState.config.encryptionMethod,
//           },
//         } as any);
//       });
//     }
//   }

//   const localKeys = Object.keys(localState.pwState);
//   // Iterate through local state. Update existing pwStates with remote object (if timestamp greater)
//   // and remove the pwStates from the remote object.
//   for (const key of localKeys) {
//     // / Start by checking if there is a difference in neverSave entries
//     if (
//       remoteState.pwState[key] &&
//       remoteState.pwState[key].timestamp > localState.pwState[key].timestamp
//     ) {
//       // Remote state is newer
//       if (remoteState.pwState[key].timestamp > localState.timestamp) {
//         localState.timestamp = remoteState.pwState[key].timestamp;
//       }

//       if (remoteState.pwState[key].neverSave) {
//         // Clear local state
//         localState.pwState[key].logins = [];
//       } else if (localState.pwState[key]?.neverSave) {
//         localState.pwState[key].neverSave = false;
//       }

//       // Iterate through remote login entries and add/update local state to match
//       // for (const entry of remoteState.pwState[key].logins) {
//       //   const idx = localState.pwState[key].logins.findIndex(
//       //     (e) => e.username === entry.username,
//       //   );
//       //   if (
//       //     idx >= 0 &&
//       //     localState.pwState[key].logins[idx].timestamp < entry.timestamp
//       //   ) {
//       //     localState.pwState[key].logins[idx] = entry;
//       //   } else if (idx < 0) {
//       //     localState.pwState[key].logins.push(entry);
//       //   }

//       //   if (localState.pwState[key].timestamp < entry.timestamp) {
//       //     localState.pwState[key].timestamp = entry.timestamp;
//       //   }
//       // }
//     } else {
//       // Local state is newer
//       // eslint-disable-next-line no-lonely-if
//       if (
//         localState.pwState[key].neverSave &&
//         localState.pwState[key].neverSave !==
//           remoteState.pwState[key]?.neverSave &&
//         localState.pendingEntries.findIndex(
//           (entry: any) =>
//             entry.type === 'pwStateClear' && entry.payload.url === key,
//         ) < 0
//       ) {
//         // Trigger login removal for key
//         await arweaveMutex.runExclusive(async () => {
//           localState.pendingEntries.push({
//             type: 'pwStateClear',
//             payload: {
//               url: key,
//               timestamp: localState.pwState[key].timestamp,
//             },
//           } as any);
//         });
//       }
//     }

//     // Check entry by entry for mismatches

//     // Iterate through localState's login entries and check them one by one for updates or removals
//     const idxToRemove: number[] = [];
//     for (let idx = 0; idx < localState.pwState[key].logins.length; idx++) {
//       const localEntry = localState.pwState[key].logins[idx];
//       let found = false;
//       if (remoteState.pwState[key]) {
//         for (const obj of remoteState.pwState[key].logins) {
//           if (obj.username === localEntry.username) {
//             found = true;
//             if (obj.timestamp > localEntry.timestamp) {
//               // Remote entry is newer
//               if (obj.timestamp > localState.timestamp) {
//                 localState.timestamp = obj.timestamp;
//               }

//               localEntry.password = obj.password;
//               localEntry.address = obj.address;
//               localEntry.timestamp = obj.timestamp;
//               localEntry.url = obj.url;
//             } else if (obj.timestamp !== localEntry.timestamp) {
//               // Local entry is newer
//               await arweaveMutex.runExclusive(async () => {
//                 localState.pendingEntries.push({
//                   type: 'pwStateSet',
//                   payload: localEntry,
//                 } as any);
//               });
//             }
//           }

//           if (found) {
//             // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//             // @ts-ignore
//             obj.parsed = true;
//           }
//         }
//       } else {
//         // Somehow we have a local state that does not exist remotely, likely with no pending entries (shouldn't
//         // happen unless something magically breaks). Add the localEntry to the pendingEntry array for processing.
//         await arweaveMutex.runExclusive(async () => {
//           localState.pendingEntries.push({
//             type: 'pwStateSet',
//             payload: localEntry,
//           } as any);
//         });
//       }

//       // If we did not find the entry and the localState is stale, remove entry from local state
//       if (!found && remoteState.timestamp > localState.timestamp) {
//         if (localState.timestamp < remoteState.timestamp) {
//           localState.timestamp = remoteState.timestamp;
//         }
//         idxToRemove.unshift(idx);
//       }
//     }

//     // Remove all stale entries (highest index first)
//     for (const idx of idxToRemove) {
//       localState.pwState[key].logins.splice(idx, 1);
//     }

//     // Parse remote object for entries that do not exist locally. Add them to local pwState if timestamp
//     // greater than local state's global timestamp.
//     if (remoteState.pwState[key]?.logins) {
//       for (const remoteEntry of remoteState.pwState[key].logins) {
//         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//         // @ts-ignore
//         if (!remoteEntry.parsed) {
//           // We do not have remoteEntry in our localState, so add it
//           localState.pwState[key].logins.push({
//             timestamp: remoteEntry.timestamp,
//             address: remoteEntry.address,
//             username: remoteEntry.username,
//             password: remoteEntry.password,
//             url: remoteEntry.url,
//           });
//         }
//       }
//     }
//   }

//   for (const key of Object.keys(remoteState.pwState)) {
//     const idx = localKeys.indexOf(key);
//     if (idx < 0) {
//       localState.pwState[key] = remoteState.pwState[key];
//     }
//   }

//   if (remoteState.timestamp > localState.timestamp) {
//     localState.timestamp = remoteState.timestamp;
//   }

//   return localState;
// }

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
 * @returns Boolean representing access for provided origin, or the current array of origin strings
 * if the current origin was just approved by the user.
 */
async function originHasAccess(origin: string, state: EthSignKeychainState) {
  if (!state?.credentialAccess?.includes(`${origin}`)) {
    const showPassword = await snap.request({
      method: 'snap_dialog',
      params: {
        type: 'confirmation',
        content: panel([
          heading('Security Alert'),
          text(
            `"${origin}" is requesting access to your credentials. Would you like to proceed?`,
          ),
        ]),
      },
    });

    if (showPassword) {
      // Update our local approved origin list
      state.credentialAccess.push(origin);
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
 * Update snap state for website provided value for username and password.
 *
 * @param state - EthSignKeychainState used for updating.
 * @param website - Website we are updating password on.
 * @param username - Username we are setting.
 * @param password - Password we are setting.
 */
async function setPassword(
  state: EthSignKeychainState,
  website: string,
  username: string,
  password: string,
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

/**
 * RPC request listener.
 *
 * @param options0 - Options given to the function when RPC request is made.
 * @param options0.origin - String representing the origin of the request.
 * @param options0.request - Object containing request data.
 */
module.exports.onRpcRequest = async ({ origin, request }: any) => {
  // Get the local state for this snap
  const state = await getEthSignKeychainState();

  // Make sure the current origin has explicit access to use this snap
  const oha = await originHasAccess(origin, state);
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
  let website: string, username: string, password: string, neverSave: boolean;
  switch (request.method) {
    case 'sync':
      return await sync(state);
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

    // eslint-disable-next-line
    // @ts-ignore
    case 'get_key':
      return getKey();

    default:
      throw new Error('Method not found.');
  }
};
