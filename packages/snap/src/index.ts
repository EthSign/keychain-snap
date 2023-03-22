import CryptoJS from "crypto-js";
import { OnRpcRequestHandler } from "@metamask/snaps-types";

interface EthSignKeychainBase {
  address: string;
  timestamp: number;
}

interface EthSignKeychainConfig extends EthSignKeychainBase {
  encryptionMethod: string; // currently only BIP-44
}

interface EthSignKeychainEntry extends EthSignKeychainBase {
  timestamp: number;
  url: string;
  username: string;
  password: string;
}

export interface EthSignKeychainState extends EthSignKeychainBase {
  config: EthSignKeychainConfig;
  pwState: {
    [key: string]: {
      timestamp: number;
      neverSave: boolean;
      logins: EthSignKeychainEntry[];
    };
  }; // unencrypted
  pendingEntries: EthSignKeychainEntry[]; // entries pending sync with Arweave if the network fails
}

export const getEncryptedStringFromBuffer = (object: EthSignKeychainState, key: string): string => {
  const encryptedString = CryptoJS.AES.encrypt(JSON.stringify(object), key).toString();
  return encryptedString;
};

export const decryptDataArrayFromStringAES = (encryptedString: string, key = ""): EthSignKeychainState => {
  const bytes = CryptoJS.AES.decrypt(encryptedString, key);
  const decrypted: EthSignKeychainState = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  return decrypted;
};

/**
 * Handle incoming JSON-RPC requests, sent through `wallet_invokeSnap`.
 *
 * @param args - The request handler args as object.
 * @param args.origin - The origin of the request, e.g., the website that
 * invoked the snap.
 * @param args.request - A validated JSON-RPC request object.
 * @returns The result of `snap_dialog`.
 * @throws If the request method is not valid for this snap.
 */

import { Mutex } from "async-mutex";
import { getObjectsFromStorage, getTransactionIdFromStorageUpload } from "./arweave";

async function getEthSignKeychainState(): Promise<EthSignKeychainState> {
  const ethNode: any = await snap.request({
    method: "snap_getBip44Entropy",
    params: {
      coinType: 1
    }
  });

  if (!ethNode?.privateKey) {
    return {
      address: "",
      timestamp: 0,
      config: {
        address: "",
        timestamp: 0,
        encryptionMethod: "BIP-44"
      },
      pwState: {},
      pendingEntries: []
    } as EthSignKeychainState;
  }

  const state = await snap.request({
    method: "snap_manageState",
    params: {
      operation: "get"
    }
  });

  if (
    !state ||
    // @ts-ignore
    (typeof state === "object" && state === undefined)
  ) {
    return {
      address: "",
      timestamp: 0,
      config: {
        address: "",
        timestamp: 0,
        encryptionMethod: "BIP-44"
      },
      pwState: {},
      pendingEntries: []
    } as EthSignKeychainState;
  }

  return (
    decryptDataArrayFromStringAES(
      // @ts-ignore
      (state?.ethsignKeychainState as string | undefined | null) ?? "",
      ethNode.privateKey
    ) ?? {}
  );
}

async function savePasswords(newState: EthSignKeychainState) {
  const ethNode: any = await snap.request({
    method: "snap_getBip44Entropy",
    params: {
      coinType: 1
    }
  });

  if (!ethNode?.privateKey) {
    return undefined;
  }

  // The state is automatically encrypted behind the scenes by MetaMask using snap-specific keys
  await snap.request({
    method: "snap_manageState",
    params: {
      operation: "update",
      newState: { ethsignKeychainState: getEncryptedStringFromBuffer(newState, ethNode.privateKey) }
    }
  });
}

async function sync(state: EthSignKeychainState) {
  // let ret: any = undefined;
  // await fetch("https://jsonplaceholder.typicode.com/todos/1", {
  //   method: "GET"
  // })
  //   .then((res) => res.json())
  //   .then((response) => {
  //     ret = { message: "success", transaction: response };
  //   })
  //   .catch((err) => {
  //     ret = { message: "failure", transaction: err };
  //   });
  // return JSON.stringify(ret);
  const ethNode: any = await snap.request({
    method: "snap_getBip44Entropy",
    params: {
      coinType: 1
    }
  });

  if (!ethNode?.privateKey) {
    return;
  }

  // const doc = await getTransactionIdFromStorageUpload(ethNode.publicKey, ethNode.privateKey, state as any);

  // Get the remote state built on all remote objects
  const doc = await getObjectsFromStorage(ethNode.publicKey, ethNode.privateKey);
  // Merge local state with remote state and get a list of changes that we need to upload remotely
  state = await mergeStates(doc, state);

  // Save passwords locally
  await savePasswords(state);

  // Add changes to pendingState and call processPending()
  await processPending();
  return state;
}

