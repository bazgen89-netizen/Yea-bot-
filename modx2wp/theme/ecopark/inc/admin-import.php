<?php
/**
 * Страница «Перенос из MODX» в админке.
 *
 * Нужна там, где нет SSH: всё делается через обычный вход администратора —
 * загрузили bundle.json, нажали кнопку. Картинки качаются порциями,
 * иначе запрос упрётся в лимит времени на любом хостинге.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const ECO_IMPORT_BUNDLE = 'eco_import_bundle_path';
const ECO_IMPORT_MEDIA  = 'eco_import_media_state';

add_action( 'admin_menu', 'eco_import_menu' );
function eco_import_menu() {
	add_management_page( 'Перенос из MODX', 'Перенос из MODX', 'manage_options', 'eco-import', 'eco_import_page' );
}

/** Путь к загруженной выгрузке. */
function eco_import_bundle_path() {
	$path = get_option( ECO_IMPORT_BUNDLE );
	return ( $path && file_exists( $path ) ) ? $path : '';
}

function eco_import_read_bundle() {
	$path = eco_import_bundle_path();
	if ( ! $path ) {
		return null;
	}
	$data = json_decode( file_get_contents( $path ), true );
	return is_array( $data ) ? $data : null;
}

/** Куда класть выгрузку: рядом с загрузками, вне доступа из браузера. */
function eco_import_dir() {
	$uploads = wp_upload_dir();
	$dir     = trailingslashit( $uploads['basedir'] ) . 'eco-import';
	wp_mkdir_p( $dir );
	// Файл выгрузки не должен быть доступен снаружи.
	if ( ! file_exists( $dir . '/.htaccess' ) ) {
		file_put_contents( $dir . '/.htaccess', "Deny from all\n" );
	}
	if ( ! file_exists( $dir . '/index.php' ) ) {
		file_put_contents( $dir . '/index.php', "<?php\n// Тишина.\n" );
	}
	return $dir;
}

/* ------------------------------------------------------------------ *
 * Обработка действий
 * ------------------------------------------------------------------ */

add_action( 'admin_post_eco_import_upload', 'eco_import_handle_upload' );
function eco_import_handle_upload() {
	check_admin_referer( 'eco_import' );
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Недостаточно прав.' );
	}

	$file = $_FILES['bundle'] ?? null;
	if ( ! $file || UPLOAD_ERR_OK !== $file['error'] ) {
		eco_import_redirect( 'Файл не загрузился.' );
	}

	$raw = file_get_contents( $file['tmp_name'] );
	$data = json_decode( $raw, true );
	if ( ! is_array( $data ) || empty( $data['pages'] ) ) {
		eco_import_redirect( 'Это не похоже на выгрузку: в файле нет страниц.' );
	}

	$path = eco_import_dir() . '/bundle.json';
	file_put_contents( $path, $raw );
	update_option( ECO_IMPORT_BUNDLE, $path, false );
	delete_option( ECO_IMPORT_MEDIA );

	eco_import_redirect( sprintf( 'Выгрузка загружена: %d страниц, %d медиафайлов.',
		count( $data['pages'] ), count( $data['media'] ?? array() ) ) );
}

add_action( 'admin_post_eco_import_run', 'eco_import_handle_run' );
function eco_import_handle_run() {
	check_admin_referer( 'eco_import' );
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Недостаточно прав.' );
	}

	$bundle = eco_import_read_bundle();
	if ( ! $bundle ) {
		eco_import_redirect( 'Сначала загрузите файл выгрузки.' );
	}

	$dry    = ! empty( $_POST['dry'] );
	$result = eco_import_bundle( $bundle, $dry );

	set_transient( 'eco_import_report', $result, HOUR_IN_SECONDS );
	eco_import_redirect( $dry ? 'Проверочный запуск завершён.' : 'Перенос выполнен.' );
}

function eco_import_redirect( $message ) {
	wp_safe_redirect( add_query_arg(
		array( 'page' => 'eco-import', 'eco_msg' => rawurlencode( $message ) ),
		admin_url( 'tools.php' )
	) );
	exit;
}

/** Порция картинок — вызывается со страницы по очереди. */
add_action( 'wp_ajax_eco_import_media', 'eco_import_ajax_media' );
function eco_import_ajax_media() {
	check_ajax_referer( 'eco_import_media' );
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_send_json_error( 'Недостаточно прав.' );
	}

	$bundle = eco_import_read_bundle();
	if ( ! $bundle ) {
		wp_send_json_error( 'Нет загруженной выгрузки.' );
	}

	$files  = $bundle['media'] ?? array();
	$offset = max( 0, (int) ( $_POST['offset'] ?? 0 ) );
	$base   = esc_url_raw( wp_unslash( $_POST['base'] ?? '' ) );
	if ( ! $base ) {
		wp_send_json_error( 'Не указан адрес старого сайта.' );
	}

	$batch = eco_import_media_batch( $files, $base, $offset );

	$state = get_option( ECO_IMPORT_MEDIA, array( 'ok' => 0, 'missing' => array(), 'failed' => array() ) );
	if ( 0 === $offset ) {
		$state = array( 'ok' => 0, 'missing' => array(), 'failed' => array() );
	}
	$state['ok']     += count( $batch['ok'] );
	$state['missing'] = array_slice( array_merge( $state['missing'], $batch['missing'] ), 0, 200 );
	$state['failed']  = array_slice( array_merge( $state['failed'], $batch['failed'] ), 0, 200 );
	update_option( ECO_IMPORT_MEDIA, $state, false );

	wp_send_json_success( array(
		'done'    => $batch['done'],
		'total'   => $batch['total'],
		'ok'      => $state['ok'],
		'missing' => count( $state['missing'] ),
		'failed'  => count( $state['failed'] ),
	) );
}

