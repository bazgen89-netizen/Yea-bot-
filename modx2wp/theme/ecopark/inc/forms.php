<?php
/**
 * Обработчик форм.
 *
 * В MODX формы уходили POST-запросом на /req.html и ждали JSON вида
 * {"r":true}. Тело запроса — одно поле, названное по типу запроса:
 *   msend=<json>     — форма «Консультация»
 *   msendtel=<json>  — форма с телефоном
 *   subscribe=<json> — подписка
 *
 * Тема отвечает по тому же адресу и в том же формате, поэтому
 * assets/js/script.js остался нетронутым — так меньше риск сломать
 * поведение попапов, завязанное на этот код.
 *
 * Nonce здесь нет намеренно: его нечем передать, не переписав фронтовый
 * скрипт. Защита — скрытое поле-ловушка realaddr (как в оригинале)
 * плюс ограничение частоты по IP.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'parse_request', 'eco_handle_form_request', 1 );
function eco_handle_form_request( $wp ) {
	if ( is_admin() || 'req.html' !== eco_request_path() ) {
		return;
	}
	if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
		return;
	}

	// Лента публикаций для страницы /publication/ (AJAX «Показать больше»).
	// Ответ иного вида, чем у форм: { r: [ {l,i,t}, ... ], cnt: всего }.
	if ( isset( $_POST['events'] ) ) {
		eco_events_feed();
	}

	$handlers = array(
		'msend'     => 'eco_form_message',
		'msendtel'  => 'eco_form_callback',
		'subscribe' => 'eco_form_subscribe',
	);

	foreach ( $handlers as $key => $handler ) {
		if ( ! isset( $_POST[ $key ] ) ) {
			continue;
		}
		$data = json_decode( wp_unslash( $_POST[ $key ] ), true );
		if ( ! is_array( $data ) ) {
			eco_form_reply( false );
		}

		// Ловушка для ботов: поле скрыто, человек его не заполнит.
		if ( ! empty( $data['ra'] ) ) {
			eco_form_reply( true ); // молча принимаем и никуда не отправляем
		}
		if ( ! eco_form_rate_ok() ) {
			eco_form_reply( false );
		}

		eco_form_reply( call_user_func( $handler, $data ) );
	}

	eco_form_reply( false );
}

function eco_form_reply( $ok ) {
	wp_send_json( array( 'r' => (bool) $ok ) );
}

/** Не больше 5 отправок с одного адреса за 10 минут. */
function eco_form_rate_ok() {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'eco_form_' . md5( $ip );
	$hits = (int) get_transient( $key );
	if ( $hits >= 5 ) {
		return false;
	}
	set_transient( $key, $hits + 1, 10 * MINUTE_IN_SECONDS );
	return true;
}

function eco_form_message( array $data ) {
	$name  = sanitize_text_field( $data['f'] ?? '' );
	$email = sanitize_email( $data['a'] ?? '' );
	if ( '' === $name || ! is_email( $email ) ) {
		return false;
	}
	return eco_form_send(
		'Сообщение с сайта',
		array(
			'Имя'       => $name,
			'E-mail'    => $email,
			'Сообщение' => sanitize_textarea_field( $data['m'] ?? '' ),
			'Действие'  => sanitize_text_field( $data['ac'] ?? '' ),
			'Детали'    => sanitize_text_field( $data['d'] ?? '' ),
		),
		$email
	);
}

function eco_form_callback( array $data ) {
	$name  = sanitize_text_field( $data['f'] ?? '' );
	$phone = sanitize_text_field( $data['t'] ?? '' );
	if ( '' === $name || '' === $phone ) {
		return false;
	}
	return eco_form_send(
		'Заявка на звонок с сайта',
		array(
			'Имя'       => $name,
			'Телефон'   => $phone,
			'Сообщение' => sanitize_textarea_field( $data['m'] ?? '' ),
			'Действие'  => sanitize_text_field( $data['ac'] ?? '' ),
			'Детали'    => sanitize_text_field( $data['d'] ?? '' ),
		)
	);
}

function eco_form_subscribe( array $data ) {
	$name  = sanitize_text_field( $data['f'] ?? '' );
	$email = sanitize_email( $data['a'] ?? '' );
	if ( ! is_email( $email ) ) {
		return false;
	}
	return eco_form_send( 'Подписка на рассылку', array( 'Имя' => $name, 'E-mail' => $email ), $email );
}

