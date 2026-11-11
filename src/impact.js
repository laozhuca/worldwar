// Artillery impact animation player, from the supplied artillery-impact-pack (art: assets/fx/earth-impact.png).
// Adapted: prepareFrames is exported so the game's renderer can draw impacts in world space itself.
/** Dependency-free Canvas 2D impact player. Coordinates are screen-space ground anchors. */
export const FRAME_TIMES = Object.freeze([0, 0.016, 0.032, 0.05, 0.07, 0.09, 0.112, 0.135, 0.16, 0.186, 0.214, 0.244, 0.276, 0.31, 0.346, 0.384, 0.424, 0.466, 0.51, 0.56, 0.62, 0.69, 0.77, 0.87, 0.99, 1.13, 1.3, 1.5, 1.73, 1.99, 2.28, 2.6, 2.95, 3.33, 3.74, 4.18]);
export const DURATION = 4.6;
export function sampleImpact(time) {
  if (!Number.isFinite(time) || time < 0 || time >= DURATION) return null;
  let index=0;
  while(index<35 && time>=FRAME_TIMES[index+1]) index++;
  return {index, next:Math.min(index+1,35), blend:index<35?(time-FRAME_TIMES[index])/(FRAME_TIMES[index+1]-FRAME_TIMES[index]):0,
    opacity:Math.min(1,time/.035)*Math.min(1,(DURATION-time)/1.2)};
}
export function prepareFrames(atlas){const frames=[],rawFrames=[],offsets=[];const cell=atlas.width/6;for(let i=0;i<36;i++){let c=document.createElement('canvas');c.width=c.height=320;let g=c.getContext('2d');g.drawImage(atlas,(i%6)*cell,Math.floor(i/6)*cell,cell,cell,0,0,320,320);g.globalCompositeOperation='destination-in';let mask=g.createLinearGradient(0,0,320,0);mask.addColorStop(0,'transparent');mask.addColorStop(.1,'white');mask.addColorStop(.9,'white');mask.addColorStop(1,'transparent');g.fillStyle=mask;g.fillRect(0,0,320,320);mask=g.createLinearGradient(0,0,0,320);mask.addColorStop(0,'transparent');mask.addColorStop(.08,'white');mask.addColorStop(.88,'white');mask.addColorStop(1,'transparent');g.fillStyle=mask;g.fillRect(0,0,320,320);const pixels=g.getImageData(0,0,320,320).data;let bottom=0,sum=0,weight=0;for(let y=0;y<320;y++)for(let x=0;x<320;x++){const a=pixels[(y*320+x)*4+3];if(a>12)bottom=Math.max(bottom,y)}for(let y=Math.max(0,bottom-22);y<=bottom;y++)for(let x=0;x<320;x++){const a=pixels[(y*320+x)*4+3];if(a>12){sum+=x*a;weight+=a}}rawFrames.push(c);offsets.push({x:weight?160-sum/weight:0,y:bottom?304-bottom:0})}for(let i=0;i<36;i++){let x=0,y=0,w=0;for(let j=Math.max(0,i-2);j<=Math.min(35,i+2);j++){let k=3-Math.abs(i-j);x+=offsets[j].x*k;y+=offsets[j].y*k;w+=k}let aligned=document.createElement('canvas');aligned.width=aligned.height=320;aligned.getContext('2d').drawImage(rawFrames[i],x/w,y/w);frames.push(aligned)}return frames}
export class ArtilleryImpactPlayer {
  static async load(imageUrl = new URL('./assets/earth-impact.png', import.meta.url)) {
    const atlas = new Image();
    atlas.crossOrigin='anonymous';
    await new Promise((resolve,reject)=>{atlas.onload=resolve;atlas.onerror=()=>reject(new Error('Could not load impact atlas: '+imageUrl));atlas.src=imageUrl;});
    return new ArtilleryImpactPlayer(prepareFrames(atlas));
  }
  constructor(frames, {maxImpacts=64}={}) {
    this.frames=frames; this.maxImpacts=maxImpacts; this.impacts=[];
    this.buffer=document.createElement('canvas');this.buffer.width=this.buffer.height=320;
    this.blendCtx=this.buffer.getContext('2d');
  }
  spawn(x,y,{scale=1,speed=1,flip=Math.random()<.5}={}) {
    if(![x,y,scale,speed].every(Number.isFinite)||scale<=0||speed<=0) throw new Error('Use finite coordinates and positive scale/speed.');
    const effect={x,y,scale,speed,flip,time:0};this.impacts.push(effect);
    if(this.impacts.length>this.maxImpacts)this.impacts.shift();
    return effect;
  }
  update(dt) {
    if(!Number.isFinite(dt)||dt<0)throw new Error('dt must be nonnegative seconds.');
    for(const p of this.impacts)p.time+=dt*p.speed;
    this.impacts=this.impacts.filter(p=>p.time<DURATION);
  }
  draw(ctx,{offsetX=0,offsetY=0}={}) {
    // Draw after terrain/units. Call your projection before spawn(), or move effect.x/y each tick.
    const b=this.blendCtx;
    for(const p of [...this.impacts].sort((a,b)=>a.y-b.y)) {
      const sample=sampleImpact(p.time);if(!sample)continue;
      b.clearRect(0,0,320,320);b.globalCompositeOperation='source-over';
      b.globalAlpha=1-sample.blend;b.drawImage(this.frames[sample.index],0,0);
      if(sample.next!==sample.index){b.globalCompositeOperation='lighter';b.globalAlpha=sample.blend;b.drawImage(this.frames[sample.next],0,0);}
      b.globalAlpha=1;b.globalCompositeOperation='source-over';
      const size=270*p.scale;
      ctx.save();ctx.translate(p.x+offsetX,p.y+offsetY);ctx.scale(p.flip?-1:1,1);
      ctx.globalCompositeOperation='source-over';ctx.globalAlpha*=sample.opacity;
      ctx.drawImage(this.buffer,-size*.5,-size*.95,size,size);ctx.restore();
    }
  }
  clear(){this.impacts.length=0;}
}
