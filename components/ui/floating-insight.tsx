import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { AgentIcon } from '@/components/ui/agent-icon';
import { T } from '@/constants/theme';

interface FloatingInsightProps {
  content: string;
  label?: string;
  generatedAt?: string;
  locked?: boolean;
  onPress?: () => void;
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const [, m, day] = iso.split('T')[0].split('-');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${+day} ${MONTHS[+m - 1]}`;
}

export function FloatingInsight({ content, label, generatedAt, locked, onPress }: FloatingInsightProps) {
  const [open, setOpen] = useState(false);

  const handleFabPress = () => {
    if (locked || !content) return;
    setOpen(true);
  };

  const handleViewAll = () => {
    setOpen(false);
    onPress?.();
  };

  const dateStr = generatedAt ? relativeDate(generatedAt) : 'Today';

  return (
    <>
      {/* Floating action button */}
      <TouchableOpacity
        style={s.fab}
        onPress={handleFabPress}
        activeOpacity={0.85}
      >
        {locked || !content ? (
          <Text style={s.fabLock}>✦</Text>
        ) : (
          <AgentIcon size={26} />
        )}
      </TouchableOpacity>

      {/* Insight modal */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.card} onPress={() => {}}>
            {/* Header */}
            <View style={s.topRow}>
              <View style={s.iconWrap}>
                <AgentIcon size={18} />
              </View>
              <Text style={s.labelText}>{label ?? 'FINANCIAL COACH'}</Text>
              <Text style={s.dateText}>{dateStr}</Text>
            </View>

            {/* Content */}
            <Text style={s.content}>{content}</Text>

            {/* Actions */}
            <View style={s.actions}>
              <TouchableOpacity style={s.dismissBtn} onPress={() => setOpen(false)} activeOpacity={0.7}>
                <Text style={s.dismissText}>Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.viewBtn} onPress={handleViewAll} activeOpacity={0.85}>
                <Text style={s.viewBtnText}>View all insights</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  // Floating button
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1A1A2E',
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
  fabLock: {
    fontSize: 20,
    color: T.accent,
  },

  // Modal backdrop
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 100,
  },

  // Insight card
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderLeftWidth: 3,
    borderLeftColor: T.accent,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(91,91,214,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: T.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  dateText: {
    fontSize: 10,
    color: T.textSecondary,
  },
  content: {
    fontSize: 14,
    color: '#FAFAFA',
    lineHeight: 22,
    marginBottom: 16,
  },

  // Action buttons
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  dismissBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#252540',
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.textSecondary,
  },
  viewBtn: {
    flex: 2,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: T.accent,
    alignItems: 'center',
  },
  viewBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
});
