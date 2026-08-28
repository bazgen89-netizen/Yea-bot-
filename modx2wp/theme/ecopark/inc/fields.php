<?php
/**
 * Поля страниц — перенос 25 TV из MODX.
 *
 * Значения-флажки в MODX хранились строкой `en`; здесь это обычная
 * единица. Пересчёт делает скрипт миграции, шаблоны читают через
 * eco_flag() и на старый формат не завязаны.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'init', 'eco_setup_fields', 5 );
function eco_setup_fields() {

	$all_types = eco_post_types();

	/* Шапка страницы — бывшие TV all_header_* */
	eco_register_fields( 'header', array(
		'title'      => 'Шапка страницы',
		'post_types' => $all_types,
		'context'    => 'side',
		'fields'     => array(
			'all_header_mode'  => array(
				'type'    => 'select',
				'label'   => 'Вид шапки',
				'options' => array(
					'h1' => 'Основной со слайдером',
					'h2' => 'Краткий с тёмным фоном',
					'h3' => 'Краткий со светлым фоном',
				),
			),
			'all_header_imgdp' => array( 'type' => 'image', 'label' => 'Фон шапки — десктоп' ),
			'all_header_imgtp' => array( 'type' => 'image', 'label' => 'Фон шапки — планшет' ),
			'all_header_imgmp' => array( 'type' => 'image', 'label' => 'Фон шапки — мобильный' ),
			'all_footer_mode'  => array( 'type' => 'checkbox', 'label' => 'Подвал', 'hint' => 'Показывать карту над подвалом' ),
		),
	) );

	/* Заголовочный блок — бывшие TV pg_* */
	eco_register_fields( 'page-top', array(
		'title'      => 'Заголовочный блок',
		'post_types' => array( 'page', 'service', 'event' ),
		'fields'     => array(
			'pg_var'      => array(
				'type'    => 'select',
				'label'   => 'Вариант блока',
				'options' => array(
					'v1' => 'Тёмная шапка без слайдера',
					'v2' => 'Светлая шапка со слайдером',
				),
			),
			'pg_nobg'     => array( 'type' => 'checkbox', 'label' => 'Фон', 'hint' => 'Отключить фон текстового блока' ),
			'pg_toppre'   => array( 'type' => 'text', 'label' => 'Надпись над заголовком' ),
			'pg_topcont'  => array( 'type' => 'wysiwyg', 'label' => 'Текст в заголовочном блоке' ),
			'pg_topslider' => array(
				'type'       => 'repeater',
				'label'      => 'Слайдер в заголовке',
				'hint'       => 'Показывается в варианте «Светлая шапка со слайдером»',
				'sub_fields' => array(
					'img' => array( 'type' => 'image', 'label' => 'Изображение' ),
				),
			),
		),
	) );

	/* Коттедж — бывшие TV nomera_* */
	eco_register_fields( 'cottage', array(
		'title'      => 'Параметры коттеджа',
		'post_types' => array( 'cottage' ),
		'fields'     => array(
			'nomera_price'      => array( 'type' => 'text', 'label' => 'Цена, будни (вс–чт)' ),
			'nomera_price2'     => array( 'type' => 'text', 'label' => 'Цена, выходные (пт–сб)' ),
			'nomera_sq'         => array( 'type' => 'text', 'label' => 'Площадь, м²' ),
			'nomera_3dtour_link' => array( 'type' => 'text', 'label' => 'Ссылка на 3D-тур' ),
			'nomera_bronlink'   => array( 'type' => 'textarea', 'label' => 'Блок кнопки брони', 'hint' => 'HTML кнопки TravelLine' ),
			'nomera_text'       => array( 'type' => 'wysiwyg', 'label' => 'Описание в шапке' ),
			'nomera_animg'      => array( 'type' => 'image', 'label' => 'Изображение анонса' ),
			'nomera_no_extras'  => array(
				'type'  => 'checkbox',
				'label' => 'Доп. услуги',
				'hint'  => 'Скрыть блок «животные / фермерский завтрак»',
			),
			'nomera_topslider'  => array(
				'type'       => 'repeater',
				'label'      => 'Главный слайдер',
				'sub_fields' => array(
					'img' => array( 'type' => 'image', 'label' => 'Изображение' ),
				),
			),
		),
	) );

	/* Публикация — бывшие TV ev_* */
	eco_register_fields( 'event', array(
		'title'      => 'Параметры публикации',
		'post_types' => array( 'event' ),
		'fields'     => array(
			'ev_dat'   => array( 'type' => 'text', 'label' => 'Дата события' ),
			'ev_animg' => array( 'type' => 'image', 'label' => 'Изображение анонса' ),
			'ev_main'  => array( 'type' => 'checkbox', 'label' => 'Главное событие', 'hint' => 'Показывать блоком на главной' ),
		),
	) );

	/* Услуга */
	eco_register_fields( 'service', array(
		'title'      => 'Параметры услуги',
		'post_types' => array( 'service' ),
		'fields'     => array(
			'usl_animg' => array( 'type' => 'image', 'label' => 'Изображение анонса' ),
		),
	) );

	/* Слайдер главной — бывший чанк sliderHome, который правился в коде */
	eco_register_fields( 'home', array(
		'title'      => 'Слайдер главной страницы',
		'post_types' => array( 'page' ),
		'fields'     => array(
			'home_slider' => array(
				'type'       => 'repeater',
				'label'      => 'Слайды',
				'hint'       => 'Показывается только на странице, назначенной главной',
				'sub_fields' => array(
					'img'   => array( 'type' => 'image', 'label' => 'Изображение' ),
					'title' => array( 'type' => 'text', 'label' => 'Заголовок (можно <br>)' ),
					'text'  => array( 'type' => 'text', 'label' => 'Текст' ),
					'url'   => array( 'type' => 'text', 'label' => 'Ссылка кнопки' ),
					'btn'   => array( 'type' => 'text', 'label' => 'Надпись на кнопке' ),
				),
			),
		),
	) );

	/* Адрес страницы — то, чем занимается inc/permalinks.php */
	eco_register_fields( 'uri', array(
		'title'      => 'Адрес и заголовок',
		'post_types' => $all_types,
		'context'    => 'side',
		'priority'   => 'high',
		'fields'     => array(
			ECO_URI_META => array(
				'type'  => 'text',
				'label' => 'Путь от корня сайта',
				'hint'  => 'Как на старом сайте: uslugi/spa/ или contacts.html. Пусто — соберётся из слагов.',
			),
			'_eco_longtitle' => array(
				'type'  => 'text',
				'label' => 'Заголовок H1',
				'hint'  => 'Бывший longtitle из MODX. Пусто — берётся обычный заголовок.',
			),
		),
	) );
}