/* ------------------------------------------------------------------ *
 * Сама страница
 * ------------------------------------------------------------------ */

function eco_import_page() {
	$bundle  = eco_import_read_bundle();
	$report  = get_transient( 'eco_import_report' );
	$state   = get_option( ECO_IMPORT_MEDIA, array() );
	$message = isset( $_GET['eco_msg'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['eco_msg'] ) ) ) : '';
	?>
	<div class="wrap">
		<h1>Перенос из MODX</h1>

		<?php if ( $message ) : ?>
			<div class="notice notice-info"><p><?php echo esc_html( $message ); ?></p></div>
		<?php endif; ?>

		<?php if ( ! get_option( 'permalink_structure' ) ) : ?>
			<div class="notice notice-error"><p>
				Сначала включите постоянные ссылки:
				<a href="<?php echo esc_url( admin_url( 'options-permalink.php' ) ); ?>">Настройки → Постоянные ссылки</a>.
				Без них адреса страниц работать не будут.
			</p></div>
		<?php endif; ?>

		<h2>1. Файл выгрузки</h2>
		<?php if ( $bundle ) : ?>
			<p>
				Загружен: <strong><?php echo count( $bundle['pages'] ); ?></strong> страниц,
				<strong><?php echo count( $bundle['blocks'] ?? array() ); ?></strong> блоков,
				<strong><?php echo count( $bundle['menus'] ?? array() ); ?></strong> меню,
				<strong><?php echo count( $bundle['media'] ?? array() ); ?></strong> медиафайлов.
			</p>
		<?php else : ?>
			<p>Загрузите <code>bundle.json</code> — файл, собранный скриптом <code>build_bundle.py</code>.</p>
		<?php endif; ?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
			<?php wp_nonce_field( 'eco_import' ); ?>
			<input type="hidden" name="action" value="eco_import_upload">
			<input type="file" name="bundle" accept=".json,application/json" required>
			<?php submit_button( $bundle ? 'Заменить файл' : 'Загрузить', 'secondary', 'submit', false ); ?>
		</form>

		<?php if ( $bundle ) : ?>
			<h2>2. Страницы, поля и меню</h2>
			<p>Повторный запуск обновляет уже перенесённые страницы, а не создаёт дубли.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'eco_import' ); ?>
				<input type="hidden" name="action" value="eco_import_run">
				<p>
					<label><input type="checkbox" name="dry" value="1"> только показать, ничего не записывать</label>
				</p>
				<?php submit_button( 'Перенести содержимое', 'primary', 'submit', false ); ?>
			</form>

			<h2>3. Картинки</h2>
			<p>
				Файлы качаются со старого сайта и ложатся по прежним путям, поэтому
				адреса картинок не меняются. Идут порциями — вкладку не закрывайте.
			</p>
			<p>
				<label>Адрес старого сайта:
					<input type="url" id="eco-media-base" class="regular-text" value="https://ecopark33.ru/">
				</label>
			</p>
			<p>
				<button class="button button-primary" id="eco-media-start">Перенести картинки</button>
				<span id="eco-media-status" style="margin-left:10px"></span>
			</p>
			<?php if ( ! empty( $state['ok'] ) ) : ?>
				<p class="description">
					Прошлый запуск: перенесено <?php echo (int) $state['ok']; ?>,
					нет на старом сайте — <?php echo count( $state['missing'] ); ?>,
					не удалось — <?php echo count( $state['failed'] ); ?>.
				</p>
			<?php endif; ?>

			<script>
			( function () {
				const btn = document.getElementById( 'eco-media-start' );
				const out = document.getElementById( 'eco-media-status' );
				if ( ! btn ) { return; }
				btn.addEventListener( 'click', async function ( e ) {
					e.preventDefault();
					btn.disabled = true;
					const base = document.getElementById( 'eco-media-base' ).value;
					let offset = 0, total = null;
					try {
						do {
							const body = new URLSearchParams( {
								action: 'eco_import_media',
								_ajax_nonce: '<?php echo esc_js( wp_create_nonce( 'eco_import_media' ) ); ?>',
								offset: offset,
								base: base
							} );
							const res = await fetch( ajaxurl, { method: 'POST', body: body, credentials: 'same-origin' } );
							const json = await res.json();
							if ( ! json.success ) { throw new Error( json.data || 'ошибка' ); }
							offset = json.data.done;
							total = json.data.total;
							out.textContent = `перенесено ${json.data.ok} из ${total}` +
								( json.data.missing ? `, нет на старом сайте: ${json.data.missing}` : '' ) +
								( json.data.failed ? `, ошибок: ${json.data.failed}` : '' );
						} while ( offset < total );
						out.textContent += ' — готово';
					} catch ( err ) {
						out.textContent = 'Прервано: ' + err.message + '. Нажмите ещё раз — продолжит с этого места.';
					}
					btn.disabled = false;
				} );
			}() );
			</script>
		<?php endif; ?>

		<?php if ( $report ) : ?>
			<h2>Отчёт</h2>
			<pre style="background:#fff;border:1px solid #dcdcde;padding:12px;max-height:320px;overflow:auto"><?php
				echo esc_html( implode( "\n", $report['log'] ) );
				if ( ! empty( $report['notes'] ) ) {
					echo "\n\nТребует ручной проверки (" . count( $report['notes'] ) . "):\n";
					echo esc_html( implode( "\n", array_slice( $report['notes'], 0, 40 ) ) );
				}
			?></pre>
		<?php endif; ?>
	</div>
	<?php
}
