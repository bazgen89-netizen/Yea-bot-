<?php
/** Слайдер публикаций. Порт getResources с чанком `events_slider_element`. */
$eco_items = eco_events( 6 );
if ( ! $eco_items ) {
	return;
}
?>
<div class="swiper-container">
	<div class="swiper-wrapper">
		<?php foreach ( $eco_items as $eco_item ) : ?>
			<?php get_template_part( 'template-parts/card-event', null, array( 'post' => $eco_item ) ); ?>
		<?php endforeach; ?>
	</div>
</div>
