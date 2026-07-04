import React, { createContext, useContext, useState, useCallback } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';

interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButton[];
}

interface AlertContextValue {
  show: (title: string, message?: string, buttons?: AlertButton[]) => void;
}

const AlertContext = createContext<AlertContextValue>({ show: () => {} });

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AlertConfig | null>(null);

  const show = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    setConfig({ title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] });
  }, []);

  function dismiss(btn?: AlertButton) {
    setConfig(null);
    btn?.onPress?.();
  }

  return (
    <AlertContext.Provider value={{ show }}>
      {children}
      {config && (
        <Modal transparent animationType="fade" visible statusBarTranslucent>
          <View style={s.overlay}>
            <View style={s.card}>
              <Text style={s.title}>{config.title}</Text>
              {!!config.message && <Text style={s.message}>{config.message}</Text>}
              <View style={[s.btnRow, config.buttons!.length === 1 && { justifyContent: 'center' }]}>
                {config.buttons!.map((btn, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      s.btn,
                      btn.style === 'cancel' && s.btnCancel,
                      btn.style === 'destructive' && s.btnDestructive,
                      btn.style !== 'cancel' && btn.style !== 'destructive' && s.btnPrimary,
                    ]}
                    onPress={() => dismiss(btn)}
                    activeOpacity={0.8}>
                    <Text style={[
                      s.btnText,
                      btn.style === 'cancel' && s.btnTextCancel,
                      btn.style === 'destructive' && s.btnTextDestructive,
                    ]}>
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>
      )}
    </AlertContext.Provider>
  );
}

export function useAppAlert() {
  return useContext(AlertContext);
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  card: {
    backgroundColor: T.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: T.cardBorder,
    shadowColor: T.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: T.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: T.textSecondary,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: T.accent,
  },
  btnCancel: {
    backgroundColor: T.cardElevated,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  btnDestructive: {
    backgroundColor: '#2D0F0F',
    borderWidth: 1,
    borderColor: T.red,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '700',
    color: T.textPrimary,
  },
  btnTextCancel: {
    color: T.textSecondary,
    fontWeight: '600',
  },
  btnTextDestructive: {
    color: T.red,
  },
});
