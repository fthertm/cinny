import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';

export function AuthFooter() {
  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text as="span" size="T300">
        Developed with 🖤 by{' '}
        <a href="https://fatihertem.com" target="_blank" rel="noreferrer">
          Fatih Ertem
        </a>
      </Text>
    </Box>
  );
}
