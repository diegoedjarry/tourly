import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Modal, TextInput,
} from 'react-native';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseIso(str: string | undefined): Date {
  if (str && /^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplay(iso: string): string {
  const d = parseIso(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  label?: string;
  value: string;        // YYYY-MM-DD, or '' for unset
  onChange: (iso: string) => void;
  optional?: boolean;   // show "optional" hint next to label
  placeholder?: string;
}

export function DatePickerField({ label, value, onChange, optional, placeholder }: Props) {
  const [show, setShow] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() => parseIso(value));

  const display = value ? formatDisplay(value) : '';

  function openPicker() {
    setTempDate(parseIso(value));
    setShow(true);
  }

  if (Platform.OS === 'web') {
    return (
      <View style={s.field}>
        <View style={s.labelRow}>
          <Text style={s.label}>{label}</Text>
          {optional && <Text style={s.optionalHint}>optional</Text>}
        </View>
        <View style={s.input}>
          <TextInput
            style={[s.valueText, { flex: 1, outlineStyle: 'none' } as any]}
            value={value}
            onChangeText={(text) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(text)) onChange(text);
              else onChange(text);
            }}
            placeholder={placeholder || 'YYYY-MM-DD'}
            placeholderTextColor="#BBBBBB"
          />
          <input
            type="date"
            value={value}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
            }}
            style={{
              position: 'absolute',
              right: 10,
              top: 0,
              bottom: 0,
              width: 30,
              opacity: 0,
              cursor: 'pointer',
            }}
          />
          <Text style={s.icon}>📅</Text>
        </View>
      </View>
    );
  }

  const DateTimePicker = require('@react-native-community/datetimepicker').default;

  function handleAndroidChange(event: any, date?: Date) {
    setShow(false);
    if (event.type === 'set' && date) onChange(toIso(date));
  }

  function handleIosChange(_event: any, date?: Date) {
    if (date) setTempDate(date);
  }

  function handleDone() {
    setShow(false);
    onChange(toIso(tempDate));
  }

  function handleClear() {
    setShow(false);
    onChange('');
  }

  return (
    <View style={s.field}>
      <View style={s.labelRow}>
        <Text style={s.label}>{label}</Text>
        {optional && <Text style={s.optionalHint}>optional</Text>}
      </View>

      <TouchableOpacity style={s.input} onPress={openPicker} activeOpacity={0.7}>
        <Text style={display ? s.valueText : s.placeholder}>
          {display || placeholder || 'Select date'}
        </Text>
        <Text style={s.icon}>📅</Text>
      </TouchableOpacity>

      {Platform.OS === 'android' && show && (
        <DateTimePicker
          mode="date"
          display="default"
          value={tempDate}
          onChange={handleAndroidChange}
          accentColor="#00D4AA"
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          transparent
          visible={show}
          animationType="slide"
          onRequestClose={() => setShow(false)}>
          <View style={s.overlay}>
            <TouchableOpacity style={s.overlayBackdrop} onPress={() => setShow(false)} activeOpacity={1} />
            <View style={s.sheet}>
              <View style={s.sheetHeader}>
                <TouchableOpacity onPress={handleClear} activeOpacity={0.7}>
                  <Text style={s.clearText}>{value ? 'Clear' : 'Cancel'}</Text>
                </TouchableOpacity>
                <Text style={s.sheetTitle}>{label}</Text>
                <TouchableOpacity onPress={handleDone} activeOpacity={0.7}>
                  <Text style={s.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                mode="date"
                display="inline"
                value={tempDate}
                onChange={handleIosChange}
                accentColor="#00D4AA"
                style={s.picker}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  field: { marginBottom: 18 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label: {
    fontSize: 12, fontWeight: '600', color: '#AAAAAA',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  optionalHint: { fontSize: 11, color: '#CCCCCC', marginLeft: 6 },

  input: {
    backgroundColor: '#F4F4F8', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  valueText: { fontSize: 15, color: '#2D2B55', fontWeight: '500' },
  placeholder: { fontSize: 15, color: '#BBBBBB' },
  icon: { fontSize: 16 },

  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 34,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 22, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  sheetTitle: { fontSize: 16, fontWeight: '600', color: '#2D2B55' },
  clearText: { fontSize: 15, color: '#AAAAAA' },
  doneText: { fontSize: 15, fontWeight: '700', color: '#00D4AA' },
  picker: { alignSelf: 'stretch' },
});
