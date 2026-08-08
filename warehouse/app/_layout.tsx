import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CartProvider } from '../src/state/CartProvider';
import { DatabaseProvider } from '../src/state/DatabaseProvider';
import { ScannerProvider } from '../src/state/ScannerProvider';
import { colors } from '../src/ui/theme';
import { useDesktop } from '../src/ui/useDesktop';
import { Shell } from '../src/web/Shell';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <CartProvider>
          <ScannerProvider>
            <StatusBar style="light" />
            <Shell>
              <Screens />
            </Shell>
          </ScannerProvider>
        </CartProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}

function Screens() {
  // В кабинете шапку рисует сам кабинет. Системная полоса поверх неё была бы
  // вторым заголовком одного и того же экрана.
  const desktop = useDesktop();
  const title = (name: string) => (desktop ? { headerShown: false } : { title: name });

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.primaryText,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
        headerShown: !desktop,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="sale/new" options={{ headerShown: false }} />
      <Stack.Screen name="cashier" options={{ headerShown: false }} />
      <Stack.Screen name="counterparties" options={{ headerShown: false }} />
      <Stack.Screen name="reports/index" options={title('Отчёты')} />
      <Stack.Screen name="product/[id]" options={title('Товар')} />
      <Stack.Screen name="doc/new" options={title('Документ')} />
      <Stack.Screen name="money/new" options={title('Деньги')} />
      <Stack.Screen name="counterparty/[id]" options={title('Карточка')} />
      <Stack.Screen name="sale/[id]" options={title('Чек')} />
      <Stack.Screen
        name="scan"
        options={desktop ? { headerShown: false } : { title: 'Сканер', presentation: 'modal' }}
      />
    </Stack>
  );
}
