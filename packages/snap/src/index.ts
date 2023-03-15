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
  domain: string;
  username: string; // encrypted
  password: string; // encrypted
}

interface EthSignKeychainState extends EthSignKeychainBase {
  config: EthSignKeychainConfig;
  pwState: {
    [key: string]: {
      timestamp: number;
      neverSave: boolean;
      logins: { username: string; password: string; timestamp: number }[];
    };
  }; // unencrypted
  pendingEntries: EthSignKeychainEntry[]; // entries pending sync with Arweave if the network fails
}

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
// export const onRpcRequest: OnRpcRequestHandler = ({ origin, request }) => {
//   switch (request.method) {
//     case "hello":
//       return snap.request({
//         method: "snap_dialog",
//         params: {
//           type: "Confirmation",
//           content: panel([
//             text(`Hello, **${origin}**!`),
//             text("This custom confirmation is just for display purposes."),
//             text("But you can edit the snap source code to make it do something, if you want to!")
//           ])
//         }
//       });
//     default:
//       throw new Error("Method not found.");
//   }
// };

import { Mutex } from "async-mutex";

// function fuzzySearch(haystack, needle) {
//   let regexPattern = ".*";
//   for (let i = 0; i < needle.length; i++) {
//     regexPattern += needle[i] + ".*";
//   }
//   const regex = new RegExp(regexPattern);

//   return haystack.reduce((results, possibility) => {
//     if (possibility.search(regex) !== -1) {
//       results.push(possibility);
//     }
//     return results;
//   }, []);
// }

async function getPasswords() {
  const state = await snap.request({
    method: "snap_manageState",
    params: ["get"]
  });
  // @ts-ignore
  if (state === null || (typeof state === "object" && state.passwords === undefined)) {
    return {};
  }
  // @ts-ignore
  return state.passwords;
}

async function savePasswords(newState: any) {
  // The state is automatically encrypted behind the scenes by MetaMask using snap-specific keys
  await snap.request({
    method: "snap_manageState",
    params: ["update", { passwords: newState }]
  });
}

const saveMutex = new Mutex();

// @ts-ignore
module.exports.onRpcRequest = async ({ origin, request }) => {
  const state = await getPasswords();

  let website: string, username: string, password: string;
  switch (request.method) {
    case "hello":
      return snap.request({
        method: "snap_dialog",
        params: {
          type: "confirmation",
          content: panel([
            text(`Hello, **${origin}**!`),
            text("This custom confirmation is just for display purposes."),
            text("But you can edit the snap source code to make it do something, if you want to!")
          ])
        }
      });
    case "save_password":
      ({ website, username, password } = request.params);
      await saveMutex.runExclusive(async () => {
        const oldState = await getPasswords();
        const newState = {
          ...oldState,
          [website]: { username, password }
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
            prompt: "Confirm password request?",
            description: "Do you want to display the password in plaintext?",
            textAreaContent: `The DApp "${origin}" is asking to display the account and password for "${website}" website`
          }
        ]
      });
      if (!showPassword) {
        return undefined;
      }
      return state[website];
    // case "search":
    //   const { pattern } = request.params;
    //   return fuzzySearch(Object.keys(state), pattern);
    case "clear":
      await snap.request({
        method: "snap_manageState",
        params: ["update", {}]
      });
      return "OK";
    default:
      throw new Error(`Method ${request.method} not found.`);
  }
};
