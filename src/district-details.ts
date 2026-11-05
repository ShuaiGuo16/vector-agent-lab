import * as THREE from 'three';
import type { Building } from './city';

type Box=(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material)=>THREE.Mesh;
const material=(color:number,roughness=.8,metalness=.1)=>new THREE.MeshStandardMaterial({color,roughness,metalness});

export function decorateDistrict(scene:THREE.Scene,buildings:Building[],box:Box){
  const limestone=material(0x9b9585),frame=material(0x233945,.5,.4),paving=material(0x6e7c7b),wood=material(0x77624b),leaf=material(0x315d51);
  const solar=material(0x152d46,.22,.55),silver=material(0x7b949b,.3,.6);
  const warm=new THREE.MeshStandardMaterial({color:0xffb76b,emissive:0xffa45a,emissiveIntensity:2});
  const mint=new THREE.MeshStandardMaterial({color:0x8bdac9,emissive:0x72bfaf,emissiveIntensity:1.4});
  const glass=material(0x183f50,.22,.5);
  buildings.forEach((b,i)=>{
    const {x,z,w,d,h}=b;
    // Thin vertical fins and full-height mullions vary the facade silhouettes.
    if(i%3===0){
      for(let xx=-w/2+1;xx<w/2;xx+=4.4){box(x+xx,h/2,z-d/2-.12,.18,h,.35,limestone);box(x+xx,h/2,z+d/2+.12,.18,h,.35,limestone);}
    }else if(i%3===1){
      for(let xx=-w/2+1;xx<w/2;xx+=3.3){box(x+xx,h/2,z-d/2-.08,.065,h,.12,frame);box(x+xx,h/2,z+d/2+.08,.065,h,.12,frame);}
      for(let zz=-d/2+1;zz<d/2;zz+=3.3){box(x-w/2-.08,h/2,z+zz,.12,h,.065,frame);box(x+w/2+.08,h/2,z+zz,.12,h,.065,frame);}
    }else{
      for(let yy=5;yy<h-1;yy+=7){box(x,yy,z-d/2-.3,w+.5,.2,.8,limestone);box(x,yy,z+d/2+.3,w+.5,.2,.8,limestone);}
    }
    // Ground-floor lobby, awning and a warm illuminated entrance.
    box(x,1.65,z+d/2+.05,w*.55,3.3,.15,glass);
    box(x,3.2,z+d/2+1,8,.2,2.4,frame);
    box(x,2.7,z+d/2+.22,3,.07,.08,warm);
    for(const xx of [-2,2])box(x+xx,1.5,z+d/2+.2,.1,3,.12,silver);
    // Low parapets and maintenance details keep roof centers clear for flight.
    if((x===0&&z===12)||(x===-70&&z===-58)){
      // Open the driving exit of each course roof instead of driving through a parapet.
      const center=x===0?0:-10,gap=x===0?16:18;
      const leftEnd=Math.max(-w/2,center-gap/2),rightStart=Math.min(w/2,center+gap/2);
      if(leftEnd>-w/2)box(x+(-w/2+leftEnd)/2,h+.26,z-d/2+.35,leftEnd+w/2,.45,.45,paving);
      if(rightStart<w/2)box(x+(rightStart+w/2)/2,h+.26,z-d/2+.35,w/2-rightStart,.45,.45,paving);
    }else box(x,h+.26,z-d/2+.35,w,.45,.45,paving);
    box(x-w/2+.35,h+.26,z,.45,.45,d,paving);
    box(x+w/2-.35,h+.26,z,.45,.45,d,paving);
    box(x,h+.26,z+d/2-.35,w,.45,.45,paving);
    for(let k=0;k<3;k++){
      const panel=box(x-w/2+4+k*3.1,h+.52,z-d/2+5,2.8,.12,4.2,solar);panel.rotation.x=-.18;
      box(x-w/2+4+k*3.1,h+.28,z-d/2+5,2.9,.2,4.3,frame);
    }
    if(i%4===0){
      for(const dx of [-w/2+3,w/2-3]){
        box(x+dx,h+.45,z+d/2-4,3,.8,5,limestone);
        box(x+dx,h+1,z+d/2-4,2.6,.7,4.6,leaf);
        box(x+dx,h+.12,z+d/2-8,3,.18,1,wood);
      }
    }
    if(i%5===2){box(x,h-.9,z-d/2-.1,w,.06,.1,mint);box(x+w/2+.1,h-.9,z,.1,.06,d,mint);}
  });
  // Crosswalks and pavement accents are merged into a few static draws.
  const roadpaint=material(0xaba99b);
  for(const x of [-105,-35,35,105])for(const z of [-163,-93,-23,48,119]){
    for(let k=-3;k<=3;k++){box(x+k*1.7,.14,z-8,1,.035,2.8,roadpaint);box(x+k*1.7,.14,z+8,1,.035,2.8,roadpaint);}
  }
  const pole=material(0x263a40,.6,.6);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;const glowCtx=glowCanvas.getContext('2d')!;
  const gradient=glowCtx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(255,224,164,.8)');gradient.addColorStop(.15,'rgba(255,180,100,.3)');gradient.addColorStop(1,'rgba(255,180,100,0)');glowCtx.fillStyle=gradient;glowCtx.fillRect(0,0,64,64);
  const glowMat=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(glowCanvas),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:0xffcb89,opacity:.4});
  const poolMat=new THREE.MeshBasicMaterial({map:glowMat.map,color:0xffbf82,transparent:true,opacity:.12,depthWrite:false,blending:THREE.AdditiveBlending});
  for(const x of [-115,25,165])for(let z=-220;z<135;z+=70){
    box(x,3.4,z,.12,6.8,.12,pole);box(x+1,6.8,z,2,.1,.12,pole);box(x+1.85,6.76,z,.6,.08,.4,warm);
    const glow=new THREE.Sprite(glowMat);glow.position.set(x+1.85,6.8,z);glow.scale.set(3,3,1);scene.add(glow);
    // Fake warm pools need no extra dynamic lights or shadow maps.
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(11,13),poolMat);pool.rotation.x=-Math.PI/2;pool.position.set(x+1.85,.17,z);scene.add(pool);
  }
  // Large, restrained district lettering supplies landmarks without busy UI.
  const signs=[{text:'SOLIS',x:-70,z:12,color:'#ffe3b3'}, {text:'H A R B O R',x:70,z:84,color:'#9ce5d7'}, {text:'NORTH / 04',x:140,z:-128,color:'#d7e1dc'}];
  for(const s of signs){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;
    ctx.font='500 74px Arial';ctx.fillStyle=s.color;ctx.textAlign='center';ctx.fillText(s.text,512,92);
    const building=buildings.find(b=>b.x===s.x&&b.z===s.z)!;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(15,1.875),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));mesh.position.set(s.x,building.h-2,s.z+building.d/2+.55);scene.add(mesh);
  }
  // A distant suspension bridge gives the waterfront a recognizable horizon.
  const bridge=material(0x536a75);
  box(-250,10,-110,9,1,270,bridge);
  for(const z of [-195,-25]){
    for(const x of [-255,-245])box(x,24,z,1.4,48,2,bridge);
    box(-250,44,z,12,1.2,2,bridge);
  }
  for(let z=-230;z<15;z+=10){
    const y=13+29*Math.abs(Math.cos((z+195)/170*Math.PI));
    for(const x of [-254,-246])box(x,(y+10)/2,z,.08,Math.max(1,y-10),.08,bridge);
  }
  for(const x of [-254,-246]){
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,18,-245),new THREE.Vector3(x,43,-195),new THREE.Vector3(x,15,-110),new THREE.Vector3(x,43,-25),new THREE.Vector3(x,18,25)]);
    const cable=new THREE.Mesh(new THREE.TubeGeometry(curve,64,.13,4,false),bridge);scene.add(cable);
  }
}
