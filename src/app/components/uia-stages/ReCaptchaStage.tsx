import React, { useEffect, useRef, useState } from 'react';
import { Dialog, Text, Box, Button, config } from 'folds';
import { AuthType } from 'matrix-js-sdk';
import ReCAPTCHA from 'react-google-recaptcha';
import { StageComponentProps } from './types';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';

// The embedded widget only works if the homeserver's reCAPTCHA key allows this client's domain.
// The homeserver's own fallback page always works, so it is offered as an alternative.
const RECAPTCHA_FALLBACK_PATH = '/_matrix/client/v3/auth/m.login.recaptcha/fallback/web';

function useHomeserverBaseUrl(): string | undefined {
  try {
    return useAutoDiscoveryInfo()['m.homeserver'].base_url;
  } catch {
    return undefined;
  }
}

function ReCaptchaErrorDialog({
  title,
  message,
  onCancel,
}: {
  title: string;
  message: string;
  onCancel: () => void;
}) {
  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Box direction="Column" gap="100">
          <Text size="H4">{title}</Text>
          <Text>{message}</Text>
        </Box>
        <Button variant="Critical" fill="None" outlined onClick={onCancel}>
          <Text as="span" size="B400">
            Cancel
          </Text>
        </Button>
      </Box>
    </Dialog>
  );
}

export function ReCaptchaStageDialog({ stageData, submitAuthDict, onCancel }: StageComponentProps) {
  const { info, session } = stageData;
  const baseUrl = useHomeserverBaseUrl();
  const popupRef = useRef<Window | null>(null);
  const submitRef = useRef(submitAuthDict);
  submitRef.current = submitAuthDict;
  const [waiting, setWaiting] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const publicKey = info?.public_key;

  const handleChange = (token: string | null) => {
    submitAuthDict({
      type: AuthType.Recaptcha,
      response: token,
      session,
    });
  };

  const openFallback = () => {
    if (!baseUrl || !session) return;
    const url = `${baseUrl.replace(/\/+$/, '')}${RECAPTCHA_FALLBACK_PATH}?session=${encodeURIComponent(
      session
    )}`;
    const popup = window.open(url, 'matrix-recaptcha', 'popup,width=480,height=640');
    popupRef.current = popup;
    setBlocked(!popup);
    setWaiting(!!popup);
  };

  // The fallback page posts "authDone" to its opener when finished. If that message never
  // arrives (e.g. the window was just closed), retry the request when the window closes.
  useEffect(() => {
    if (!waiting || !baseUrl || !session) return undefined;

    const origin = new URL(baseUrl).origin;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setWaiting(false);
      submitRef.current({ session });
    };

    const handleMessage = (evt: MessageEvent) => {
      if (evt.origin === origin && evt.data === 'authDone') finish();
    };
    window.addEventListener('message', handleMessage);
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) finish();
    }, 500);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.clearInterval(timer);
    };
  }, [waiting, baseUrl, session]);

  if (typeof publicKey !== 'string' || !session) {
    return (
      <ReCaptchaErrorDialog
        title="Invalid Data"
        message="No valid data found to proceed with ReCAPTCHA."
        onCancel={onCancel}
      />
    );
  }

  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Text>Please check the box below to proceed.</Text>
        <ReCAPTCHA sitekey={publicKey} onChange={handleChange} />
        {baseUrl && (
          <Box direction="Column" gap="200">
            <Text size="T200">
              Seeing a domain error above? Verify in a new window on the homeserver instead.
            </Text>
            <Button variant="Secondary" fill="Soft" onClick={openFallback} disabled={waiting}>
              <Text as="span" size="B400">
                {waiting ? 'Waiting for verification...' : 'Verify in a new window'}
              </Text>
            </Button>
            {blocked && (
              <Text size="T200">The popup was blocked. Allow popups for this site and retry.</Text>
            )}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
