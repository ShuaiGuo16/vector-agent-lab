import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export function createSurfaceTexture(kind:'roof'|'road'){
  const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d')!;
  let seed=45;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const image=ctx.createImageData(512,512);
  for(let i=0;i<512*512;i++){const value=(kind==='roof'?105:65)+random()*20;image.data.set([value,value+2,value+4,255],i*4);}ctx.putImageData(image,0,0);
  if(kind==='roof'){
    ctx.strokeStyle='rgba(25,40,47,.23)';ctx.lineWidth=2;
    for(let x=0;x<=512;x+=128){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.moveTo(0,x);ctx.lineTo(512,x);ctx.stroke();}
    ctx.fillStyle='rgba(170,183,175,.16)';for(let i=0;i<60;i++)ctx.fillRect(random()*512,random()*512,random()*70,1);
  }
  const texture=new THREE.CanvasTexture(c);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(kind==='roof'?3:45,kind==='roof'?3:45);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

export function createSky(){
  return new THREE.Mesh(new THREE.SphereGeometry(1300,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 vDir;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      void main(){
        vec3 d=normalize(vDir);float h=max(d.y,0.);
        vec3 col=mix(vec3(.76,.35,.16),vec3(.045,.15,.265),smoothstep(0.,.6,h));
        col=mix(vec3(.27,.36,.44),col,smoothstep(-.09,.04,d.y));
        vec3 sun=normalize(vec3(-.65,.32,-.7));float s=max(dot(d,sun),0.);
        col+=vec3(1.,.42,.12)*pow(s,36.)*.38;
        col+=vec3(4.,2.6,1.3)*smoothstep(.99953,.99975,s);
        // Thin painted cloud layers: sky-only procedural noise, no volume marching.
        vec2 p=d.xz/max(.16,d.y+.15)*3.;float n=noise(p*vec2(.5,3.));n+=noise(p*vec2(1.,6.))*.3;
        float cloud=smoothstep(.66,.94,n)*smoothstep(.07,.17,d.y)*(1.-smoothstep(.35,.65,d.y));
        col=mix(col,vec3(.72,.47,.34),cloud*.32);
        gl_FragColor=vec4(col,1.);
      }`}));
}

// Combine anti-aliasing and a restrained film grade in one full-screen pass.
export class CinemaPass extends ShaderPass {
  constructor(){
    super({
      uniforms:THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader:FXAAShader.vertexShader,
      fragmentShader:FXAAShader.fragmentShader.replace('return texture( tex2D, uv );','return textureLod( tex2D, uv, 0.0 );').replace('gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );',`
        vec4 sampleColor=ApplyFXAA(tDiffuse,resolution.xy,vUv);
        vec3 c=sampleColor.rgb;
        float luma=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(luma),c,1.06);
        c=(c-.5)*1.065+.5;
        c+=vec3(-.009,.004,.012)*(1.-smoothstep(.1,.6,luma));
        c+=vec3(.012,.003,-.009)*smoothstep(.5,.9,luma);
        vec2 v=vUv-.5;float vignette=1.-.18*dot(v*vec2(1.,.8),v*vec2(1.,.8));
        gl_FragColor=vec4(clamp(c*vignette,0.,1.),sampleColor.a);
      `),
    });
  }
  resize(width:number,height:number,ratio:number){this.uniforms.resolution.value.set(1/(width*ratio),1/(height*ratio));}
}