async function mergeStates(remoteState: EthSignKeychainState, localState: EthSignKeychainState) {
  // Compare configs
  if (localState.config.timestamp < remoteState.config.timestamp) {
    localState.config.timestamp = remoteState.config.timestamp;
    localState.config.address = remoteState.config.address;
    localState.config.encryptionMethod = remoteState.config.encryptionMethod;
  } else if (localState.config.timestamp !== remoteState.config.timestamp) {
    await arweaveMutex.runExclusive(async () => {
      localState.pendingEntries.push({
        type: "config",
        payload: {
          timestamp: localState.config.timestamp,
          address: localState.config.address,
          encryptionMethod: localState.config.encryptionMethod
        }
      } as any);
    });
  }

  // Iterate through local state. Update existing pwStates with remote object (if timestamp greater)
  // and remove the pwStates from the remote object.
  for (const key of Object.keys(localState.pwState)) {
    /// Start by checking if there is a difference in neverSave entries
    if (remoteState.pwState[key] && remoteState.pwState[key].timestamp > localState.pwState[key].timestamp) {
      // Remote state is newer
      if (remoteState.pwState[key].neverSave) {
        // Clear local state
        localState.pwState[key].logins = [];
      }
    } else {
      // Local state is newer
      if (
        localState.pwState[key].neverSave &&
        localState.pwState[key].neverSave !== remoteState.pwState[key].neverSave
      ) {
        // Trigger login removal for key
        await arweaveMutex.runExclusive(async () => {
          localState.pendingEntries.push({
            type: "pwStateClear",
            payload: {
              url: key,
              timestamp: localState.pwState[key].timestamp
            }
          } as any);
        });
      }
    }

    /// Check entry by entry for mismatches

    // Iterate through localState's login entries and check them one by one for updates or removals
    let idxToRemove: number[] = [];
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
                  type: "pwStateSet",
                  payload: localEntry
                } as any);
              });
            }
          }
          // @ts-ignore
          obj.parsed = true;
        }
      } else {
        // TODO: Upload state remotely
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
      for (let idx = 0; idx < remoteState.pwState[key].logins.length; idx++) {
        const remoteEntry = remoteState.pwState[key].logins[idx];
        // @ts-ignore
        if (!remoteEntry.parsed) {
          // We do not have remoteEntry in our localState, so add it
          localState.pwState[key].logins.push({
            timestamp: remoteEntry.timestamp,
            address: remoteEntry.address,
            username: remoteEntry.username,
            password: remoteEntry.password,
            url: remoteEntry.url
          });
        }
      }
    }
  }

  return localState;
}

const saveMutex = new Mutex();
const arweaveMutex = new Mutex();

async function processPending() {
  await arweaveMutex.runExclusive(async () => {
    const state = await getEthSignKeychainState();
    const ethNode: any = await snap.request({
      method: "snap_getBip44Entropy",
      params: {
        coinType: 1
      }
    });

    if (!ethNode?.privateKey) {
      return;
    }

    for (const entry of state.pendingEntries) {
      const ret = await getTransactionIdFromStorageUpload(
        ethNode.publicKey,
        ethNode.privateKey,
        // @ts-ignore
        entry.type,
        // @ts-ignore
        entry.payload
      );

      // TODO: Check return value to make sure it was successful. Otherwise, we will need to retry (keep in pending).
    }
  });
}

module.exports.onRpcRequest = async ({ origin, request }: any) => {
  const state = await getEthSignKeychainState();

  let timestamp: number;
  let website: string, username: string, password: string;
  switch (request.method) {
    case "sync":
      return await sync(state);
    case "set_password":
      ({ website, username, password } = request.params);
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
            timestamp: timestamp,
            neverSave: false,
            logins: [{ address: "", url: website, username: username, password: password, timestamp: timestamp }]
          };
        } else if (idx < 0) {
          // Add username/password pair to current credential entry
          newPwState[website].logins.push({
            address: "",
            url: website,
            timestamp: timestamp,
            username: username,
            password: password
          });
        } else {
          // Update password for current credential entry pair
          newPwState[website].logins[idx].password = password;
          newPwState[website].timestamp = timestamp;
        }

        const newState = {
          ...state,
          timestamp: timestamp,
          pwState: newPwState
        };
        await savePasswords(newState);
      });
      await arweaveMutex.runExclusive(async () => {
        state.pendingEntries.push({
          type: "pwStateSet",
          payload: {
            timestamp: timestamp,
            url: website,
            username: username,
            password: password
          }
        } as any);
      });
      await processPending();
      return "OK";
    case "get_password":
      ({ website } = request.params);
      const showPassword = await snap.request({
        method: "snap_confirm",
        params: [
          {
            prompt: "Confirm credentials request?",
            description: "Do you want to display the password in plaintext?",
            textAreaContent: `The DApp "${origin}" is asking your credentials for "${website}"`
          }
        ]
      });
      if (!showPassword) {
        return undefined;
      }
      return state.pwState[website].logins;
    case "remove_password":
      ({ website, username } = request.params);
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

        const newState = {
          ...state,
          timestamp: timestamp,
          pwState: newPwState
        };
        await savePasswords(newState);
      });
      await arweaveMutex.runExclusive(async () => {
        state.pendingEntries.push({
          type: "pwStateDel",
          payload: {
            timestamp: timestamp,
            url: website,
            username: username
          }
        } as any);
      });
      await processPending();
      return "OK";
    default:
      throw new Error("Method not found.");
  }
};
