import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { AgentIcon } from '@/components/ui/agent-icon';
import { useLanguage } from '@/hooks/useLanguage';
import { getMonthAbbr, type Lang, type StringKey } from '@/lib/i18n';
import { T } from '@/constants/theme';

export interface InsightItem {
  id: string;
  content: string;
  insight_label?: string;
  generated_at?: string;
}

interface FloatingInsightProps {
  insights: InsightItem[];
  locked?: boolean;
}

function relativeDate(iso: string, lang: Lang, t: (key: StringKey) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return t('calendar.today');
  if (diffDays === 1) return t('common.yesterday');
  const [, m, day] = iso.split('T')[0].split('-');
  const MONTHS = getMonthAbbr(lang);
  return `${+day} ${MONTHS[+m - 1]}`;
}

export function FloatingInsight({ insights, locked }: FloatingInsightProps) {
  const [open, setOpen] = useState(false);
  const { t, lang } = useLanguage();

  // Only show the 2 most recent insights
  const shown = (insights ?? []).slice(0, 2);
  const hasInsights = shown.length > 0;

  return (
    <>
      {/* Floating action button */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.aiInsights')}
      >
        {hasInsights ? (
          <AgentIcon size={26} />
        ) : (
          <Text style={s.fabSparkle}>✦</Text>
        )}
      </TouchableOpacity>

      {/* Modal */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.panel} onPress={() => {}}>

            {/* Header */}
            <View style={s.header}>
              <View style={s.iconWrap}>
                <AgentIcon size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.headerTitle}>{t('coaching.title')}</Text>
                <Text style={s.headerSub}>{t('coaching.subtitle')}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                activeOpacity={0.7}
                style={s.closeBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Content */}
            {locked || !hasInsights ? (
              <View style={s.emptyWrap}>
                <Text style={s.emptyText}>
                  {locked
                    ? t('coaching.lockedMessage')
                    : t('coaching.generatingMessage')}
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
                {shown.map((item, i) => (
                  <View key={item.id} style={[s.insightCard, i > 0 && s.insightCardBorder]}>
                    <View style={s.cardTopRow}>
                      <Text style={s.cardLabel}>{item.insight_label ?? t('coaching.label')}</Text>
                      {item.generated_at && (
                        <Text style={s.cardDate}>{relativeDate(item.generated_at, lang, t)}</Text>
                      )}
                    </View>
                    <Text style={s.cardContent}>{item.content}</Text>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Dismiss */}
            <TouchableOpacity style={s.dismissBtn} onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={s.dismissText}>{t('walkthrough.gotIt')}</Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.card,
    borderWidth: 1.5,
    borderColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  fabSparkle: {
    fontSize: 20,
    color: T.accent,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  panel: {
    backgroundColor: T.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.cardBorder,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: T.textPrimary,
  },
  headerSub: {
    fontSize: 11,
    color: T.textSecondary,
    marginTop: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#252540',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    color: T.textSecondary,
    fontWeight: '600',
  },

  emptyWrap: {
    padding: 20,
  },
  emptyText: {
    fontSize: 14,
    color: T.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
  },

  insightCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  insightCardBorder: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A4A',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: T.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardDate: {
    fontSize: 10,
    color: T.textSecondary,
  },
  cardContent: {
    fontSize: 14,
    color: T.textPrimary,
    lineHeight: 22,
  },

  dismissBtn: {
    margin: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#252540',
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textSecondary,
  },
});