function eco_form_send( $subject, array $fields, $reply_to = '' ) {
	$lines = array();
	foreach ( $fields as $label => $value ) {
		if ( '' !== $value ) {
			$lines[] = $label . ': ' . $value;
		}
	}
	$lines[] = '';
	$lines[] = 'Страница: ' . esc_url_raw( wp_get_referer() ?: home_url( '/' ) );

	$headers = array( 'Content-Type: text/plain; charset=UTF-8' );
	if ( $reply_to && is_email( $reply_to ) ) {
		$headers[] = 'Reply-To: ' . $reply_to;
	}

	// Сначала запись в базу: почта на хостингах отваливается регулярно,
	// а заявка терять нельзя. Она же определяет ответ посетителю —
	// «спасибо» показываем за сохранённую заявку, а не за отправленное письмо.
	$lead_id = wp_insert_post( array(
		'post_type'    => 'eco_lead',
		'post_status'  => 'private',
		'post_title'   => $subject . ' — ' . ( $fields['Имя'] ?? '' ) . ' — ' . current_time( 'd.m.Y H:i' ),
		'post_content' => implode( "\n", $lines ),
	) );

	if ( is_wp_error( $lead_id ) || ! $lead_id ) {
		return false;
	}

	$to   = eco_contact( 'form_to' ) ?: get_option( 'admin_email' );
	$sent = wp_mail( $to, $subject . ' — ' . get_bloginfo( 'name' ), implode( "\n", $lines ), $headers );

	// Видно в списке заявок: письмо ушло или только сохранилось.
	update_post_meta( $lead_id, '_eco_mailed', $sent ? '1' : '0' );

	return true;
}

/** Колонка «Письмо» в списке заявок — чтобы молчащая почта была заметна. */
add_filter( 'manage_eco_lead_posts_columns', function ( $columns ) {
	$columns['eco_mailed'] = 'Письмо';
	return $columns;
} );

add_action( 'manage_eco_lead_posts_custom_column', function ( $column, $post_id ) {
	if ( 'eco_mailed' !== $column ) {
		return;
	}
	echo '1' === get_post_meta( $post_id, '_eco_mailed', true ) ? 'отправлено' : '<strong style="color:#b32d2e">не ушло</strong>';
}, 10, 2 );

/** Заявки хранятся как записи, чтобы не зависеть от доставки почты. */
add_action( 'init', 'eco_register_leads' );
function eco_register_leads() {
	register_post_type( 'eco_lead', array(
		'labels'          => array( 'name' => 'Заявки', 'singular_name' => 'Заявка' ),
		'public'          => false,
		'show_ui'         => true,
		'menu_icon'       => 'dashicons-email-alt',
		'menu_position'   => 26,
		'capability_type' => 'post',
		'capabilities'    => array( 'create_posts' => 'do_not_allow' ),
		'map_meta_cap'    => true,
		'supports'        => array( 'title', 'editor' ),
	) );
}

/**
 * Порция публикаций для бесконечной подгрузки на /publication/.
 * Повторяет MODX-обработчик req=events: отдаёт по 9 карточек от смещения s
 * и общее количество, чтобы фронтенд знал, когда остановиться.
 */
function eco_events_feed() {
	$raw    = json_decode( wp_unslash( $_POST['events'] ), true );
	$offset = ( is_array( $raw ) && isset( $raw['s'] ) ) ? max( 0, (int) $raw['s'] ) : 0;
	$per    = 9;

	$q = new WP_Query( array(
		'post_type'      => 'event',
		'post_status'    => 'publish',
		'orderby'        => 'date',
		'order'          => 'DESC',
		'posts_per_page' => $per,
		'offset'         => $offset,
	) );

	$items = array();
	foreach ( $q->posts as $p ) {
		$items[] = array(
			'l' => get_permalink( $p ),
			'i' => eco_image_url( 'ev_animg', 'eco_card', $p->ID ),
			't' => get_the_title( $p ),
		);
	}

	wp_send_json( array(
		'r'   => $items,
		'cnt' => (int) $q->found_posts,
	) );
}
