<?php
/** Список коттеджей крупными карточками. Порт чанка `nomera_anblock_2`. */
$eco_items = get_posts( array(
	'post_type'      => 'cottage',
	'posts_per_page' => 10,
	'post_status'    => 'publish',
	'orderby'        => 'menu_order date',
	'order'          => 'ASC',
) );
if ( ! $eco_items ) {
	return;
}
foreach ( $eco_items as $eco_item ) :
	$eco_tour = eco_field( 'nomera_3dtour_link', $eco_item->ID );
	?>
	<div class="roombig">
		<div class="img">
			<a href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>"></a>
			<div style="background-image:url(<?php echo esc_url( eco_image_url( 'nomera_animg', 'eco_room', $eco_item->ID ) ); ?>)"></div>
		</div>
		<div class="tx">
			<div class="lf">
				<p class="pre">Коттедж с баней</p>
				<a href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>" class="h"><?php echo eco_title_html( eco_long_title( $eco_item->ID ) ); ?></a>
				<p><?php echo esc_html( get_the_excerpt( $eco_item ) ); ?></p>
				<div class="wr">
					<div class="price">
						<p class="p">от <?php echo esc_html( eco_field( 'nomera_price', $eco_item->ID ) ); ?> Р.</p>
						<p></p>
					</div>
					<div class="sq">
						<p><?php echo esc_html( eco_field( 'nomera_sq', $eco_item->ID ) ); ?> м2</p>
					</div>
				</div>
			</div>
			<div class="rg">
				<?php if ( $eco_tour ) : ?>
					<a class="btn brown2 frombottom" target="_blank" rel="noopener" href="<?php echo esc_url( $eco_tour ); ?>">3D-Тур</a>
				<?php endif; ?>
				<a class="btn brown frombottom" href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>"><span>Подробнее</span></a>
			</div>
		</div>
	</div>
	<?php
endforeach;
