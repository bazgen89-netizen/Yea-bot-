import { BarcodeType, CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useScanner } from '../src/state/ScannerProvider';
import { Button } from '../src/ui/components';
import { colors, spacing, text } from '../src/ui/theme';

/** Коды, которые встречаются на товарах в рознице. */
const BARCODE_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'itf14',
  'qr',
];

export default function ScanScreen() {
  const router = useRouter();
  const { resolveScan } = useScanner();
  const [permission, requestPermission] = useCameraPermissions();

  // Камера присылает кадры пачками — без этого один штрихкод сработает много раз.
  const handled = useRef(false);
  // Закрытие свайпом тоже должно завершить ожидание вызывающего экрана.
  const answered = useRef(false);

  const finish = useCallback(
    (code: string | null) => {
      if (answered.current) return;
      answered.current = true;
      resolveScan(code);
    },
    [resolveScan],
  );

  useEffect(() => () => finish(null), [finish]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={text.heading}>Нужен доступ к камере</Text>
        <Text style={[text.muted, styles.message]}>
          Без камеры не получится считывать штрихкоды. Доступ используется только для сканирования.
        </Text>
        <Button title="Разрешить" onPress={requestPermission} />
        <Button title="Назад" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          handled.current = true;
          finish(data);
          router.back();
        }}
      />

      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Наведите камеру на штрихкод</Text>
      </View>

      <View style={styles.footer}>
        <Button
          title="Отмена"
          variant="secondary"
          onPress={() => {
            finish(null);
            router.back();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  message: { textAlign: 'center' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: '78%',
    aspectRatio: 1.6,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 16,
  },
  hint: { color: '#FFFFFF', marginTop: spacing.lg, fontSize: 15 },
  footer: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl },
});
