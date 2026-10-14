import React, { useEffect, useRef, useState } from 'react';
import { Dialog, Text, Box, Button, config } from 'folds';
import { StageComponentProps } from './types';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';

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
  const { session } = stageData;
  const baseUrl = useHomeserverBaseUrl();
  const popupRef = useRef<Window | null>(null);
  const submitRef = useRef(submitAuthDict);
  submitRef.current = submitAuthDict;
  const [waiting, setWaiting] = useState(false);
  const [blocked, setBlocked] = useState(false);

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

  if (!session || !baseUrl) {
    return (
      <ReCaptchaErrorDialog
        title="Invalid Data"
        message="No valid session or homeserver URL found to proceed with verification."
        onCancel={onCancel}
      />
    );
  }

  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Box direction="Column" gap="100">
          <Text size="H4">Doğrulama Gerekli</Text>
          <Text>İşleme devam etmek için sunucu üzerindeki doğrulama penceresini açın.</Text>
        </Box>
        <Button variant="Primary" fill="Solid" onClick={openFallback} disabled={waiting}>
          <Text as="span" size="B400">
            {waiting ? 'Doğrulama bekleniyor...' : 'Doğrulama Penceresini Aç'}
          </Text>
        </Button>
        {blocked && (
          <Text size="T200">Tarayıcınız pop-up pencereyi engelledi. Lütfen bu site için pop-up izinlerini açın.</Text>
        )}
      </Box>
    </Dialog>
  );
}