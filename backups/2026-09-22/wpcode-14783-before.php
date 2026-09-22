// === 1. СТИЛИ: кнопки TG/WA + вишлист + попап + мобильные фиксы ===
add_action('wp_head', function() { ?>
<style>
.wt-float-btns{position:fixed;bottom:160px;right:18px;z-index:9990;display:flex;flex-direction:column;gap:12px;}
.wt-float-btns a{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:transform .2s;}
.wt-float-btns a:hover{transform:scale(1.12);}
.wt-btn-tg{background:#2AABEE;}
.wt-btn-wa{background:#25D366;}
#wt-wishlist-bar{position:fixed;bottom:280px;right:18px;background:#2c1810;color:#fff;border-radius:50px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;z-index:9989;display:none;box-shadow:0 4px 16px rgba(0,0,0,.3);text-decoration:none;}
#wt-wishlist-bar span{background:#c9a84c;color:#2c1810;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-left:6px;}
li.product{position:relative;}
.wt-wish-btn{background:rgba(255,255,255,.92);border:none;cursor:pointer;position:absolute;top:8px;right:8px;z-index:10;font-size:18px;padding:5px;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.15);width:34px;height:34px;display:flex;align-items:center;justify-content:center;transition:transform .2s;}
.wt-wish-btn:hover{transform:scale(1.15);}
.wt-wish-btn.wt-active{color:#e33;}
#wt-delivery-bar{background:#2c1810;color:#fff;text-align:center;padding:10px 20px;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:200;}
.wt-gold{color:#c9a84c;font-weight:700;}
@media(max-width:768px){
  .wt-float-btns{bottom:130px;right:12px;}
  .wt-float-btns a{width:48px;height:48px;}
  #wt-delivery-bar{font-size:12px;padding:8px 10px;}
  #wt-wishlist-bar{bottom:80px;right:12px;font-size:12px;padding:8px 14px;}
    }
</style>
<?php });

// === 2. КНОПКИ TG + WA ===
add_action('wp_footer', function() { ?>
<div class="wt-float-btns">
  <a href="https://t.me/waystea" target="_blank" class="wt-btn-tg" title="Telegram">
    <svg viewBox="0 0 24 24" fill="#fff" width="26" height="26"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.94 8.19-2.02 9.52c-.15.67-.54.83-1.08.52l-3-2.21-1.45 1.39c-.16.16-.3.3-.61.3l.22-3.07 5.6-5.06c.24-.22-.05-.34-.38-.12L6.6 14.27l-2.97-.93c-.64-.2-.66-.64.14-.95l11.6-4.47c.53-.2 1 .13.57 2.27z"/></svg>
  </a>
  <a href="https://wa.me/79997108333" target="_blank" class="wt-btn-wa" title="WhatsApp">
    <svg viewBox="0 0 24 24" fill="#fff" width="26" height="26"><path d="M17.47 14.38c-.26.73-1.52 1.4-2.08 1.44-.56.05-1.08.25-3.63-.75-3.07-1.21-5.03-4.36-5.18-4.56-.15-.2-1.22-1.62-1.22-3.09s.77-2.19 1.04-2.49.59-.38.79-.38l.57.01c.18 0 .43-.07.67.51.26.62.87 2.12.94 2.28.08.15.13.34.03.54s-.15.32-.3.5l-.44.51c-.15.15-.3.3-.13.6.17.29.76 1.26 1.63 2.04 1.12 1 2.06 1.31 2.36 1.46.29.15.46.13.63-.08.17-.21.73-.85.92-1.14.2-.29.39-.24.66-.14.26.1 1.67.79 1.96.93.29.15.48.22.55.34.08.13.08.73-.18 1.47zM12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.1 1.52 5.82L0 24l6.35-1.66A11.94 11.94 0 0012 24c6.63 0 12-5.37 12-12S18.63 0 12 0z"/></svg>
  </a>
</div>
<?php });

// === 3. БАННЕР ДОСТАВКИ ===
add_action('wp_footer', function() {
  if (!is_shop() && !is_product_category() && !is_product() && !is_cart()) return; ?>
<div id="wt-delivery-bar">
  🚚 Бесплатная доставка от <span class="wt-gold">3 000 ₽</span>
  &nbsp;|&nbsp; В корзине: <span class="wt-gold" id="wt-cart-sum">0 ₽</span>
</div>
<script>
(function(){
  function upd(){
    var t=parseFloat((document.querySelector(".cart-subtotal .woocommerce-Price-amount")||{textContent:"0"}).textContent.replace(/[^0-9.]/g,""))||0;
    var el=document.getElementById("wt-cart-sum");
    if(el)el.textContent=t.toLocaleString("ru-RU")+" ₽";
  }
  document.addEventListener("DOMContentLoaded",upd);
  document.body.addEventListener("wc_fragments_refreshed",upd);
})();
</script>
<?php });

// === 5. ВИШЛИСТ ===
add_action('wp_footer', function() {
  if (!is_shop() && !is_product_category() && !is_product()) return; ?>
<a href="/wishlist/" id="wt-wishlist-bar">❤ Избранное <span id="wt-wn">0</span></a>
<script>
(function(){
  var W=JSON.parse(localStorage.getItem("wt_wl")||"[]");
  function save(){localStorage.setItem("wt_wl",JSON.stringify(W));}
  function upd(){var n=document.getElementById("wt-wn"),b=document.getElementById("wt-wishlist-bar");if(n)n.textContent=W.length;if(b)b.style.display=W.length?"flex":"none";}
  function mkBtns(){
    document.querySelectorAll("li.product").forEach(function(li){
      if(li.querySelector(".wt-wish-btn"))return;
      var a=li.querySelector("a");
      var pid=(li.querySelector("[data-product_id]")||{dataset:{}}).dataset.product_id||"";
      if(!pid&&a)pid=a.href.match(//(d+)//)?a.href.match(//(d+)//)[1]:"";
      if(!pid)return;
      var btn=document.createElement("button");
      btn.className="wt-wish-btn"+(W.includes(pid)?" wt-active":"");
      btn.innerHTML=W.includes(pid)?"❤":"♡";
      btn.onclick=function(e){e.preventDefault();e.stopPropagation();var i=W.indexOf(pid);if(i>-1){W.splice(i,1);btn.innerHTML="♡";btn.classList.remove("wt-active");}else{W.push(pid);btn.innerHTML="❤";btn.classList.add("wt-active");}save();upd();};
      li.appendChild(btn);
    });
  }
  upd();mkBtns();
  document.addEventListener("DOMContentLoaded",function(){upd();mkBtns();});
})();
</script>
<?php });

// === 6. ХИТЫ ПРОДАЖ на главной ===
add_action('wp_footer', function() {
  if (!is_front_page() && !is_page(9272)) return;
$prods = wc_get_products(['status'=>'publish','limit'=>8,'orderby'=>'rand','tax_query'=>['relation'=>'AND',['taxonomy'=>'product_tag','field'=>'slug','terms'=>'hity-prodazh'],['taxonomy'=>'product_cat','field'=>'slug','terms'=>'posuda','operator'=>'NOT IN']]]);
  if (empty($prods)) return;
  echo '<div style="padding:60px 20px;background:#fdf8f2;">';
  echo '<div style="max-width:1100px;margin:0 auto;">';
  echo '<h2 style="text-align:center;font-family:Georgia,serif;font-size:32px;font-weight:700;color:#2c1810;margin:0 0 8px;">Хиты продаж</h2>';
  echo '<p style="text-align:center;color:#9e8e7e;font-size:15px;margin:0 0 40px;">Самые популярные чаи нашего магазина</p>';
  echo '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px;">';
  foreach ($prods as $p) {
    $img=$p->get_image_id()?wp_get_attachment_image_url($p->get_image_id(),'woocommerce_thumbnail'):wc_placeholder_img_src();
    $url=$p->get_permalink();$name=$p->get_name();$price=$p->get_price_html();
    $rat=round((float)$p->get_average_rating());
    $stars=$rat>0?str_repeat('★',$rat).str_repeat('☆',5-$rat):'';
    echo '<div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #f0ebe2;">';
    echo '<a href="'.esc_url($url).'"><img src="'.esc_url($img).'" alt="'.esc_attr($name).'" loading="lazy" style="width:100%;height:200px;object-fit:cover;display:block;"></a>';
    echo '<div style="padding:14px;">';
    if($stars)echo '<div style="color:#c9a84c;font-size:13px;margin-bottom:4px;">'.$stars.'</div>';
    echo '<a href="'.esc_url($url).'" style="font-size:13px;font-weight:600;color:#2c1810;text-decoration:none;display:block;margin-bottom:8px;line-height:1.4;">'.esc_html(mb_substr($name,0,55)).'</a>';
    echo '<div style="font-size:15px;font-weight:700;color:#c9a84c;margin-bottom:10px;">'.$price.'</div>';
    echo '<a href="'.esc_url($url).'" style="display:block;background:#2c1810;color:#fff;text-align:center;padding:9px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">В корзину</a>';
    echo '</div></div>';
  }
  echo '</div><div style="text-align:center;margin-top:32px;">';
  echo '<a href="/shop/" style="display:inline-block;background:#2c1810;color:#fff;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Весь каталог →</a>';
  echo '</div></div></div>';
});

// === 7. БЛОК ОТЗЫВОВ на странице товара ===
add_action('woocommerce_after_single_product', function() {
  if (!is_product()) return;
  global $wpdb, $product;
  $pid = get_the_ID();
  
  $reviews = $wpdb->get_results($wpdb->prepare(
    "SELECT c.comment_ID, c.comment_author, c.comment_content, c.comment_date,
     m.meta_value as rating
     FROM {$wpdb->comments} c
     LEFT JOIN {$wpdb->commentmeta} m ON m.comment_id = c.comment_ID AND m.meta_key = 'rating'
     WHERE c.comment_post_ID = %d AND c.comment_type = 'review' AND c.comment_approved = 1
     ORDER BY c.comment_date DESC LIMIT 20",
    $pid
  ));
  
  if (empty($reviews)) return;
  
  $total = (int)get_post_meta($pid,'_wc_review_count',true);
  $avg   = (float)get_post_meta($pid,'_wc_average_rating',true);
  $stars_avg = $avg > 0 ? str_repeat('★', round($avg)) . str_repeat('☆', 5-round($avg)) : '';
  
  echo '<div class="wt-reviews-block" style="max-width:900px;margin:0 auto;padding:48px 20px 60px;">';
  echo '<div style="display:flex;align-items:center;gap:16px;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #f0ebe2;">';
  echo '<h2 style="margin:0;font-family:Georgia,serif;font-size:28px;color:#2c1810;">Отзывы покупателей</h2>';
  if ($avg > 0) {
    echo '<div style="display:flex;align-items:center;gap:8px;">';
    echo '<span style="color:#c9a84c;font-size:22px;">'.$stars_avg.'</span>';
    echo '<span style="font-size:18px;font-weight:700;color:#2c1810;">'.number_format($avg,1).'</span>';
    echo '<span style="color:#9e8e7e;font-size:14px;">('.$total.' отзыв'.($total>=5?'ов':($total>=2?'а':'')).')</span>';
    echo '</div>';
  }
  echo '</div>';
  
  echo '<div style="display:flex;flex-direction:column;gap:20px;">';
  foreach ($reviews as $r) {
    $rating = (int)$r->rating;
    $stars  = $rating > 0 ? str_repeat('★',$rating).str_repeat('☆',5-$rating) : '';
    $date   = date('d.m.Y', strtotime($r->comment_date));
    $initials = mb_substr($r->comment_author,0,1,'UTF-8');
    
    echo '<div style="background:#fdf8f2;border-radius:12px;padding:20px 24px;border:1px solid #f0ebe2;">';
    echo '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">';
    echo '<div style="width:40px;height:40px;border-radius:50%;background:#2c1810;color:#c9a84c;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">'.$initials.'</div>';
    echo '<div>';
    echo '<div style="font-weight:600;color:#2c1810;font-size:15px;">'.esc_html($r->comment_author).'</div>';
    echo '<div style="display:flex;align-items:center;gap:8px;">';
    if ($stars) echo '<span style="color:#c9a84c;font-size:15px;">'.$stars.'</span>';
    echo '<span style="color:#aaa;font-size:12px;">'.$date.'</span>';
    echo '</div></div></div>';
    echo '<p style="margin:0;color:#4a3728;font-size:14px;line-height:1.7;">'.esc_html($r->comment_content).'</p>';
    echo '</div>';
  }
  echo '</div>';
  
  if ($total > 20) {
    echo '<div style="text-align:center;margin-top:24px;color:#9e8e7e;font-size:13px;">Показано 20 из '.$total.' отзывов</div>';
  }
  
  echo '</div>';
}, 15);

// === 8. ФОРМА ОТЗЫВА для авторизованных пользователей ===
add_action('woocommerce_after_single_product', function() {
  if (!is_product() || !is_user_logged_in()) return;
  $user = wp_get_current_user();
  $pid  = get_the_ID();
  $nonce = wp_create_nonce('wt_review_'.$pid);
  ?>
  <div class="wt-review-form" style="max-width:900px;margin:0 auto 60px;padding:0 20px;">
    <div style="background:#fff;border:1px solid #f0ebe2;border-radius:16px;padding:32px;">
      <h3 style="margin:0 0 20px;font-family:Georgia,serif;font-size:22px;color:#2c1810;">Оставить отзыв</h3>
      <div id="wt-rf-msg" style="display:none;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px;"></div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;font-weight:600;color:#2c1810;margin-bottom:8px;">Ваша оценка</label>
        <div id="wt-rf-stars" style="display:flex;gap:6px;font-size:32px;cursor:pointer;">
          <?php for($i=1;$i<=5;$i++): ?>
          <span class="wt-rf-star" data-v="<?php echo $i; ?>" style="color:#e8ddd0;transition:color .15s;">★</span>
          <?php endfor; ?>
        </div>
        <input type="hidden" id="wt-rf-rating" value="0">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;font-weight:600;color:#2c1810;margin-bottom:8px;">Ваш отзыв</label>
        <textarea id="wt-rf-text" rows="4" placeholder="Расскажите о вкусе, аромате, способе заваривания..." style="width:100%;padding:12px 14px;border:1px solid #e0d8ce;border-radius:8px;font-size:14px;line-height:1.6;font-family:inherit;resize:vertical;box-sizing:border-box;outline:none;"></textarea>
      </div>
      <button onclick="wtSubmitReview()" style="background:#2c1810;color:#fff;border:none;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">Отправить отзыв</button>
    </div>
  </div>
  <script>
  (function(){
    var rating=0;
    var stars=document.querySelectorAll('.wt-rf-star');
    stars.forEach(function(s,i){
      s.onmouseenter=function(){stars.forEach(function(x,j){x.style.color=j<=i?'#c9a84c':'#e8ddd0';});};
      s.onmouseleave=function(){stars.forEach(function(x,j){x.style.color=j<rating?'#c9a84c':'#e8ddd0';});};
      s.onclick=function(){rating=parseInt(s.dataset.v);document.getElementById('wt-rf-rating').value=rating;stars.forEach(function(x,j){x.style.color=j<rating?'#c9a84c':'#e8ddd0';});};
    });
  })();
  window.wtSubmitReview=function(){
    var rating=parseInt(document.getElementById('wt-rf-rating').value);
    var text=document.getElementById('wt-rf-text').value.trim();
    var msg=document.getElementById('wt-rf-msg');
    if(!rating){msg.style.display='block';msg.style.background='#fef3cd';msg.style.color='#856404';msg.textContent='Пожалуйста, выберите оценку';return;}
    if(text.length<10){msg.style.display='block';msg.style.background='#fef3cd';msg.style.color='#856404';msg.textContent='Напишите отзыв (минимум 10 символов)';return;}
    fetch('/wp-json/wt/v1/user-review',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-WP-Nonce':'<?php echo $nonce; ?>'},
      body:JSON.stringify({product_id:<?php echo $pid; ?>,rating:rating,review:text,nonce:'<?php echo $nonce; ?>'})
    }).then(function(r){return r.json();}).then(function(d){
      if(d.ok){
        msg.style.display='block';msg.style.background='#d4edda';msg.style.color='#155724';
        msg.textContent='Спасибо за ваш отзыв! Он появится на странице.';
        document.getElementById('wt-rf-text').value='';
        document.getElementById('wt-rf-rating').value=0;
        document.querySelectorAll('.wt-rf-star').forEach(function(s){s.style.color='#e8ddd0';});
        setTimeout(function(){window.location.reload();},1500);
      } else {
        msg.style.display='block';msg.style.background='#f8d7da';msg.style.color='#721c24';
        msg.textContent=d.message||'Ошибка, попробуйте ещё раз';
      }
    });
  };
  </script>
  <?php
}, 20);

// REST endpoint для отзыва авторизованного пользователя
add_action('rest_api_init', function(){
  register_rest_route('wt/v1','user-review',['methods'=>'POST','callback'=>'wt_user_review','permission_callback'=>'is_user_logged_in']);
});
function wt_user_review($req){
  $pid    = (int)$req->get_param('product_id');
  $rating = max(1,min(5,(int)$req->get_param('rating')));
  $review = sanitize_textarea_field($req->get_param('review'));
  $nonce  = $req->get_param('nonce');
  if(!wp_verify_nonce($nonce,'wt_review_'.$pid)) return new WP_Error('e','Invalid nonce',['status'=>403]);
  if(!$pid||strlen($review)<10) return new WP_Error('e','Invalid data',['status'=>400]);
  $user = wp_get_current_user();
  $id = wp_insert_comment([
    'comment_post_ID'      =>$pid,
    'comment_author'       =>$user->display_name,
    'comment_author_email' =>$user->user_email,
    'comment_content'      =>$review,
    'comment_type'         =>'review',
    'comment_approved'     =>1,
    'user_id'              =>get_current_user_id(),
  ]);
  if(!$id||is_wp_error($id)) return new WP_Error('e','Failed',['status'=>500]);
  add_comment_meta($id,'rating',$rating,true);
  add_comment_meta($id,'verified',1,true);
  global $wpdb;
  $cnt=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_post_ID=%d AND comment_type='review' AND comment_approved=1",$pid));
  $sum=(int)$wpdb->get_var($wpdb->prepare("SELECT SUM(m.meta_value) FROM {$wpdb->commentmeta} m JOIN {$wpdb->comments} c ON c.comment_ID=m.comment_id WHERE m.meta_key='rating' AND c.comment_post_ID=%d AND c.comment_approved=1",$pid));
  update_post_meta($pid,'_wc_average_rating',$cnt>0?round($sum/$cnt,2):0);
  update_post_meta($pid,'_wc_review_count',$cnt);
  WC_Comments::clear_transients($pid);
  return['ok'=>true,'id'=>$id];
}

// === РЕЙТИНГ И ОТЗЫВЫ в каталоге ===
remove_action('woocommerce_after_shop_loop_item_title','woocommerce_template_loop_rating',5);
add_action('woocommerce_after_shop_loop_item_title', function() {
  global $product;
  $cnt = (int)$product->get_review_count();
  $avg = (float)$product->get_average_rating();
  if ($cnt < 1 || $avg < 1) return;
  // Полные звёзды = целая часть
  $full  = floor($avg);
  // Процент заполнения частичной звезды
  $frac  = $avg - $full; // 0.74 из 4.74
  $pct   = round($frac * 100); // 74%
  $empty = 5 - $full - ($pct > 0 ? 1 : 0);

  $gold  = 'style="color:#c9a84c!important;font-size:15px;line-height:1;display:inline-block;"';
  $grey  = 'style="color:#ddd5c8!important;font-size:15px;line-height:1;display:inline-block;"';

  // Полные золотые
  $stars = str_repeat('<span '.$gold.'>★</span>', $full);

  // Частичная звезда через наложение двух span
  if ($pct > 0) {
    $stars .= '<span style="position:relative;display:inline-block;font-size:15px;line-height:1;">'
      . '<span style="color:#ddd5c8!important;">★</span>'
      . '<span style="position:absolute;top:0;left:0;overflow:hidden;width:'.$pct.'%;color:#c9a84c!important;">★</span>'
      . '</span>';
  }

  // Пустые серые
  $stars .= str_repeat('<span '.$grey.'>★</span>', $empty);

  echo '<div class="wt-rate-bar" style="display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:3px!important;margin:4px 0 6px!important;float:none!important;">'
    . $stars
    . '<span style="font-size:12px;color:#9e8e7e;margin-left:2px;">('.$cnt.')</span>'
    . '</div>';
}, 4);
// Добавляем CSS для нашего блока
add_action('wp_head', function() { ?>
<style>


/* Убираем центрирование рейтинга от темы */
.woocommerce ul.products li.product .woocommerce-product-rating,
.woocommerce ul.products li.product .star-rating { text-align: left !important; margin-left: 0 !important; float: none !important; }
ul.products li.product .wt-rating-row * { box-sizing: border-box; }
/* Звезда должна быть inline-flex внутри flex-row */
.wt-rating-row .star-rating {
  display: inline-flex !important;
  position: relative !important;
  flex-shrink: 0 !important;
}
.wt-rating-row .star-rating::before {
  position: static !important;
  letter-spacing: 2px !important;
  color: #ddd5c8 !important;
}
.wt-rating-row .star-rating span {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  overflow: hidden !important;
  padding-top: 0 !important;
  line-height: inherit !important;
}
.wt-rating-row .star-rating span::before {
  position: static !important;
  letter-spacing: 2px !important;
  color: #c9a84c !important;
}
</style>
<?php }, 99);

// === JS-фикс: принудительные inline стили для звёзд в каталоге ===
add_action('wp_footer', function() {
  if (!is_shop() && !is_product_category() && !is_archive()) return;
  echo '<script>
  (function fix(){
    var bars = document.querySelectorAll(".wt-rate-bar");
    bars.forEach(function(b){
      b.style.setProperty("display","flex","important");
      b.style.setProperty("align-items","center","important");
      b.style.setProperty("justify-content","flex-start","important");
      b.style.setProperty("gap","4px","important");
      b.style.setProperty("flex-direction","row","important");
    });
    if(bars.length===0) setTimeout(fix,300);
  })();
  </script>';
});

// === ЦЕНА ЗА 100Г в каталоге ===
add_filter('woocommerce_get_price_html', function($price_html, $product) {
  if (is_product()) return $price_html;
  if (!$product->is_type('variable')) return $price_html;
  global $wpdb;
  $pid = $product->get_id();

  // Минимальная цена из мета (быстро, без загрузки вариантов)
  $min_price = (float)get_post_meta($pid, '_price', true);
  if ($min_price <= 0) {
    $min_price = (float)get_post_meta($pid, '_min_variation_price', true);
  }
  if ($min_price <= 0) return $price_html;

  // Минимальный вес из атрибутов вариантов через wpdb
  $weights = $wpdb->get_col($wpdb->prepare(
    "SELECT tm.meta_value FROM {$wpdb->postmeta} tm
     JOIN {$wpdb->posts} p ON p.ID = tm.post_id
     WHERE p.post_parent = %d AND p.post_type = 'product_variation'
     AND p.post_status = 'publish'
     AND tm.meta_key = 'attribute_pa_ves'
     AND tm.meta_value != ''
     ORDER BY CAST(tm.meta_value AS UNSIGNED) ASC
     LIMIT 1",
    $pid
  ));

  if (empty($weights)) return $price_html;
  $g = (int)preg_replace('/[^0-9]/','',$weights[0]);
  if ($g < 5 || $g > 2000) return $price_html;

  // Берём реальную цену минимального варианта
  $min_var_price = $wpdb->get_var($wpdb->prepare(
    "SELECT pm.meta_value FROM {$wpdb->postmeta} pm
     JOIN {$wpdb->postmeta} wm ON wm.post_id = pm.post_id AND wm.meta_key = 'attribute_pa_ves' AND wm.meta_value = %s
     JOIN {$wpdb->posts} p ON p.ID = pm.post_id
     WHERE p.post_parent = %d AND p.post_type = 'product_variation'
     AND p.post_status = 'publish'
     AND pm.meta_key = '_price'
     LIMIT 1",
    $weights[0], $pid
  ));

  $v_price = $min_var_price ? (float)$min_var_price : $min_price;
  if ($v_price <= 0) return $price_html;

  $p100 = round($v_price / $g * 100);
  if ($p100 <= 0) return $price_html;

  return '<span class="wt-price-100">' . wc_price($p100) . '</span><span class="wt-price-label">&nbsp;/ 100&nbsp;г</span>';
}, 10, 2);

// CSS для новой цены
add_action('wp_head', function() {
  if (!is_shop() && !is_product_category() && !is_archive()) return; ?>
<style>
.wt-price-100 { font-weight: 700; color: inherit; }
.wt-price-label { font-size: 12px; color: #9e8e7e; font-weight: 400; }
</style>
<?php });

// === ВСЕ КНОПКИ → "Купить" (кроме страницы товара) ===
add_filter('woocommerce_product_add_to_cart_text', function($text, $product) {
  if (is_product()) return $text; // на странице товара не трогаем
  return 'Купить';
}, 10, 2);