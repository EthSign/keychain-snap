import { useContext } from 'react';
import styled from 'styled-components';
import { MetamaskActions, MetaMaskContext } from '../hooks';
import {
  connectSnap,
  getSnap,
  sendClearNeverSaveClick,
  sendDecrypt,
  sendEncrypt,
  sendExportState,
  sendGet,
  sendGetSyncTo,
  sendRegistry,
  sendRemove,
  sendSet,
  sendSetNeverSaveClick,
  sendSetSyncTo,
  sendSync,
  shouldDisplayReconnectButton,
} from '../utils';
import {
  ConnectButton,
  InstallFlaskButton,
  ReconnectButton,
  Card,
  SendRemoveButton,
  SendSaveButton,
  SendGetButton,
  SendSyncButton,
  SendSetNeverSaveButton,
  SendClearNeverSaveButton,
  SendEncryptButton,
  SendRegistryButton,
  SendExportStateButton,
  SendSyncToButton,
  SendGetSyncToButton,
} from '../components';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  margin-top: 7.6rem;
  margin-bottom: 7.6rem;
  ${({ theme }) => theme.mediaQueries.small} {
    padding-left: 2.4rem;
    padding-right: 2.4rem;
    margin-top: 2rem;
    margin-bottom: 2rem;
    width: auto;
  }
`;

const Heading = styled.h1`
  margin-top: 0;
  margin-bottom: 2.4rem;
  text-align: center;
`;

const Span = styled.span`
  color: ${(props) => props.theme.colors.primary.default};
`;

const Subtitle = styled.p`
  font-size: ${({ theme }) => theme.fontSizes.large};
  font-weight: 500;
  margin-top: 0;
  margin-bottom: 0;
  ${({ theme }) => theme.mediaQueries.small} {
    font-size: ${({ theme }) => theme.fontSizes.text};
  }
`;

const CardContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  max-width: 64.8rem;
  width: 100%;
  height: 100%;
  margin-top: 1.5rem;
`;

const Notice = styled.div`
  background-color: ${({ theme }) => theme.colors.background.alternative};
  border: 1px solid ${({ theme }) => theme.colors.border.default};
  color: ${({ theme }) => theme.colors.text.alternative};
  border-radius: ${({ theme }) => theme.radii.default};
  padding: 2.4rem;
  margin-top: 2.4rem;
  max-width: 60rem;
  width: 100%;

  & > * {
    margin: 0;
  }
  ${({ theme }) => theme.mediaQueries.small} {
    margin-top: 1.2rem;
    padding: 1.6rem;
  }
`;

const ErrorMessage = styled.div`
  background-color: ${({ theme }) => theme.colors.error.muted};
  border: 1px solid ${({ theme }) => theme.colors.error.default};
  color: ${({ theme }) => theme.colors.error.alternative};
  border-radius: ${({ theme }) => theme.radii.default};
  padding: 2.4rem;
  margin-bottom: 2.4rem;
  margin-top: 2.4rem;
  max-width: 60rem;
  width: 100%;
  ${({ theme }) => theme.mediaQueries.small} {
    padding: 1.6rem;
    margin-bottom: 1.2rem;
    margin-top: 1.2rem;
    max-width: 100%;
  }
`;

