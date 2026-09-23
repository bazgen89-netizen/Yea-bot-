import { useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ГРУППЫ, reportById } from '../db/reportTypes';
import { colors, spacing } from './theme';

/**
 * «Все отчёты» — всплывающее окно снизу, как у него на телефоне.
 *
 * До этого кнопка с главной открывала нашу собственную сводку: период,
 * выручка, пятёрка товаров, остатки. Экран неплохой, но у него на этом
 * месте не он — у него список всех отчётов, разбитый на четыре группы, и
 * ищут в нём отчёт, а не смотрят числа.
 *
 * Группы и порядок берутся из реестра отчётов, а не переписаны сюда: этот
 * же список нужен и плиткам кабинета, и разъехаться им ничего не мешало бы.
 */
export function ОкноОтчётов({ открыто, закрыть }: { открыто: boolean; закрыть: () => void }) {
  const router = useRouter();

  return (
    <Modal visible={открыто} transparent animationType="slide" onRequestClose={закрыть}>
      <Pressable style={стиль.тень} onPress={закрыть}>
        <Pressable style={стиль.лист} onPress={() => {}}>
          <View style={стиль.ручка} />
          <Text style={стиль.заголовок}>Все отчёты</Text>

          <ScrollView>
            {ГРУППЫ.map((группа) => {
              // Отчёт, которого в реестре нет, молча пропускаем: мёртвая
              // строка хуже отсутствующей — по ней нажмут.
              const есть = группа.отчёты
                .map((имя) => reportById(имя))
                .filter((отчёт): отчёт is NonNullable<typeof отчёт> => отчёт !== null);

              if (!есть.length) return null;

              return (
                <View key={группа.имя}>
                  <Text style={стиль.группа}>{группа.имя}</Text>
                  {есть.map((отчёт) => (
                    <Pressable
                      key={отчёт.id}
                      accessibilityRole="button"
                      style={стиль.строка}
                      onPress={() => {
                        закрыть();
                        router.push({
                          pathname: '/reports/[type]',
                          params: { type: отчёт.id },
                        });
                      }}
                    >
                      <Text style={стиль.имя}>{отчёт.phoneTitle ?? отчёт.title}</Text>
                      <Text style={стиль.стрелка}>›</Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const стиль = StyleSheet.create({
  тень: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  лист: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '88%',
    paddingBottom: spacing.md,
  },
  ручка: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 10,
  },
  заголовок: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  группа: {
    fontSize: 15,
    color: colors.textMuted,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  строка: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  имя: { flex: 1, fontSize: 18, color: colors.text },
  стрелка: { fontSize: 26, color: colors.textMuted },
});
