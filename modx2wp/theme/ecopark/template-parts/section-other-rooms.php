<?php
/** «Другие варианты». Порт чанка `roomsslider` + сниппета randomrooms. */
$eco_items = eco_other_cottages( 3 );
if ( ! $eco_items ) {
	return;
}
?>
<div class="anotherrooms">
	<div class="halign">
		<h2>Другие <br>варианты </h2>
		<div class="roomswr allanim frombottom">
			<?php foreach ( $eco_items as $eco_index => $eco_item ) :
				$eco_extra = 1 === $eco_index ? ' p5' : ( 2 === $eco_index ? ' p10 notp' : '' );
				?>
				<div class="room<?php echo esc_attr( $eco_extra ); ?>">
					<div class="cont">
						<a href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>"></a>
						<div class="i">
							<div style="background-image:url(<?php echo esc_url( eco_image_url( 'nomera_animg', 'eco_room', $eco_item->ID ) ); ?>)"></div>
						</div>
						<div class="tx">
							<p class="pre">Загородный дом</p>
							<p class="t"><?php echo eco_title_html( eco_long_title( $eco_item->ID ) ); ?></p>
							<p><?php echo esc_html( get_the_excerpt( $eco_item ) ); ?></p>
							<div class="bot">
								<div class="lf">
									<p class="price">от <?php echo esc_html( eco_field( 'nomera_price', $eco_item->ID ) ); ?></p>
									<p class="small"></p>
								</div>
								<div class="rg">
									<p class="sq"><?php echo esc_html( eco_field( 'nomera_sq', $eco_item->ID ) ); ?> м2</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</div>
