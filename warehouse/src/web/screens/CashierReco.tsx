import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCashierKeys } from './useCashierKeys';
import {
  createRecoList,
  deleteRecoList,
  listRecoLists,
  moveRecoList,
  updateRecoList,
  type RecoList,
} from '../../db/recommendations';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { pos } from '../../ui/webTheme';

/**
 * «Настройки рекомендаций» — окно кассы, шестерёнка в строке «Рекомендации».
 *
 * Устройство его: заголовок с «ЗАКРЫТЬ ⌐ESC¬», серая полоса «Ваши списки»,
 * сами списки — уголок для перетаскивания, название, оранжевый переключатель,
 * под названием поле «Количество товаров … ШТ», — и во всю ширину внизу
 * оранжевая «СОЗДАТЬ НОВЫЙ СПИСОК» с ⌐ENTER¬.
 *
 * Каждый список — правило подбора к набранному чеку; что оно делает, описано
 * в `src/db/recommendations.ts`.
 */
export function CashierReco({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { db, refresh } = useDatabase();
  const lists = useQuery((database) => listRecoLists(database));

  function add(): void {
    createRecoList(db, `Список ${lists.length + 1}`);
    refresh();
  }

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть настройки рекомендаций"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Настройки рекомендаций</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Ваши списки</Text>
          </View>

          <ScrollView style={styles.body}>
            {lists.map((list, index) => (
              <ListRow
                key={list.id}
                list={list}
                first={index === 0}
                last={index === lists.length - 1}
                onChange={(patch) => {
                  updateRecoList(db, list.id, patch);
                  refresh();
                }}
                onMove={(direction) => {
                  moveRecoList(db, list.id, direction);
                  refresh();
                }}
                onDelete={() => {
                  deleteRecoList(db, list.id);
                  refresh();
                }}
              />
            ))}

            {lists.length === 0 ? (
              <Text style={styles.empty}>
                Списков нет. Создайте — и над чеком появятся подсказки, что предложить.
              </Text>
            ) : null}
          </ScrollView>

          <Pressable accessibilityRole="button" onPress={add} style={styles.create}>
            <Text style={styles.createLabel}>СОЗДАТЬ НОВЫЙ СПИСОК</Text>
            <View style={styles.createKey}>
              <Text style={styles.createKeyLabel}>ENTER</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ListRow({
  list,
  first,
  last,
  onChange,
  onMove,
  onDelete,
}: {
  list: RecoList;
  first: boolean;
  last: boolean;
  onChange: (patch: { name?: string; enabled?: boolean; size?: number }) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [size, setSize] = useState(String(list.size));
  const [name, setName] = useState(list.name);

  useEffect(() => setSize(String(list.size)), [list.size]);
  useEffect(() => setName(list.name), [list.name]);

  const on = Boolean(list.enabled);
  const slide = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: on ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [on, slide]);

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        {/* Уголок для перетаскивания. Списки двигаются по одному вверх и
            вниз: порядок задаёт, кто из них займёт место первым. */}
        <View style={styles.grip}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Поднять список «${list.name}»`}
            accessibilityState={{ disabled: first }}
            onPress={() => !first && onMove(-1)}
            style={styles.gripHalf}
          >
            <Text style={[styles.gripDots, first && styles.gripOff]}>⠿</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Опустить список «${list.name}»`}
            accessibilityState={{ disabled: last }}
            onPress={() => !last && onMove(1)}
            style={styles.gripHalf}
          >
            <Text style={[styles.gripDots, last && styles.gripOff]}>⠿</Text>
          </Pressable>
        </View>

        {/* Название «Покупают вместе» правится: список свой, и назвать его
            можно так, как его называют в лавке. */}
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => onChange({ name })}
          accessibilityLabel={`Название списка «${list.name}»`}
          style={styles.name}
        />

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: on }}
          accessibilityLabel={`Список «${list.name}»`}
          onPress={() => onChange({ enabled: !on })}
          style={styles.switchTap}
        >
          <Animated.View
            style={[
              styles.track,
              {
                backgroundColor: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['rgba(0,0,0,0.10)', '#FBE3CD'],
                }),
              },
            ]}
          >
            <Animated.View
              style={[
                styles.knob,
                {
                  backgroundColor: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['#FFFFFF', pos.accent],
                  }),
                  transform: [
                    { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 26] }) },
                  ],
                },
              ]}
            />
          </Animated.View>
        </Pressable>
      </View>

      {/* Поле в рамке с подписью, врезанной в верхнюю грань, — его форма. */}
      <View style={styles.field}>
        <View style={styles.fieldLabelBox}>
          <Text style={styles.fieldLabel}>Количество товаров</Text>
        </View>
        <TextInput
          value={size}
          onChangeText={setSize}
          onBlur={() => onChange({ size: Number(size) || list.size })}
          keyboardType="number-pad"
          accessibilityLabel={`Количество товаров в списке «${list.name}»`}
          style={styles.fieldInput}
        />
        <Text style={styles.fieldUnit}>ШТ</Text>
      </View>

      {/* «Покупают вместе» — список, считаемый по чекам; удалять его незачем,
          и у него удаления нет. Свои списки убираются. */}
      {list.kind === 'manual' ? (
        <Pressable accessibilityRole="button" onPress={onDelete} style={styles.delete}>
          <Text style={styles.deleteLabel}>Удалить список</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: 620,
    maxWidth: '94%',
    maxHeight: '86%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  title: { fontFamily: pos.font, fontSize: 24, color: pos.text },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeLabel: { fontFamily: pos.font, fontSize: 15, color: pos.muted, letterSpacing: 0.6 },
  key: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted },

  // Серая полоса-подзаголовок, как у него.
  section: { backgroundColor: pos.bg, paddingHorizontal: 26, paddingVertical: 14 },
  sectionLabel: { fontFamily: pos.font, fontSize: 17, color: pos.muted },

  body: { flexGrow: 0 },
  row: { paddingHorizontal: 26, paddingTop: 18, paddingBottom: 20 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  grip: { width: 16, gap: 2 },
  gripHalf: { alignItems: 'center' },
  gripDots: { fontFamily: pos.font, fontSize: 13, color: pos.muted, lineHeight: 13 },
  gripOff: { opacity: 0.25 },

  name: {
    flex: 1,
    fontFamily: pos.font,
    fontSize: 26,
    color: pos.text,
    outlineWidth: 0,
  },

  switchTap: { padding: 6 },
  track: { width: 62, height: 32, borderRadius: 16, padding: 3, justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 13 },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 260,
    height: 62,
    marginTop: 22,
    marginLeft: 32,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
  },
  // Подпись врезана в верхнюю грань рамки — потому и белая подложка.
  fieldLabelBox: {
    position: 'absolute',
    top: -8,
    left: 12,
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
  },
  fieldLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: pos.font,
    fontSize: 24,
    color: pos.text,
    outlineWidth: 0,
  },
  fieldUnit: { fontFamily: pos.font, fontSize: 15, color: pos.muted, letterSpacing: 0.6 },

  delete: { marginTop: 14, marginLeft: 32 },
  deleteLabel: { fontFamily: pos.font, fontSize: 14, color: pos.red },

  empty: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.muted,
    padding: 30,
    textAlign: 'center',
    lineHeight: 22,
  },

  create: {
    height: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: pos.accent,
  },
  createLabel: { fontFamily: pos.font, fontSize: 19, color: '#FFFFFF', letterSpacing: 0.8 },
  createKey: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  createKeyLabel: { fontFamily: pos.font, fontSize: 12, color: '#FFFFFF' },
});
