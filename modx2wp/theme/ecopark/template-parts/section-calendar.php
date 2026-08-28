<?php
/** Блок «Публикации» со слайдером. Порт чанка `calendar`. */
$eco_items = eco_events( 6 );
if ( ! $eco_items ) {
	return;
}
$eco_index = get_posts( array(
	'post_type' => 'page', 'numberposts' => 1, 'fields' => 'ids',
	'meta_key' => '_eco_modx_id', 'meta_value' => 5,
) );
?>
<div class="calendar">
	<div class="events">
		<div class="halign">
			<h2>Публикации</h2>
			<p>Живописное место на берегу водохранилища в окружении бескрайних полей и соснового леса не оставляет равнодушным гостей комплекса. В Богослово есть всё для комфортного отдыха c видом на сосновый лес, жаркие бани с купелями, комнаты отдыха, мангальные зоны.</p>

			<div class="slider anim frombottom">
				<div class="ctrls">
					<?php if ( $eco_index ) : ?>
						<a class="btn" href="<?php echo esc_url( get_permalink( $eco_index[0] ) ); ?>">Все события</a>
					<?php endif; ?>
					<div class="prepn"></div>
					<div class="pn">
						<div class="prev"></div>
						<div class="next"></div>
					</div>
				</div>
				<?php get_template_part( 'template-parts/section-events' ); ?>
			</div>
		</div>
	</div>
</div>
