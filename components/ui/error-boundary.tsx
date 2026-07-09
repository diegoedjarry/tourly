import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Sentry from '@sentry/react-native';

// Same guard app/_layout.tsx uses before Sentry.init — only report when a DSN
// is actually configured, so local/dev builds without a DSN never no-op-throw.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Class component on purpose — componentDidCatch has no hook equivalent.
// Keep this file hook-free (no useLanguage) so it can catch errors thrown
// by hooks/providers themselves without depending on them.
interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (SENTRY_DSN) {
      Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.message}>
            Something went wrong. Please try again.{'\n'}
            Algo salió mal. Por favor, inténtalo de nuevo.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try again / Reintentar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 32,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: '#2D2B55',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#5B5BD6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
