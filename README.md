# EthSign Keychain

EthSign Keychain is a password manager encrypted by BIP-44 entropy generated from your seed phrase. State-keeping outside of MetaMask is optional and delegated to Arweave or AWS to enable decentralized cross-device synchronization.

EthSign Keychain consists of two parts:

- Snap: used to encrypt & save passwords and retrieve & decrypt passwords. The local state is stored within MetaMask, and the remote state is optionally stored on AWS or Arweave.
- Companion extension or API: as MetaMask Snaps are entirely reactive, they need an outside JSON-RPC call to trigger functionality. This is where the companion extension and API come in — aside from recognizing specific fields on a webpage (e.g. `username` and `password`), the extension also triggers the appropriate functions within the Snap. The API can be integrated into 3rd party websites to store and retrieve unique key/value pairs.

# Entry & State Data Models

```tsx
enum RemoteLocation {
  ARWEAVE,
  AWS,
  NONE,
}

type EthSignKeychainBase {
	address?: string;
  timestamp: number;
}

type EthSignKeychainConfig = {
  encryptionMethod: string; // currently only "BIP-44"
} & EthSignKeychainBase;

type EthSignKeychainRegistry = {
  publicAddress: string;
  publicKey: string;
  timestamp: number;
};

type EthSignKeychainEntry = {
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

type EthSignKeychainState = {
  config: EthSignKeychainConfig;
  pwState: {
    [key: string]: EthSignKeychainPasswordState;
  }; // unencrypted
  pendingEntries: {
    type: string,
    payload: EthSignKeychainEntry
  }[]; // entries pending sync with Arweave if the network fails
  credentialAccess: { [origin: string]: boolean };
  password: string | null;
  remoteLocation: RemoteLocation | null;
} & EthSignKeychainBase;
```

# Arweave File Entry Types

```tsx
/*
 * Files are in this format:
 * {
 *   type: string;
 *   payload: Object;
 * }
 */
```

## `pwStateClear`

```tsx
/*
 * payload: {
 *   url: string;
 *   timestamp: number;
 * }
 */
```

Description:

- Clears all passwords from a given website.

## `pwStateDel`

```tsx
/*
 * payload: {
 *   url: string;
 *   username: string;
 *   timestamp: number;
 * }
 */
```

Description:

- Attempts to remove a password entry from a website.

## `pwStateNeverSaveSet`

```tsx
/*
 * payload: {
 *   url: string;
 *   neverSave: boolean;
 *   timestamp: number;
 * }
 */
```

Description:

- Sets neverSave on a password state. Clears the list of logins if neverSave is set to true.

## `pwStateSet`

```tsx
/*
 * payload: {
 *   url: string;
 *   username: string;
 *   password: string;
 *   controlled: boolean;
 *   timestamp: number;
 * }
 */
```

Description:

- Creates or updates a username/password entry for a given website.

## `config`

```tsx
/*
 * payload: {
 *   address: string;
 *   encryptionMethod: string;
 *   timestamp: number;
 * }
 */
```

Description:

- Updates the config object for the EthSignKeychainState.

## `registry`

```tsx
/*
 * payload: {
 *   publicAddress: string;
 *   publicKey: string;
 *   timestamp: number;
 * }
 */
```

Description:

- Updates the registry object for the EthSignKeychainState.

# Snap

## `sync`

Description:

- Retrieves all remote event files from Arweave and uses them to validate the local state and build a complete remote state object. Compares the updated local state with the remote state, adding pending entries for any changes in the local state that are not found in the remote state. Attempts to upload pending entries to Arweave.

Given:

- N/A

Returns:

- “OK” upon RPC completed.

## `set_sync_to`

Description:

- Update the remote sync location of a given state object following a MetaMask confirmation popup.

Given:

- data: String consisting of “aws”, “arweave”, or “none” representing the new sync location.

Returns:

- String consisting of the new sync location.

## `get_sync_to`

Description:

- Get the remote sync location.

Given:

- N/A

Returns:

- String consisting of “aws”, “arweave”, or “none” representing the remote sync location.

## `set_neversave`

Description:

- Set whether or not we should prompt to save passwords for a given website. Adds a pending entry that attempts an upload to Arweave.

Given:

- website: Website for which we are updating the neverSave state.
- neverSave: A boolean value representing whether or not to save passwords for the current website.

Returns:

- “OK” upon RPC completed.

## `set_password`

Description:

- Receives a website, username, and password and saves the entry to the local state with the current timestamp. Adds a pending entry that attempts an upload to Arweave.

Given:

- website: Website we are updating the password on.
- username: Username we are setting.
- password: Password we are setting.

Returns:

- “OK” upon RPC completed.

## `get_password`

Description:

- Returns the local password state for a provided website.

Given:

- website: The website URL we are fetching a password state for.

Returns:

- EthSignKeychainPasswordState for the provided website

## `remove_password`

Description:

- Removes a password from the local state given a website and the associated username. If an entry is found, the entry is removed locally and a pending entry is created. It attempts to upload the pending entry to Arweave.

Given:

- website: The website URL whose state we are trying to remove a password entry from.
- username: The username associated with the password entry we are attempting to remove.

Returns:

- “OK” upon RPC completed.

## `registry`

Description:

- Retrieves the registry information for a given wallet address, which includes the wallet’s address and public key.

Given:

- address: A string that contains a wallet address.

Returns:

- { publicAddress: string, publicKey: string } for the provided address

## `encrypt`

Description:

- Encrypt a string using a receiver's public key. Fails if the receiver's public key cannot be located.

Given:

- address: Address of the receiver that can decrypt the message using their private key.
- data: String payload to be encrypted.

Returns:

- { success: boolean, data?: string, message?: string }

## `decrypt`

Description:

- Decrypts a hex string using the current user's private key.

Given:

- data: String payload to be decrypted.

Returns:

- { success: boolean, data?: string, message?: string }

## `export`

Description:

- Export the password state from the current EthSignKeychainState stored locally. Requires the user to enter a password for encryption in a MetaMask popup.

Given:

- N/A

Returns:

- { success: boolean, data?: string, message?: string }

## `import`

Description:

- Import a user's credential state, which was encrypted and exported into a JSON object containing nonce and data strings. Requires the user to enter a password for decryption in a MetaMask popup. Will ask the user to choose between merging and replacing their local state, if one exists.

Given:

- data: String containing a JSON object with nonce and data entries.

Returns:

- { success: boolean, message?: string }

# Companion Extension

The companion extension is used to detect usernames & passwords from the webpages, prompt saving them or auto-filling them, and interact with Snap via JSON-RPC calls to provide an interface to view & edit entries, manually synchronize, and else.

### Features

- Form submission detection which finds most single-step login and signup forms.
- Banners that appear on form submission to quickly and easily save new or updated credentials, or choose to never save passwords for a given site.
- Login form autofill capabilities.
- Manually trigger a sync with remote password entries from Arweave or AWS.
- Easy UX flow for exporting and importing password states into the keychain snap.
- Manually add, edit, and delete password entries from the keychain.
- Easily visualize all password credentials for the current site.
- Disable remote syncing, or change the keychain snap’s remote syncing location between AWS and Arweave.

# Companion API

The companion API provides full access to all snap features and functionalities. It is provided as an NPM package that can be installed by running `npm i keychain-api`. API usage is documented in the package’s readme, located at https://github.com/EthSign/keychain-api.
