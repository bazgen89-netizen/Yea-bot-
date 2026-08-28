<?php
/** Главное событие на главной. Порт чанка `events_mainpage`. */
$eco_item = eco_main_event();
if ( ! $eco_item ) {
	return;
}
?>
<div class="news">
	<div class="halign">
		<div class="tbl">
			<div class="txt">
				<div class="in allanim">
					<?php if ( eco_field( 'ev_dat', $eco_item->ID ) ) : ?>
						<div class="dt frombottom"><p><?php echo esc_html( eco_field( 'ev_dat', $eco_item->ID ) ); ?></p></div>
					<?php endif; ?>
					<h2 class="frombottom"><?php echo esc_html( eco_long_title( $eco_item->ID ) ); ?></h2>
					<p class="frombottom"><?php echo esc_html( get_the_excerpt( $eco_item ) ); ?></p>
					<a class="btn brown frombottom" href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>">Подробнее</a>
				</div>
			</div>
			<div class="img anim frombottom">
				<div class="i" style="background-image:url(<?php echo esc_url( eco_image_url( 'ev_animg', 'eco_card', $eco_item->ID ) ); ?>)"></div>
			</div>
		</div>
	</div>
</div>
