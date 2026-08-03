import { Tabs } from 'expo-router';
import { ColorValue, Text } from 'react-native';

import { useCart } from '../../src/state/CartProvider';
import { colors } from '../../src/ui/theme';

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { lines } = useCart();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Товары',
          tabBarIcon: ({ color }) => <TabIcon symbol="📦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sell"
        options={{
          title: 'Касса',
          tabBarIcon: ({ color }) => <TabIcon symbol="🧾" color={color} />,
          // Счётчик позиций в корзине — видно, что чек не пустой, с любой вкладки.
          tabBarBadge: lines.length > 0 ? lines.length : undefined,
        }}
      />
      <Tabs.Screen
        name="docs"
        options={{
          title: 'Документы',
          tabBarIcon: ({ color }) => <TabIcon symbol="📥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Отчёты',
          tabBarIcon: ({ color }) => <TabIcon symbol="📊" color={color} />,
        }}
      />
    </Tabs>
  );
}
