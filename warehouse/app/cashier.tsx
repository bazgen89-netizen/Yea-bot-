import { Stack } from 'expo-router';

import { Cashier } from '../src/web/screens/Cashier';

export default function CashierScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Cashier />
    </>
  );
}
