import { NodeType, Panel, heading, panel, text } from '@metamask/snaps-ui';

/**
 * Creates a MetaMask confirmation dialog window.
 *
 * @param content - Panel to be displayed in the confirmation dialog.
 * @returns True/false depending on user interaction.
 */
export async function metamaskConfirmation(
  content:
    | Panel
    | {
        value: string;
        type: NodeType.Copyable;
      }
    | {
        type: NodeType.Divider;
      }
    | {
        value: string;
        type: NodeType.Heading;
      }
    | {
        type: NodeType.Spinner;
      }
    | {
        value: string;
        type: NodeType.Text;
      },
) {
  return await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content,
    },
  });
}

/**
 * Creates a MetaMask prompt dialog window.
 *
 * @param content - Panel to be displayed in the prompt dialog.
 * @param placeholder - Placeholder value to be shown in the input of the form.
 * @returns Value provided in the input by the user.
 */
export async function metamaskPrompt(
  content:
    | Panel
    | {
        value: string;
        type: NodeType.Copyable;
      }
    | {
        type: NodeType.Divider;
      }
    | {
        value: string;
        type: NodeType.Heading;
      }
    | {
        type: NodeType.Spinner;
      }
    | {
        value: string;
        type: NodeType.Text;
      },
  placeholder: string,
) {
  return await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'prompt',
      content,
      placeholder,
    },
  });
}

/**
 * Request password from the user using a MetaMask popup.
 *
 * @param message - Message for body of the popup request.
 * @returns MetaMask prompt response.
 */
export async function requestPassword(
  message = 'Please enter the password to decrypt the import file.',
) {
  return await metamaskPrompt(
    panel([heading('Enter Password'), text(message)]),
    'Enter password',
  );
}

/**
 * Ask the user whether to merge or replace their current credentials with those that have been imported.
 *
 * @returns MetaMask prompt response.
 */
export async function importCredentials() {
  return await metamaskConfirmation(
    panel([
      heading('Import Credentials'),
      text(
        `Approve to merge imported credentials with your existing state. Reject to replace your existing state with the imported data.`,
      ),
    ]),
  );
}

/**
 * Request security access for the origin from the user.
 *
 * @param origin - Origin requesting access to protected resources.
 * @param global - Whether or not the origin is requesting protected resources from another origin.
 * @param elevated - Whether or not the requested resources are of elevated status.
 * @returns MetaMask prompt response.
 */
export async function securityAlert(
  origin: string,
  global: boolean,
  elevated: boolean,
) {
  return await metamaskConfirmation(
    panel([
      heading('Security Alert'),
      text(
        `"${origin}" is requesting access to your credentials ${
          global || elevated ? 'for all sites' : 'for the current site'
        }. Would you like to proceed?`,
      ),
    ]),
  );
}

/**
 * Prompt user to confirm a sync location update.
 *
 * @param syncLocation - String containing "AWS", "Arweave", or "None".
 * @returns MetaMask prompt response.
 */
export async function whereToSync(syncLocation: string) {
  if (syncLocation === 'None') {
    return await metamaskConfirmation(
      panel([
        heading(`Disable Syncing?`),
        text(`Are you sure you wish to disable syncing?`),
      ]),
    );
  }

  return await metamaskConfirmation(
    panel([
      heading(`Sync to ${syncLocation}?`),
      text(`Are you sure you wish to sync to ${syncLocation}?`),
    ]),
  );
}
