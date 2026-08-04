import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing } from '../../src/ui/theme';

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return <Text style={[styles.icon, focused && styles.iconActive]}>{symbol}</Text>;
}

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
      <Text style={styles.fabPlus}>+</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Главная',
          tabBarIcon: ({ focused }) => <TabIcon symbol="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="catalog"
        options={{
          title: 'Каталог',
          tabBarIcon: ({ focused }) => <TabIcon symbol="🗄️" focused={focused} />,
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
          tabBarIcon: ({ focused }) => <TabIcon symbol="📄" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Меню',
          tabBarIcon: ({ focused }) => <TabIcon symbol="☰" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 0,
    height: 88,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow,
  },
  label: { fontSize: 11, marginTop: 2 },
  icon: { fontSize: 22, opacity: 0.55 },
  iconActive: { opacity: 1 },
  fabSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.fab,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
  },
  fabPlus: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '500' },
});
