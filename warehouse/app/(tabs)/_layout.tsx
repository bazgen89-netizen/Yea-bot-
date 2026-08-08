import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../src/ui/icons';
import { colors, radius, shadow, spacing } from '../../src/ui/theme';
import { useDesktop } from '../../src/ui/useDesktop';

/**
 * Круглая кнопка создания в центре нижней панели. Это не вкладка: она не
 * открывает экран, а поднимает шторку с выбором документа, поэтому вкладка
 * под ней сделана заглушкой, а нажатие перехвачено.
 */
function CreateButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Создать"
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
    >
      <Icon.plus color="#FFFFFF" size={32} />
    </Pressable>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  // В кабинете разделы открываются боковым меню — нижняя панель там лишняя.
  const desktop = useDesktop();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: desktop ? { display: 'none' } : styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Главная',
          tabBarIcon: ({ color, focused }) => (
            <Icon.home color={color} filled={focused} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="catalog"
        options={{
          title: 'Каталог',
          tabBarIcon: ({ color, focused }) => (
            <Icon.catalog color={color} filled={focused} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={styles.fabSlot}>
              <CreateButton onPress={() => router.push('/new')} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Журнал',
          tabBarIcon: ({ color }) => <Icon.journal color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Меню',
          tabBarIcon: ({ color }) => <Icon.menu color={color} size={26} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 0,
    height: 84,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow,
  },
  item: { paddingVertical: spacing.xs },
  label: { fontSize: 11, marginTop: 2 },
  fabSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.fab,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
  },
});
