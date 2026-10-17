(function(){
  var canvas=document.getElementById("bg-canvas"),ctx=canvas.getContext("2d");
  // ---- tunable knobs (one number each) ----
  var DUST_COUNT=110;    // floating dust motes
  var RAY_COUNT=4;       // vertical god-ray light shafts
  var RAY_OPACITY=0.16;  // brightness of a shaft
  var LIGHT_COUNT=18;    // distant flickering fixtures near the horizon
  var HAZE=0.9;          // strength of vanishing-point glow + edge vignette
  var FLOOR_LINES=18;    // perspective floor lines fanning from the vanishing point
  // -----------------------------------------
  var dust=[],lights=[],rays=[],W=0,H=0,vpX=0,horizonY=0,frame=0;
  function rand(a,b){return a+Math.random()*(b-a);}
  function build(){
    W=canvas.width;H=canvas.height;vpX=W*0.5;horizonY=H*0.52;
    dust=[];lights=[];rays=[];
    for(var i=0;i<DUST_COUNT;i++)dust.push({x:Math.random()*W,y:Math.random()*H,
      sx:rand(-0.12,0.12),sy:rand(-0.28,-0.03),r:rand(0.4,2.0),o:rand(0.04,0.32)});
    for(var l=0;l<LIGHT_COUNT;l++)lights.push({x:rand(W*0.12,W*0.88),
      y:horizonY+rand(-H*0.16,H*0.05),base:rand(0.12,0.45),r:rand(1.2,3.2),
      ph:Math.random()*6.28,sp:rand(0.012,0.05)});
    for(var g=0;g<RAY_COUNT;g++)rays.push({x:rand(W*0.15,W*0.85),w:rand(W*0.05,W*0.13),
      ph:Math.random()*6.28,sp:rand(0.004,0.009)});
  }
  function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;build();}
  function drawBase(){
    var g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,"#140f0a");g.addColorStop(0.5,"#1a1410");g.addColorStop(1,"#0d0906");
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  }
  function drawStructure(){
    // solid darker floor band below the horizon = clear ground plane
    var fg=ctx.createLinearGradient(0,horizonY,0,H);
    fg.addColorStop(0,"rgba(40,26,12,0.0)");fg.addColorStop(0.15,"rgba(34,22,10,0.55)");
    fg.addColorStop(1,"rgba(10,6,3,0.85)");
    ctx.fillStyle=fg;ctx.fillRect(0,horizonY,W,H-horizonY);
    // perspective floor lines fanning from the vanishing point down to the bottom edge
    ctx.strokeStyle="rgba(235,165,70,0.28)";ctx.lineWidth=1.2;
    var i;
    for(i=0;i<=FLOOR_LINES;i++){var fx=(i/FLOOR_LINES)*W;
      ctx.beginPath();ctx.moveTo(vpX,horizonY);ctx.lineTo(fx,H);ctx.stroke();}
    // receding horizontal floor lines (bunch up near the horizon)
    for(i=1;i<=9;i++){var t=i/9,y=horizonY+(H-horizonY)*(t*t);
      ctx.globalAlpha=0.85*(1-t*0.35);
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.globalAlpha=1;
    // bright horizon line where floor meets the far wall
    ctx.strokeStyle="rgba(255,185,90,0.40)";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,horizonY);ctx.lineTo(W,horizonY);ctx.stroke();
    // tall wall girders left & right, converging toward the vanishing point
    ctx.lineWidth=1.6;
    for(i=0;i<6;i++){var a=0.30*(1-i/6);
      ctx.strokeStyle="rgba(190,120,55,"+a+")";
      var lx=(i/6)*W*0.34;
      ctx.beginPath();ctx.moveTo(lx,0);ctx.lineTo(lx+(vpX-lx)*0.55,horizonY);ctx.stroke();
      var rx=W-(i/6)*W*0.34;
      ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(rx-(rx-vpX)*0.55,horizonY);ctx.stroke();}
  }
  function drawRays(){
    ctx.globalCompositeOperation="lighter";
    for(var i=0;i<rays.length;i++){var r=rays[i];
      var o=RAY_OPACITY*(0.65+0.35*Math.sin(frame*r.sp+r.ph));
      var g=ctx.createLinearGradient(r.x,0,r.x,H*0.85);
      g.addColorStop(0,"rgba(255,179,102,"+o+")");g.addColorStop(1,"rgba(255,179,102,0)");
      ctx.fillStyle=g;ctx.beginPath();
      ctx.moveTo(r.x-r.w/2,0);ctx.lineTo(r.x+r.w/2,0);
      ctx.lineTo(r.x+r.w*0.9,H*0.85);ctx.lineTo(r.x-r.w*1.1,H*0.85);
      ctx.closePath();ctx.fill();}
    ctx.globalCompositeOperation="source-over";
  }
  function drawLights(){
    ctx.globalCompositeOperation="lighter";
    for(var i=0;i<lights.length;i++){var L=lights[i];
      var o=L.base*(0.45+0.55*Math.sin(frame*L.sp+L.ph));
      var g=ctx.createRadialGradient(L.x,L.y,0,L.x,L.y,L.r*4);
      g.addColorStop(0,"rgba(255,166,60,"+o+")");g.addColorStop(1,"rgba(255,166,60,0)");
      ctx.beginPath();ctx.arc(L.x,L.y,L.r*4,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();}
    ctx.globalCompositeOperation="source-over";
  }
  function drawDust(){
    for(var i=0;i<dust.length;i++){var d=dust[i];d.x+=d.sx;d.y+=d.sy;
      if(d.y<-5){d.y=H+5;d.x=Math.random()*W;}
      if(d.x<-5)d.x=W+5;else if(d.x>W+5)d.x=-5;
      ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);
      ctx.fillStyle="rgba(222,180,120,"+d.o+")";ctx.fill();}
  }
  function drawHaze(){
    var vg=ctx.createRadialGradient(vpX,horizonY,0,vpX,horizonY,H*0.6);
    vg.addColorStop(0,"rgba(120,70,25,"+(0.25*HAZE)+")");vg.addColorStop(1,"rgba(120,70,25,0)");
    ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
    var eg=ctx.createRadialGradient(W/2,H/2,H*0.45,W/2,H/2,H*0.95);
    eg.addColorStop(0,"rgba(0,0,0,0)");eg.addColorStop(1,"rgba(0,0,0,"+(0.28*HAZE)+")");
    ctx.fillStyle=eg;ctx.fillRect(0,0,W,H);
  }
  function animate(){frame++;
    drawBase();drawStructure();drawRays();drawLights();drawDust();drawHaze();
    requestAnimationFrame(animate);}
  resize();window.addEventListener("resize",resize);animate();
})();
