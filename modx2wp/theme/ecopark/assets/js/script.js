$(function() {
  var w=$(window).width(),h=$(window).height(),anivoffset=50,nsld=1,scr=0,scrollw=0,safari=false;

  //var iphone = /iPhone|IPHONE|iphone|iPad|IPAD|ipad/.test(navigator.platform);
  var iphone = /iphone|ipad/.test(navigator.platform.toLowerCase());
  if (/safari/.test(navigator.userAgent.toLowerCase())) {
    if (/apple/.test(navigator.vendor.toLowerCase())) {
        $('body').addClass('sfr');
        safari=true;
    }
  }

  if (w>=768) {
    nsld=2;
    anivoffset=150;
  }
  if (w>=1200) {
    nsld=3;
    anivoffset=150;
  }

  $('.btn').each(function(){
    var t=$(this);
    t.html( '<span>'+t.html()+'</span>' );
  });

  /*$('.shppwin').click(function(e){
    e.preventDefault();
    $('.ppwinbg,.ppwin.mes').addClass('sh');
  });
  $('.shppwintel').click(function(e){
    e.preventDefault();
    $('.ppwinbg,.ppwin.meswtel').addClass('sh');
  });*/
  $('.ppwin .close').click(function(){
    $('.ppwinbg,.ppwin').removeClass('sh');
  });

  $('.ppmenubtn').click(function(){
    $('.ppmenu').addClass('sh');
  });
  $('.ppmenu .close').click(function(){
    $('.ppmenu').removeClass('sh');
  });

  /* Get Real ScrollW */
  setTimeout(function(){
    w=$(window).width();
    $('body').css('overflow','hidden');
    scrollw = $(window).width() - w;
    $('body').css('overflow','');
  },100);

  $('.allanim > *').each(function(){
      var t=$(this),p=t.parent();
      if (p.hasClass('frombottom')) t.addClass('anim frombottom');
      if (p.hasClass('opac')) t.addClass('anim opac');
  });
  function animation(setw1) {
    var w1=window.pageYOffset,w2=w1;
    if (!isNaN(setw1)) {
      if (setw1>=0) w1 = setw1;
    }
    h=$(window).height();
    w2=w1+h;
    $('.anim').each(function(){
      var th=$(this),p1=th.offset().top,p2=p1+(th.height()/2),dofs=0,dtemp=0;
      dofs = Number(th.attr('of'));
      if (nsld=1) {
          dtemp = Number(th.attr('ofm'));
          if (!isNaN(dtemp)) dofs = dtemp;
      }
      if (nsld=2) {
          dtemp = Number(th.attr('oft'));
          if (!isNaN(dtemp)) dofs = dtemp;
      }
      if (nsld=3) {
          dtemp = Number(th.attr('ofd'));
          if (!isNaN(dtemp)) dofs = dtemp;
      }
      if (isNaN(dofs)) dofs=0;
      if ((w2-anivoffset+dofs)>=p2) {
        if (!th.hasClass('sh')) {
          th.addClass('sh').addClass('an');
          setTimeout(function(){ th.removeClass('an'); },1000);
          setTimeout(function(){ th.addClass('fin'); },3000);
        }
      }
    });
  }
  setTimeout(animation(-1),400);
  $('body').spanimotion();

  $(window).resize(function(){
    w=$(window).width(),h=$(window).height();
    $('.ppmenu .menuin .lf > ul > li').removeClass('hvr');
    $('.header .bron,.header .tel').css('right','');
    setTimeout(function(){
      if ((w<768)&&(nsld!=1)) {
        nsld=1;
        anivoffset=50;
      }
      if ((w>=768)&&(w<1200)&&(nsld!=2)) {
        nsld=2;
        anivoffset=150;
      }
      if ((w>=1200)&&(nsld!=3)) {
        nsld=3;
        anivoffset=150;
      }
    },300);
  }).scroll(function(){
    var w1=window.pageYOffset,w2=w1,a=0;
    h=$(window).height();w2=w1+h;
    //animation(w1);

    if (window.pageYOffset > 100) {
      //$('.header .mlogo, .header .tpcont, .header > p:first-child').addClass('dw');
    } else {
      //$('.header .mlogo, .header .tpcont, .header > p:first-child').removeClass('dw');
    }
    //animove();
    animation(w1);
    scr = window.pageYOffset;
  });


$(window).resize(function(){
  w=$(window).width();
  wh=$(window).height();
  //headersize();
});
//headersize();




  /* /VideoHeadBlock */
  $('.posbutton').click(function(){
		var target = $(this).attr('href');
        $('html, body').animate({scrollTop: $(target).offset().top-50}, 1000);
        $('.header .mlogo,.ppmenu').removeClass('sh');
        return false;
	});
  $('.totop').click(function(e){
    $('html, body').animate({scrollTop: 0}, 1000);
    return false;
  });

  /* Start */
  //$('input[name=tel]').inputmask('+7 (999) 999-99-99');
  $('input[type=text],textarea').keyup(function(){
      if( $(this).val() == ""){
        $(this).removeClass("fl");
      } else{
        $(this).addClass("fl");
      }
  });
  var ench=true;
  $('.check').click(function(){
    var inp = $(this).find('input');
    if (!ench) return false;
    ench=false;
    inp.prop('checked',!inp.prop('checked'));
    setTimeout(function(){
      ench=true;
    },500);
  });
    
    
    $('.shwin').click(function(e){
        e.preventDefault();
        
        let t=$(this),act=t.find('.act').html(),txt=t.find('.txt').html();
        
        $('.ppwin.mes form input[name=action]').val(act);
        $('.ppwin.mes form input[name=details]').val(txt);
        
        $('.ppwin.mes, .ppwinbg').addClass('sh');
        
        return false;
    });
    $('.shwintel').click(function(e){
        e.preventDefault();
        
        let t=$(this),act=t.find('.act').html(),txt=t.find('.txt').html();
        
        $('.ppwin.meswtel form input[name=action]').val(act);
        $('.ppwin.meswtel form input[name=details]').val(txt);
        
        $('.ppwin.meswtel, .ppwinbg').addClass('sh');
        
        return false;
    });
    
    
    $('.ppwin.thanks .btn').click(function(){
        $('.ppwin,.ppwinbg').removeClass('sh');
    });
    $('.ppwin.mes form').submit(function(e){
        var t=$('.ppwin.mes'),er=false,f=t.find('input[name=fio]').val(),addr=t.find('input[name=addr]').val(),m=t.find('input[name=mes]').val(),ra=t.find('input[name=realaddr]').val();
        e.preventDefault();
        t.find('input[type=text]').removeClass('err');
        if (f=='') {
            t.find('input[name=fio]').addClass('err');
            er=true;
        }
        if (addr=='') {
            t.find('input[name=addr]').addClass('err');
            er=true;
        }
        if (!t.find('.check input').prop('checked')) {
            alert("Вы должны принять\r\n пользовательское соглашение.");
            er=true;
        }
        if (er) return false;

        SP.stdreq({
            url:'/req.html',
            req:'msend',
            data:{f:f,a:addr,m:m,ra:ra,ac:t.find('input[name=action]').val(),d:t.find('input[name=details]').val()},
            complete:function(a) {
                if (a.r) {
                    $('.ppwin').removeClass('sh');
                    $('.ppwin.thanks, .ppwinbg').addClass('sh');
                    setTimeout(function(){
                        $('.ppwin,.ppwinbg').removeClass('sh');
                    },5000);
                    t.find('input[type=text]').removeClass('err').val('');
                }
            }
        });
        return false;
    });
    $('.ppwin.meswtel form').submit(function(e){
        var t=$('.ppwin.meswtel'),er=false,f=t.find('input[name=fio]').val(),tel=t.find('input[name=tel]').val(),m=t.find('input[name=mes]').val(),ra=t.find('input[name=realaddr]').val();
        e.preventDefault();
        t.find('input[type=text]').removeClass('err');
        if (f=='') {
            t.find('input[name=fio]').addClass('err');
            er=true;
        }
        if (tel=='') {
            t.find('input[name=tel]').addClass('err');
            er=true;
        }
        if (!t.find('.check input').prop('checked')) {
            alert("Вы должны принять\r\n пользовательское соглашение.");
            er=true;
        }
        if (er) return false;

        SP.stdreq({
            url:'/req.html',
            req:'msendtel',
            data:{f:f,t:tel,m:m,ra:ra,ac:t.find('input[name=action]').val(),d:t.find('input[name=details]').val()},
            complete:function(a) {
                if (a.r) {
                    $('.ppwin').removeClass('sh');
                    $('.ppwin.thanks, .ppwinbg').addClass('sh');
                    setTimeout(function(){
                        $('.ppwin,.ppwinbg').removeClass('sh');
                    },5000);
                    t.find('input[type=text]').removeClass('err').val('');
                }
            }
        });
        return false;
    });
    
    $('.mailblock form').submit(function(e){
        var t=$(this),er=false,f=t.find('input[name=fio]').val(),addr=t.find('input[name=adr]').val(),ra=t.find('input[name=realaddr]').val();
        e.preventDefault();
        t.find('input[type=text]').removeClass('err');
        if (f=='') {
            t.find('input[name=fio]').addClass('err');
            er=true;
        }
        if (addr=='') {
            t.find('input[name=addr]').addClass('err');
            er=true;
        }
        if (!t.find('.check input').prop('checked')) {
            alert("Вы должны принять\r\n пользовательское соглашение.");
            er=true;
        }
        if (er) return false;
        SP.stdreq({
            url:'/req.html',
            req:'subscribe',
            data:{f:f,a:addr,ra:ra},
            complete:function(a) {
                if (a.r) {
                    $('.ppwin.thanks, .ppwinbg').addClass('sh');
                    setTimeout(function(){
                        $('.ppwin,.ppwinbg').removeClass('sh');
                    },5000);
                    t.find('input[type=text]').removeClass('err').val('');
                }
            }
        });
        return false;
    });
    
    $('.ppwin.mes').click(function(e){
        let el = $(e.target);
        if ( el.hasClass('ppwin') || el.hasClass('tbl') || el.hasClass('tbc') ) {
            $('.ppwin.mes .close').trigger('click');
        }
    });
    
  //Sliders
  $('.header .topslider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:true,
      loopedSlides:3,
      slidesPerView:1,
      spaceBetween: 0,
      touchRatio: 0.2,
      autoplay: {
        delay: 6000,
      },
    });
    setTimeout(function(){
      swiper.update();
    },300);
  });
  $('.calendar .events .slider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:true,
      loopedSlides:4,
      slidesPerView:3,
      spaceBetween: 40,
      touchRatio: 0.2,
      navigation: {
        prevEl: t.find('.prev'),
        nextEl: t.find('.next')
      },
      breakpoints: {
        1200: {
          slidesPerView:2,
          spaceBetween: 20
        },
        768: {
          slidesPerView:1,
          spaceBetween: 0
        }
      }
    });
    setTimeout(function(){
      swiper.update();
    },200);
  });

  $('.services .slider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:false,
      slidesPerView:3,
      spaceBetween: 40,
      touchRatio: 0.2,
      navigation: {
        prevEl: t.find('.prev'),
        nextEl: t.find('.next')
      },
      breakpoints: {
        1200: {
          slidesPerView:2,
          spaceBetween: 20
        },
        768: {
          slidesPerView:1,
          spaceBetween: 0
        }
      }
    });
    setTimeout(function(){
      swiper.update();
    },200);
  });

  $('.otzv .slider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:false,
      slidesPerView:4,
      spaceBetween: 0,
      touchRatio: 0.2,
      breakpoints: {
        1200: {
          slidesPerView:2
        },
        768: {
          slidesPerView:1
        }
      }
    });
    setTimeout(function(){
      swiper.update();
      $('.otzv .slider .swiper-slide a').click(function(e){
        e.preventDefault();
        $(this).css('display','none');
        $(this).parent().find('.hid').slideDown();
        return false;
      });
    },200);
  });

  $('.roomheader').each(function(){
    var t=$(this),sldcnt=t.find('.thumbs .swiper-slide').length,
    b=new Swiper(t.find('.sld .swiper-container'),{
      loop:true,
      loopedSlides:6,
      slidesPerView:1,
      spaceBetween: 0,
      touchRatio: 0.2,
      /*navigation: {
        prevEl: t.find('.prev'),
        nextEl: t.find('.next')
      }*/
    }),
    a=new Swiper(t.find('.thumbs .swiper-container'),{
      loop:true,
      loopedSlides: 6,
      slidesPerView:3,
      touchRatio: 0.2,
      slideToClickedSlide:true,
      spaceBetween:20,
      centeredSlides:true,
      breakpoints: {
        1200: {
          spaceBetween:11,
          centeredSlides:true
        }
      }
    });
    a.controller.control = b;
    b.controller.control = a;
    setTimeout(function(){
      a.update();
      b.update();
    },1000);
    /*setTimeout(function(){
      $('.photosld .thumbs .swiper-slide').each(function(){
        var t=$(this);
        $('<div class="num"><p><span>'+(Number(t.attr('data-swiper-slide-index'))+1)+'</span> / '+sldcnt+'</p></div>').appendTo($(this));
      })
    },2000);*/
  });

  // /Sliders

  /*$('.topslider .slider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:true,
      loopedSlides:4,
      slidesPerView:1,
      spaceBetween: 0,
      touchRatio: 0.2,
      
      / *navigation: {
        prevEl: t.find('.prev'),
        nextEl: t.find('.next')
      },* /
      pagination: {
        clickable: true,
        el: t.find('.pag')
      },
      / *breakpoints: {
        768: {
          slidesPerView:1,
          spaceBetween: 0
        }
      }* /
    });
    setTimeout(function(){
      swiper.update();
    },200);
  });*/

  $('.imageslider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:true,
      loopedSlides:4,
      slidesPerView:1,
      spaceBetween: 0,
      touchRatio: 0.2,
      navigation: {
        prevEl: t.find('.prev'),
        nextEl: t.find('.next')
      }
    });
    setTimeout(function(){
      swiper.update();
    },200);
  });

  $('.preim .slider').each(function(){
    var t=$(this),s=t.find('.swiper-container'),swiper=new Swiper(s, {
      loop:true,
      loopedSlides:4,
      slidesPerView:1,
      spaceBetween: 0,
      touchRatio: 0.2,
      pagination: {
        clickable: true,
        el: t.find('.pag')
      },
      autoplay: {
        delay: 2000,
      },
    });
    setTimeout(function(){
      swiper.update();
    },200);
  });


  $('.ppmenu .menuin').slimScroll({
    //axis:'x',
    //height:'',
    width:'100%',
    allowPageScroll:false,
    applyVerticalWheelToHorizontal:true,
    alwaysVisible:true,
    railVisible:true,
    color:'#424242',
    railColor:'#242424',
    opacity:1,
    railOpacity:1,
    distance:'5px',
    touchScrollStep: 0.3
  });

  //$('body').spanimotion('init');
  
  $('.video div').on('mousedown',function(e){
    var t=$(this);
    t.data('c',{x:e.screenX,y:e.screenY});
  });
  $('.video div').on('mouseup',function(e){
    var t=$(this),p=t.parent();
    var c = t.data('c');

    c.x = c.x - e.screenX;
    c.y = c.y - e.screenY;

    if (c.x<0) c.x = c.x*-1;
    if (c.y<0) c.y = c.y*-1;

    if ((c.x<5)&&(c.y<5)) {//click
      //check YT or static video
      if (p.find('iframe').length>0) {
          var pid = p.find('iframe').attr('id');
          for (var ii=0;ii<=players.length-1;ii++) {
              if (players[ii][0]==pid) {
                  players[ii][1].playVideo();
                  break;
              }
          }
          t.fadeOut();
      } else {
        t.css('display','none');
        p.find('i').css('display','none');
        p.find('video').trigger('play');
      }
    }
  });

  /* Image Gallery */
  var pswpElement = $('.pswp')[0],gals=[], options = {
      getThumbBoundsFn: function(index) {
          var thumbnail = gals[options.galleryUID].items[index].el,
              pageYScroll = window.pageYOffset || document.documentElement.scrollTop,
              rect = thumbnail.getBoundingClientRect();
          //return {x:rect.left, y:rect.top + pageYScroll, w:rect.width};
          return {x:$(gals[options.galleryUID].items[index].el).offset().left, y:$(gals[options.galleryUID].items[index].el).offset().top+pageYScroll, w:$(gals[options.galleryUID].items[index].el).width(),h:$(gals[options.galleryUID].items[index].el).height()};
      }
  };
  function opengal(pswpElement,items,options) {
      gallery = new PhotoSwipe(pswpElement,PhotoSwipeUI_Default,items,options);
      gallery.init();
  }
  function creategal(galel,galels,om) {
      var t=$(galel),gal={};
      if (om==1) t=galel;
      if (t.length==0) return;
      var els = t.find(galels);
      if (els.length==0) return;
      gal.id=gals.length;
      gal.items=[];
      for (var i=0;i<=els.length-1;i++) {
          var gitm = els[i],
          a = $(gitm).find('a'),
          sz = a.attr('data-size').split('x'),
          itm = {
              src: a.attr('href'),
              w: parseInt(sz[0], 10),
              h: parseInt(sz[1], 10)
          },
          ttl = $(gitm).find('.title');
          if (ttl.length>0) {
              itm.title = ttl.html();
          }
          itm.el = gitm;
          a.attr('gl-i',gal.id).click(function(e){
              e.preventDefault();
              var t=$(this);
              options.galleryUID = Number(t.attr('gl-i'));
              options.index = Number(t.attr('gl-itmindx'));
              opengal(pswpElement,gals[options.galleryUID].items,options);
          });
          var b=false;
          for (var k=0;k<=gal.items.length-1;k++) {
            if (gal.items[k].src==itm.src) {
              b=true;
              a.attr('gl-itmindx',k);
            }
          }
          if (!b) {
            gal.items.push(itm);
            a.attr('gl-itmindx',(gal.items.length-1));
          }
      }
      if (gal.items.length>0) gals.push(gal);
      function parseurlstring(){
          var hash = window.location.hash.substring(1),
          params = {};
          if(hash.length < 5) {return;}
          var vars = hash.split('&');
          for (var i = 0; i < vars.length; i++) {
              if(!vars[i]) {
                  continue;
              }
              var pair = vars[i].split('=');
              if(pair.length < 2) {
                  continue;
              }
              params[pair[0]] = pair[1];
          }
          if(params.gid) {
              params.gid = parseInt(params.gid, 10);
          } else {return;}
          if(params.pid) {
              params.pid = parseInt(params.pid, 10);
          } else {return;}
          options.galleryUID = params.gid;
          options.index = params.pid;
          opengal(pswpElement,gals[options.galleryUID].items,options);
      }
      parseurlstring();
  }
  /*creategal('.gallery .gal.g1','.galitm');
  creategal('.gallery .gal.g2','.galitm');
  creategal('.gallery .gal.g3','.galitm');
  creategal('.gallery .gal.g4','.galitm');*/

  creategal('.roomheader .slider .sld','.swiper-slide');
  creategal('.image','.gallery');

});

function goymaps_local() {
  /*ymaps.ready(function(){
    var myMap1 = new ymaps.Map('ymap', {center:[56.337539, 40.988353],zoom:12,controls:[]},{searchControlProvider: 'yandex#search'});
    //PM1 = new ymaps.Placemark([56.337539, 40.988353], {}, {iconLayout: 'default#image',iconImageHref: 'template/img/PM.svg',iconImageSize: [60, 60], iconImageOffset: [-30, -30],balloonShadow: false});
    //myMap1.geoObjects.add(PM1);
  });*/
}

var ymti = setTimeout(function t1(){
  if (typeof ymaps === "undefined") ymti = setTimeout(t1,500);
  else goymaps_local();
},500);
