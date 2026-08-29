<?php
/**
 * Импорт выгрузки MODX в WordPress из командной строки.
 *
 * Сама логика живёт в теме (inc/importer.php) — этот файл только
 * поднимает WordPress и вызывает её. Так один и тот же код работает
 * и здесь, и на странице «Инструменты → Перенос из MODX», и не
 * расходится на две копии.
 *
 *   php import.php --wp=/путь/к/wordpress --bundle=bundle.json [--dry]
 *
 * Если SSH нет, всё то же самое делается через админку — тогда этот
 * скрипт не нужен вовсе.
 */

$opts = getopt( '', array( 'wp:', 'bundle:', 'dry', 'quiet' ) );
$wp_path     = rtrim( $opts['wp'] ?? '', '/' );
$bundle_path = $opts['bundle'] ?? __DIR__ . '/bundle.json';
$dry         = isset( $opts['dry'] );
$quiet       = isset( $opts['quiet'] );

if ( ! $wp_path || ! is_file( "$wp_path/wp-load.php" ) ) {
	fwrite( STDERR, "Укажите путь к WordPress: --wp=/путь/к/wordpress\n" );
	exit( 1 );
}
if ( ! is_file( $bundle_path ) ) {
	fwrite( STDERR, "Не найден файл выгрузки: $bundle_path\n" );
	exit( 1 );
}

define( 'WP_USE_THEMES', false );
require "$wp_path/wp-load.php";

if ( ! function_exists( 'eco_import_bundle' ) ) {
	fwrite( STDERR, "Тема «ЭкоПарк» не активна — включите её перед импортом.\n" );
	exit( 1 );
}

// Импорт идёт без вошедшего пользователя, поэтому WordPress прогоняет
// содержимое через kses и вырезает из него <script>. На старом сайте
// встроенные скрипты есть, и терять их нельзя.
$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
if ( $admins ) {
	wp_set_current_user( (int) $admins[0] );
} else {
	fwrite( STDERR, "Не найден администратор: встроенные скрипты в тексте страниц будут вырезаны.\n" );
}

$bundle = json_decode( file_get_contents( $bundle_path ), true );
if ( ! is_array( $bundle ) ) {
	fwrite( STDERR, "Выгрузка повреждена.\n" );
	exit( 1 );
}

$result = eco_import_bundle( $bundle, $dry );

if ( ! $quiet ) {
	echo implode( "\n", $result['log'] ), "\n";
	if ( ! empty( $result['notes'] ) ) {
		echo "\nТребует ручной проверки (", count( $result['notes'] ), "):\n";
		foreach ( array_slice( $result['notes'], 0, 30 ) as $note ) {
			echo '  ', $note, "\n";
		}
	}
	echo "\nГотово.\n";
}