/* ------------------------------------------------------------------ *
 * Чтение полей в шаблонах
 * ------------------------------------------------------------------ */

/** Значение поля. */
function eco_field( $name, $post_id = null ) {
	$post_id = $post_id ?: get_the_ID();
	return get_post_meta( $post_id, $name, true );
}

/** Флажок: понимает и '1', и старое MODX-значение 'en'. */
function eco_flag( $name, $post_id = null ) {
	$value = eco_field( $name, $post_id );
	return ( '1' === $value || 'en' === $value || 1 === $value || true === $value );
}

/**
 * URL картинки из поля типа image. Принимает и id вложения, и путь,
 * доставшийся от MODX.
 *
 * Относительный путь вида `content/rooms/1.jpg` обязательно приводится
 * к адресу от корня сайта: esc_url() принимает строку без схемы и без
 * ведущего слэша за имя хоста и превращает её в `http://content/...`.
 */
function eco_image_url( $name, $size = 'full', $post_id = null ) {
	return eco_row_image_url( eco_field( $name, $post_id ), $size );
}

/** То же для значения внутри строки повторителя. */
function eco_row_image_url( $value, $size = 'full' ) {
	if ( ! $value ) {
		return '';
	}
	if ( is_numeric( $value ) ) {
		return (string) wp_get_attachment_image_url( (int) $value, $size );
	}
	return esc_url( eco_normalize_url( (string) $value ) );
}

/** Достраивает относительный путь до адреса от корня сайта. */
function eco_normalize_url( $value ) {
	$value = trim( $value );
	if ( '' === $value ) {
		return '';
	}
	// Уже абсолютный: со схемой, протокол-относительный или от корня.
	if ( preg_match( '~^(https?:)?//~i', $value ) || str_starts_with( $value, '/' ) ) {
		return $value;
	}
	return home_url( '/' . ltrim( $value, '/' ) );
}

/** Строки повторителя. */
function eco_rows( $name, $post_id = null ) {
	$value = eco_field( $name, $post_id );
	return is_array( $value ) ? $value : array();
}