const Index = () => {
  const [state, dispatch] = useContext(MetaMaskContext);

  const handleConnectClick = async () => {
    try {
      await connectSnap();
      const installedSnap = await getSnap();

      dispatch({
        type: MetamaskActions.SetInstalled,
        payload: installedSnap,
      });

      // Sync with remote on install
      try {
        if (installedSnap) {
          handleSendSyncClick();
        }
      } catch (err) {
        console.log(err);
      }
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendRemoveClick = async () => {
    try {
      console.log(await sendRemove());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendSaveClick = async () => {
    try {
      console.log(await sendSet());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendGetClick = async () => {
    try {
      console.log(await sendGet());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSetNeverSaveClick = async () => {
    try {
      console.log(await sendSetNeverSaveClick());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleClearNeverSaveClick = async () => {
    try {
      console.log(await sendClearNeverSaveClick());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendSyncClick = async () => {
    try {
      console.log(await sendSync());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendEncryptClick = async () => {
    try {
      // console.log(await sendEncrypt());
      console.log(await sendDecrypt((await sendEncrypt()).data));
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendRegistryClick = async () => {
    try {
      // For a failed security check, use 0x985Eb8f653Ab087d4122F0C1dBc7972dF6B1642B
      // For a successful registry entry, use 0x11ee0cf7235Cb595f68e586E8727287aC2BE540A
      console.log(
        await sendRegistry('0x11ee0cf7235Cb595f68e586E8727287aC2BE540A'),
      );
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendExportStateClick = async () => {
    try {
      console.log(await sendExportState());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendSyncToClick = async () => {
    try {
      console.log(await sendSetSyncTo());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  const handleSendGetSyncToClick = async () => {
    try {
      console.log(await sendGetSyncTo());
    } catch (e) {
      console.error(e);
      dispatch({ type: MetamaskActions.SetError, payload: e });
    }
  };

  return (
    <Container>
      <Heading>
        Welcome to <Span>template-snap</Span>
      </Heading>
      <Subtitle>
        Get started by editing <code>src/index.ts</code>
      </Subtitle>
      <CardContainer>
        {state.error && (
          <ErrorMessage>
            <b>An error happened:</b> {state.error.message}
          </ErrorMessage>
        )}
        {!state.isFlask && (
          <Card
            content={{
              title: 'Install',
              description:
                'Snaps is pre-release software only available in MetaMask Flask, a canary distribution for developers with access to upcoming features.',
              button: <InstallFlaskButton />,
            }}
            fullWidth
          />
        )}
        {!state.installedSnap && (
          <Card
            content={{
              title: 'Connect',
              description:
                'Get started by connecting to and installing the example snap.',
              button: (
                <ConnectButton
                  onClick={handleConnectClick}
                  disabled={!state.isFlask}
                />
              ),
            }}
            disabled={!state.isFlask}
          />
        )}
        {shouldDisplayReconnectButton(state.installedSnap) && (
          <Card
            content={{
              title: 'Reconnect',
              description:
                'While connected to a local running snap this button will always be displayed in order to update the snap if a change is made.',
              button: (
                <ReconnectButton
                  onClick={handleConnectClick}
                  disabled={!state.installedSnap}
                />
              ),
            }}
            disabled={!state.installedSnap}
          />
        )}
        <Card
          content={{
            title: 'Send Hello message',
            description:
              'Display a custom message within a confirmation screen in MetaMask.',
            button: (
              <>
                <SendRemoveButton
                  onClick={handleSendRemoveClick}
                  disabled={!state.installedSnap}
                />
                <SendSaveButton
                  onClick={handleSendSaveClick}
                  disabled={!state.installedSnap}
                />
                <SendGetButton
                  onClick={handleSendGetClick}
                  disabled={!state.installedSnap}
                />
                <SendSetNeverSaveButton
                  onClick={handleSetNeverSaveClick}
                  disabled={!state.installedSnap}
                />
                <SendClearNeverSaveButton
                  onClick={handleClearNeverSaveClick}
                  disabled={!state.installedSnap}
                />
                <SendSyncButton
                  onClick={handleSendSyncClick}
                  disabled={!state.installedSnap}
                />
                <SendEncryptButton
                  onClick={handleSendEncryptClick}
                  disabled={!state.installedSnap}
                />
                <SendRegistryButton
                  onClick={handleSendRegistryClick}
                  disabled={!state.installedSnap}
                />
                <SendExportStateButton
                  onClick={handleSendExportStateClick}
                  disabled={!state.installedSnap}
                />
                <SendSyncToButton
                  onClick={handleSendSyncToClick}
                  disabled={!state.installedSnap}
                />
                <SendGetSyncToButton
                  onClick={handleSendGetSyncToClick}
                  disabled={!state.installedSnap}
                />
              </>
            ),
          }}
          disabled={!state.installedSnap}
          fullWidth={
            state.isFlask &&
            Boolean(state.installedSnap) &&
            !shouldDisplayReconnectButton(state.installedSnap)
          }
        />
        <Notice>
          <p>
            Please note that the <b>snap.manifest.json</b> and{' '}
            <b>package.json</b> must be located in the server root directory and
            the bundle must be hosted at the location specified by the location
            field.
          </p>
        </Notice>
      </CardContainer>
    </Container>
  );
};

export default Index;
