import { getBIP44AddressKeyDeriver } from "@metamask/key-tree";
import CryptoJS from "crypto-js";
import { OnRpcRequestHandler } from "@metamask/snaps-types";
import { panel, text } from "@metamask/snaps-ui";

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
  username: string; // encrypted
  password: string; // encrypted
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

const getEncryptedStringFromBuffer = (object: EthSignKeychainState, key: string): string => {
  const encryptedString = CryptoJS.AES.encrypt(JSON.stringify(object), key).toString();
  return encryptedString;
};

const decryptDataArrayFromStringAES = (encryptedString: string, key = ""): EthSignKeychainState => {
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
import { getObjectFromStorage, getTransactionIdFromStorageUpload } from "./arweave";

async function getEthSignKeychainState() {
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
    state === null ||
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

  return decryptDataArrayFromStringAES(
    // @ts-ignore
    (state?.ethsignKeychainState as string | undefined | null) ?? "",
    ethNode.privateKey
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

  const doc = await getTransactionIdFromStorageUpload(ethNode.publicKey, ethNode.privateKey, state as any);
  // const doc = await getObjectFromStorage(ethNode.publicKey);
  return doc;
}

const saveMutex = new Mutex();

module.exports.onRpcRequest = async ({ origin, request }: any) => {
  const state = await getEthSignKeychainState();

  let website: string, username: string, password: string;
  switch (request.method) {
    case "sync":
      return await sync(state);
    case "set_password":
      ({ website, username, password } = request.params);
      await saveMutex.runExclusive(async () => {
        const timestamp = Math.floor(Date.now() / 1000);
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
        const timestamp = Math.floor(Date.now() / 1000);
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
      return "OK";
    default:
      throw new Error("Method not found.");
  }
};
