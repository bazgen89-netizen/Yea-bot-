<?php
/**
 * Свои поля без плагинов.
 *
 * В MODX это были TV (template variables). Здесь — обычные post meta
 * с самодельными метабоксами. Плагин намеренно не используется:
 * повторяющиеся поля (слайдеры) есть только в платной версии ACF,
 * а тема должна ставиться на чистый WordPress и работать.
 *
 * Поля описываются в inc/fields.php через eco_register_fields().
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

global $eco_field_groups;
$eco_field_groups = array();

/**
 * @param string $id         Идентификатор группы.
 * @param array  $args       title, post_types, context, priority, fields.
 */
function eco_register_fields( $id, array $args ) {
	global $eco_field_groups;
	$eco_field_groups[ $id ] = wp_parse_args( $args, array(
		'title'      => $id,
		'post_types' => array( 'page' ),
		'context'    => 'normal',
		'priority'   => 'default',
		'fields'     => array(),
	) );
}

function eco_field_groups() {
	global $eco_field_groups;
	return $eco_field_groups;
}

add_action( 'add_meta_boxes', 'eco_add_meta_boxes' );
function eco_add_meta_boxes() {
	foreach ( eco_field_groups() as $id => $group ) {
		foreach ( (array) $group['post_types'] as $post_type ) {
			add_meta_box(
				'eco-' . $id,
				$group['title'],
				'eco_render_meta_box',
				$post_type,
				$group['context'],
				$group['priority'],
				array( 'group' => $id )
			);
		}
	}
}

function eco_render_meta_box( $post, $box ) {
	$group = eco_field_groups()[ $box['args']['group'] ] ?? null;
	if ( ! $group ) {
		return;
	}
	wp_nonce_field( 'eco_fields_' . $box['args']['group'], 'eco_fields_nonce_' . $box['args']['group'] );
	echo '<div class="eco-fields">';
	foreach ( $group['fields'] as $name => $field ) {
		eco_render_field( $post->ID, $name, $field );
	}
	echo '</div>';
}

function eco_render_field( $post_id, $name, array $field ) {
	$field = wp_parse_args( $field, array(
		'type'  => 'text',
		'label' => $name,
		'hint'  => '',
		'options' => array(),
		'sub_fields' => array(),
	) );
	$value = get_post_meta( $post_id, $name, true );
	$id    = 'eco-f-' . $name;

	echo '<div class="eco-field eco-field--' . esc_attr( $field['type'] ) . '">';
	echo '<label class="eco-field__label" for="' . esc_attr( $id ) . '">' . esc_html( $field['label'] ) . '</label>';

	switch ( $field['type'] ) {

		case 'textarea':
			printf(
				'<textarea id="%s" name="%s" rows="4" class="widefat">%s</textarea>',
				esc_attr( $id ), esc_attr( $name ), esc_textarea( is_string( $value ) ? $value : '' )
			);
			break;

		case 'wysiwyg':
			wp_editor( is_string( $value ) ? $value : '', $id, array(
				'textarea_name' => $name,
				'textarea_rows' => 8,
				'media_buttons' => true,
			) );
			break;

		case 'checkbox':
			printf(
				'<label class="eco-field__cb"><input type="checkbox" id="%s" name="%s" value="1"%s> %s</label>',
				esc_attr( $id ), esc_attr( $name ), checked( $value, '1', false ), esc_html( $field['hint'] )
			);
			break;

		case 'select':
			printf( '<select id="%s" name="%s">', esc_attr( $id ), esc_attr( $name ) );
			foreach ( $field['options'] as $key => $label ) {
				printf( '<option value="%s"%s>%s</option>', esc_attr( $key ), selected( $value, $key, false ), esc_html( $label ) );
			}
			echo '</select>';
			break;

		case 'image':
			eco_render_image_field( $id, $name, $value );
			break;

		case 'repeater':
			eco_render_repeater_field( $name, $field, $value );
			break;

		default:
			printf(
				'<input type="text" class="widefat" id="%s" name="%s" value="%s">',
				esc_attr( $id ), esc_attr( $name ), esc_attr( is_string( $value ) ? $value : '' )
			);
	}

	if ( $field['hint'] && 'checkbox' !== $field['type'] ) {
		echo '<p class="eco-field__hint description">' . esc_html( $field['hint'] ) . '</p>';
	}
	echo '</div>';
}

function eco_render_image_field( $id, $name, $value ) {
	$attachment_id = (int) $value;
	$preview       = $attachment_id ? wp_get_attachment_image_url( $attachment_id, 'medium' ) : '';
	?>
	<div class="eco-image" data-eco-image>
		<input type="hidden" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>"
			value="<?php echo esc_attr( $attachment_id ?: '' ); ?>" data-eco-image-input>
		<div class="eco-image__preview" data-eco-image-preview>
			<?php if ( $preview ) : ?>
				<img src="<?php echo esc_url( $preview ); ?>" alt="">
			<?php endif; ?>
		</div>
		<button type="button" class="button" data-eco-image-pick>Выбрать</button>
		<button type="button" class="button-link" data-eco-image-clear>Убрать</button>
	</div>
	<?php
}

