import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CartProvider } from '../src/state/CartProvider';
import { DatabaseProvider } from '../src/state/DatabaseProvider';
import { ScannerProvider } from '../src/state/ScannerProvider';
import { colors } from '../src/ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <CartProvider>
          <ScannerProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.primary },
                headerTintColor: colors.primaryText,
                headerTitleStyle: { fontWeight: '600' },
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="new"
                options={{ headerShown: false, presentation: 'modal' }}
              />
              <Stack.Screen name="sale/new" options={{ headerShown: false }} />
              <Stack.Screen name="reports/index" options={{ title: 'Отчёты' }} />
              <Stack.Screen name="product/[id]" options={{ title: 'Товар' }} />
              <Stack.Screen name="doc/new" options={{ title: 'Документ' }} />
              <Stack.Screen name="sale/[id]" options={{ title: 'Чек' }} />
              <Stack.Screen
                name="scan"
                options={{ title: 'Сканер', presentation: 'modal' }}
              />
            </Stack>
          </ScannerProvider>
        </CartProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
