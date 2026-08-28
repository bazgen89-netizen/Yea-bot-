<?php
/**
 * Типы записей.
 *
 * В MODX всё лежало в одном дереве ресурсов и различалось шаблоном.
 * Здесь каждый шаблон становится своим типом записи, а сохранение
 * прежних адресов берёт на себя inc/permalinks.php — поэтому rewrite
 * у типов отключён намеренно.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'init', 'eco_register_post_types' );
function eco_register_post_types() {

	$shared = array(
		'public'       => true,
		'has_archive'  => false,
		'rewrite'      => false, // адреса выдаёт eco_permalink()
		'hierarchical' => true,
		'menu_position' => 20,
		'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail', 'page-attributes', 'revisions', 'custom-fields' ),
		'show_in_rest' => false, // вёрстка классическая, блочный редактор не нужен
	);

	register_post_type( 'cottage', array_merge( $shared, array(
		'labels' => eco_labels( 'Коттедж', 'Коттеджи', 'Номерной фонд' ),
		'menu_icon' => 'dashicons-admin-home',
	) ) );

	register_post_type( 'service', array_merge( $shared, array(
		'labels' => eco_labels( 'Услуга', 'Услуги', 'Услуги' ),
		'menu_icon' => 'dashicons-heart',
	) ) );

	register_post_type( 'event', array_merge( $shared, array(
		'labels' => eco_labels( 'Публикация', 'Публикации', 'Публикации и события' ),
		'menu_icon' => 'dashicons-megaphone',
	) ) );
}

function eco_labels( $single, $plural, $menu ) {
	return array(
		'name'               => $plural,
		'singular_name'      => $single,
		'menu_name'          => $menu,
		'add_new'            => 'Добавить',
		'add_new_item'       => "Добавить: {$single}",
		'edit_item'          => "Редактировать: {$single}",
		'new_item'           => "Новый: {$single}",
		'view_item'          => "Смотреть: {$single}",
		'search_items'       => "Искать: {$plural}",
		'not_found'          => 'Ничего не найдено',
		'not_found_in_trash' => 'В корзине пусто',
		'all_items'          => $plural,
	);
}

/** Типы записей, которые участвуют в карте адресов и в меню. */
function eco_post_types() {
	return array( 'page', 'cottage', 'service', 'event' );
}