function eco_render_repeater_field( $name, array $field, $value ) {
	$rows = is_array( $value ) ? $value : array();
	?>
	<div class="eco-repeater" data-eco-repeater data-name="<?php echo esc_attr( $name ); ?>">
		<div class="eco-repeater__rows" data-eco-repeater-rows>
			<?php
			$index = 0;
			foreach ( $rows as $row ) {
				eco_render_repeater_row( $name, $field['sub_fields'], $row, $index );
				$index++;
			}
			?>
		</div>
		<template data-eco-repeater-template>
			<?php eco_render_repeater_row( $name, $field['sub_fields'], array(), '__i__' ); ?>
		</template>
		<button type="button" class="button button-secondary" data-eco-repeater-add>Добавить слайд</button>
	</div>
	<?php
}

function eco_render_repeater_row( $name, array $sub_fields, $row, $index ) {
	?>
	<div class="eco-repeater__row" data-eco-repeater-row>
		<span class="eco-repeater__handle dashicons dashicons-menu" data-eco-repeater-handle></span>
		<div class="eco-repeater__body">
			<?php foreach ( $sub_fields as $sub_name => $sub ) :
				$sub        = wp_parse_args( $sub, array( 'type' => 'text', 'label' => $sub_name ) );
				$field_name = sprintf( '%s[%s][%s]', $name, $index, $sub_name );
				$field_id   = sprintf( 'eco-f-%s-%s-%s', $name, $index, $sub_name );
				$sub_value  = $row[ $sub_name ] ?? '';
				?>
				<div class="eco-field eco-field--<?php echo esc_attr( $sub['type'] ); ?>">
					<label class="eco-field__label"><?php echo esc_html( $sub['label'] ); ?></label>
					<?php if ( 'image' === $sub['type'] ) : ?>
						<?php eco_render_image_field( $field_id, $field_name, $sub_value ); ?>
					<?php else : ?>
						<input type="text" class="widefat" id="<?php echo esc_attr( $field_id ); ?>"
							name="<?php echo esc_attr( $field_name ); ?>" value="<?php echo esc_attr( $sub_value ); ?>">
					<?php endif; ?>
				</div>
			<?php endforeach; ?>
		</div>
		<button type="button" class="button-link eco-repeater__remove" data-eco-repeater-remove>Удалить</button>
	</div>
	<?php
}

/* ------------------------------------------------------------------ *
 * Сохранение
 * ------------------------------------------------------------------ */

add_action( 'save_post', 'eco_save_fields', 10, 2 );
function eco_save_fields( $post_id, $post ) {
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( wp_is_post_revision( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}

	foreach ( eco_field_groups() as $group_id => $group ) {
		if ( ! in_array( $post->post_type, (array) $group['post_types'], true ) ) {
			continue;
		}
		$nonce = $_POST[ 'eco_fields_nonce_' . $group_id ] ?? '';
		if ( ! $nonce || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $nonce ) ), 'eco_fields_' . $group_id ) ) {
			continue; // группы нет в этой форме — не трогаем её значения
		}

		foreach ( $group['fields'] as $name => $field ) {
			$type = $field['type'] ?? 'text';
			$raw  = $_POST[ $name ] ?? null;

			if ( 'checkbox' === $type ) {
				update_post_meta( $post_id, $name, $raw ? '1' : '' );
				continue;
			}
			if ( null === $raw ) {
				continue;
			}

			update_post_meta( $post_id, $name, eco_sanitize_field( $type, $raw, $field ) );
		}
	}
}

function eco_sanitize_field( $type, $raw, array $field = array() ) {
	switch ( $type ) {
		case 'wysiwyg':
			return wp_kses_post( wp_unslash( $raw ) );

		case 'textarea':
			return sanitize_textarea_field( wp_unslash( $raw ) );

		case 'image':
			return (int) $raw ?: '';

		case 'select':
			$allowed = array_keys( $field['options'] ?? array() );
			$value   = sanitize_text_field( wp_unslash( $raw ) );
			return in_array( $value, $allowed, true ) ? $value : '';

		case 'repeater':
			$rows = array();
			foreach ( (array) $raw as $row ) {
				$clean = array();
				foreach ( ( $field['sub_fields'] ?? array() ) as $sub_name => $sub ) {
					$sub_type = $sub['type'] ?? 'text';
					$clean[ $sub_name ] = eco_sanitize_field( $sub_type, $row[ $sub_name ] ?? '', $sub );
				}
				// Слайд без картинки бессмыслен — выбрасываем.
				if ( ! empty( array_filter( $clean ) ) ) {
					$rows[] = $clean;
				}
			}
			return array_values( $rows );

		default:
			return sanitize_text_field( wp_unslash( $raw ) );
	}
}

/* ------------------------------------------------------------------ *
 * Скрипты админки
 * ------------------------------------------------------------------ */

add_action( 'admin_enqueue_scripts', 'eco_admin_assets' );
function eco_admin_assets( $hook ) {
	if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
		return;
	}
	wp_enqueue_media();
	wp_enqueue_style( 'eco-admin', ECO_URI . '/assets/css/admin-fields.css', array(), ECO_VERSION );
	wp_enqueue_script( 'eco-admin', ECO_URI . '/assets/js/admin-fields.js', array( 'jquery', 'jquery-ui-sortable' ), ECO_VERSION, true );
}
