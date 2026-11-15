import * as THREE from 'three';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const canvas = $('#scene');
const COLORS = { glass:0x78d9fa, leaf:0x83ce56, void:0x24212c, gravity:0x9a78ef };
const INK_LABEL = {glass:'BLUE GLASS',leaf:'GREEN LEAF',void:'FLOATSTONE',gravity:'GRAVSTONE'};
const INK_NAMES = {glass:'Glass',leaf:'Leaf',void:'Floatstone',gravity:'Gravstone'};
const INK_TINT = {glass:'#69cdec',leaf:'#83ce56',void:'#24212c',gravity:'#9a78ef'};
const isMobile = matchMedia('(max-width:720px)').matches;
const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x171427);
scene.fog=new THREE.FogExp2(0x171427,.022);
const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,140);
camera.position.set(0,5.4,11.8);
const orbit={target:new THREE.Vector3(0,1.5,0),yaw:0,pitch:.16,radius:12.9};
let activeInk='glass',selected=null,eraseMode=false,depth=3.2,drawStart=null,drawLine=null,strokePoints=[],lastTap=0,lastHit=null;
let modalState=null,score=0,beasts=0,weapon=null,vrSession=null,handSources=[],handModels=[];
let simTime=0,triggerDown=false,settings={comfort:false,haptics:true,handTracking:true,shadows:true,sensitivity:1,volume:0.6};
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),clock=new THREE.Clock();
const objects=[],projectiles=[],particles=[],labels=[],controllerLines=[];
const inkGroup=new THREE.Group();scene.add(inkGroup);

// A warm, cinematic paper atelier: floating construction platform, drawn guide grid, and distant sketchy surroundings.
scene.add(new THREE.HemisphereLight(0xffefd7,0x35314e,1.75));
const keyLight=new THREE.DirectionalLight(0xffead0,3.2);keyLight.position.set(-5,11,7);keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);keyLight.shadow.camera.left=-12;keyLight.shadow.camera.right=12;keyLight.shadow.camera.top=12;keyLight.shadow.camera.bottom=-12;scene.add(keyLight);
const rimLight=new THREE.PointLight(0x8c74ff,24,26,2);rimLight.position.set(5,5,-4);scene.add(rimLight);
const floorMat=new THREE.MeshStandardMaterial({color:0xe9dcc4,roughness:.92});
const floor=new THREE.Mesh(new THREE.CircleGeometry(14,96),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-.09;floor.receiveShadow=true;scene.add(floor);
const stage=new THREE.Mesh(new THREE.CylinderGeometry(11,11.15,.22,96),new THREE.MeshStandardMaterial({color:0xd9c8a9,roughness:.8,metalness:.04}));stage.position.y=-.23;stage.receiveShadow=true;scene.add(stage);
const rim=new THREE.Mesh(new THREE.TorusGeometry(11,.07,8,120),new THREE.MeshStandardMaterial({color:0x9b83e9,emissive:0x403263,emissiveIntensity:.7,roughness:.4}));rim.rotation.x=Math.PI/2;rim.position.y=-.11;scene.add(rim);
const grid=new THREE.GridHelper(20,40,0x8d7b91,0xbaa995);grid.position.y=.025;grid.material.transparent=true;grid.material.opacity=.23;scene.add(grid);
// subtle floating paper flecks and stars
for(let i=0;i<75;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.012+Math.random()*.018,6,6),new THREE.MeshBasicMaterial({color:i%3===0?0xffb16b:0xe4cfff,transparent:true,opacity:.22+Math.random()*.3}));m.position.set((Math.random()-.5)*23,Math.random()*9+.2,(Math.random()-.5)*18-2);m.userData.phase=Math.random()*6.28;scene.add(m);particles.push({mesh:m,ambient:true});}

const mat=(color,rough=.4,metal=0,extra={})=>new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal,...extra});
const mats={
 glass:new THREE.MeshPhysicalMaterial({color:COLORS.glass,roughness:.12,metalness:.08,transmission:.22,thickness:.6,transparent:true,opacity:.78,clearcoat:1,clearcoatRoughness:.08,emissive:0x12313a,emissiveIntensity:.22}),
 leaf:new THREE.MeshStandardMaterial({color:COLORS.leaf,roughness:.82,side:THREE.DoubleSide,emissive:0x1d3b0d,emissiveIntensity:.12}),
 void:new THREE.MeshStandardMaterial({color:COLORS.void,roughness:.91,emissive:0x09080d,emissiveIntensity:.1}),
 gravity:new THREE.MeshStandardMaterial({color:COLORS.gravity,roughness:.46,metalness:.08,emissive:0x251342,emissiveIntensity:.3})
};
function makeMat(ink){return mats[ink].clone();}
function geometryForStroke(points,ink){
  if(points.length<2)return new THREE.SphereGeometry(.07,10,8);
  const curve=new THREE.CatmullRomCurve3(points);
  if(ink==='leaf') return new THREE.TubeGeometry(curve,Math.max(8,points.length*2),0.115,7,false);
  return new THREE.TubeGeometry(curve,Math.max(8,points.length*2),ink==='void'?.14:ink==='gravity'?.12:.105,9,false);
}
function createInkStroke(points,ink,{noQuest=false}={}){
  const clean=points.filter((p,i)=>i===0||p.distanceTo(points[i-1])>.035);
  if(clean.length<2)clean.push(clean[0].clone().add(new THREE.Vector3(.08,.02,0)));
  const mesh=new THREE.Mesh(geometryForStroke(clean,ink),makeMat(ink));
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.geometry.computeBoundingBox();
  const groundY=ink==='gravity'?.03-mesh.geometry.boundingBox.min.y:.03;
  mesh.userData={kind:'ink',ink,points:clean.map(p=>p.clone()),dynamic:ink==='gravity',vel:new THREE.Vector3(),name:`${INK_NAMES[ink]} stroke`,created:performance.now(),tear:0};
  const group=new THREE.Group();group.add(mesh);group.position.set(0,0,0);group.userData={...mesh.userData,parts:[mesh],groundY,convertible:ink!=='void',name:`${INK_NAMES[ink]} stroke`};inkGroup.add(group);objects.push(group);
  checkQuest('draw');checkQuest(`draw-${ink}`);if(!noQuest){score+=10;updateScore();}
  if(ink==='leaf')makeLeafVeins(group,clean);
  return group;
}
function makeLeafVeins(group,points){
  if(points.length<3)return;
  const n=Math.min(8,Math.floor(points.length/2));
  for(let i=0;i<n;i++){let p=points[Math.floor(i*(points.length-1)/n)];let a=p.clone().add(new THREE.Vector3(-.12,.12,0));let b=p.clone().add(new THREE.Vector3(.13,-.1,0));const vein=new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([a,b]),new THREE.LineBasicMaterial({color:0xd4f2a0,transparent:true,opacity:.55}));group.add(vein);}
}
function updateScore(){ $('#score').textContent=score.toLocaleString(); }
function setInk(ink){activeInk=ink;$$('.ink').forEach(b=>b.classList.toggle('active',b.dataset.ink===ink));$('#brush-readout').textContent=INK_LABEL[ink];$('#brush-readout').style.color=INK_TINT[ink];$('#brush-cursor').style.borderColor=INK_TINT[ink];}
function setDepth(v){depth=THREE.MathUtils.clamp(v,.8,8.5);$('#depth-label').textContent=`${depth.toFixed(1)}m`;$('#depth-tick').textContent=depth.toFixed(1);}
function toast(msg,type=''){const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<i class="ticon"></i><span>${msg}</span>`;$('#toasts').append(el);setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),320)},2600);}
function haptic(strength=.45,duration=45){if(!settings.haptics||!vrSession)return;for(const src of vrSession.inputSources){const acts=src.gamepad?.hapticActuators;if(acts?.[0]?.pulse)acts[0].pulse(strength,duration);}}
function updateCamera(){const cp=Math.cos(orbit.pitch),sp=Math.sin(orbit.pitch);camera.position.set(orbit.target.x+Math.sin(orbit.yaw)*orbit.radius*cp,orbit.target.y+sp*orbit.radius,orbit.target.z+Math.cos(orbit.yaw)*orbit.radius*cp);camera.lookAt(orbit.target);}
updateCamera();
function pointOnDrawPlane(clientX,clientY){pointer.x=clientX/innerWidth*2-1;pointer.y=1-clientY/innerHeight*2;raycaster.setFromCamera(pointer,camera);const normal=new THREE.Vector3(0,0,1).applyQuaternion(camera.quaternion);const center=camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),depth);const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,center);const p=new THREE.Vector3();raycaster.ray.intersectPlane(plane,p);return p;}
function updatePointer(clientX,clientY){const el=$('#brush-cursor');el.style.left=`${clientX}px`;el.style.top=`${clientY}px`;}
function hitTest(clientX,clientY){pointer.set(clientX/innerWidth*2-1,1-clientY/innerHeight*2);raycaster.setFromCamera(pointer,camera);const meshes=[];for(const o of objects){o.traverse(c=>{if(c.isMesh)c.userData.owner=o,meshes.push(c)});}const hits=raycaster.intersectObjects(meshes,false);return hits.length?hits[0]:null;}
function selectable(hit){return hit?.object?.userData?.owner||hit?.object?.parent?.userData?.kind?hit.object.userData.owner||hit.object.parent:null;}
function selectObject(obj){selected=obj;const card=$('#selection-card');if(!obj){card.hidden=true;return;}const type=obj.userData.type||'ink';$('#sel-name').textContent=obj.userData.name||'Ink sketch';$('#sel-sub').textContent=obj.userData.convertible===false?'floatstone cannot be converted':'double-tap to convert';$('#sel-color').style.background=INK_TINT[obj.userData.ink]||'#f6eedd';card.hidden=false;}

const questDefs=[['draw','Draw a stroke in your world'],['draw-glass','Paint with blue glass'],['draw-leaf','Try a green leaf stroke'],['draw-gravity','Draw something with gravity'],['convert','Convert an ink stroke'],['fire','Test a weapon on a creature']];
const doneQuests=new Set();function initQuests(){const ul=$('#quest-list');ul.innerHTML='';for(const [id,label] of questDefs){const li=document.createElement('li');li.dataset.quest=id;li.innerHTML=`<span class="qcheck"></span><span>${label}</span>`;ul.append(li);}}
function checkQuest(id){if(doneQuests.has(id))return;doneQuests.add(id);const li=$(`[data-quest="${id}"]`);if(li)li.classList.add('done');$('#quest-count').textContent=`${doneQuests.size}/${questDefs.length}`;if(doneQuests.size===questDefs.length)toast('All sketch trials complete! You are a true lineborn.','good');}
initQuests();

// Hand-drawn line and mesh helpers shared by conversion blueprints.
function tube(points,r,color,material=null,segments){const pts=points.map(p=>p.isVector3?p:new THREE.Vector3(...p));const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),segments||Math.max(8,pts.length*5),r,8,false);const m=new THREE.Mesh(g,material||mat(color,.55));m.castShadow=true;m.receiveShadow=true;return m;}
function line(points,color=0x302a39,r=.06){return tube(points,r,color);}
function sphere(pos,scale,color,material=null,detail=16){const m=new THREE.Mesh(new THREE.SphereGeometry(1,detail,12),material||mat(color,.48));m.position.set(...pos);m.scale.set(...scale);m.castShadow=true;m.receiveShadow=true;return m;}
function box(pos,size,color,material=null,bevel=.08){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),material||mat(color,.55));m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;return m;}
function cylinderBetween(a,b,r,color,material=null,radial=10){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),dir=bv.clone().sub(av);const m=new THREE.Mesh(new THREE.CylinderGeometry(r*.82,r,dir.length(),radial),material||mat(color,.5));m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());m.castShadow=true;return m;}
function makeCreatureArt(group,kind='rabbit',opts={}){
  const bodyColor=opts.color??0xefa78e, dark=0x302a39, accent=opts.accent??0xf6d8b2;
  const torso=sphere([0,1.25,0],[.83,.47,.42],bodyColor);group.add(torso);
  const head=sphere([.69,1.66,0],[.38,.36,.34],bodyColor);head.name='head';group.add(head);
  const muzzle=sphere([.96,1.54,.02],[.2,.15,.23],accent);group.add(muzzle);
  for(const z of [-.22,.22]){group.add(sphere([.81,1.79,z],[.055,.065,.045],dark));group.add(sphere([.83,1.81,z+.025],[.018,.021,.012],0xffffff));}
  group.add(sphere([1.13,1.57,.02],[.05,.035,.05],0xd95c69));
  if(kind==='rabbit'||kind==='dragon'||kind==='bird'){
    const e1=sphere([.55,2.14,-.17],[.15,.48,.12],bodyColor);e1.rotation.z=-.18;group.add(e1);
    const e2=sphere([.83,2.12,.17],[.14,.42,.12],bodyColor);e2.rotation.z=.12;group.add(e2);
    group.add(sphere([.56,2.16,-.17],[.075,.32,.065],0xf18f99));group.add(sphere([.84,2.13,.17],[.07,.27,.065],0xf18f99));
  }
  if(kind==='dragon'||kind==='bird'){
    const w1=sphere([-.12,1.55,-.56],[.68,.12,.43],accent);w1.rotation.z=.28;group.add(w1);
    const w2=sphere([-.12,1.55,.56],[.68,.12,.43],accent);w2.rotation.z=.28;group.add(w2);
    w1.name='wingL';w2.name='wingR';
  }
  const tail=line([[-.65,1.3,0],[-1.02,1.37,.02],[-1.32,1.6,.02]],accent,.09);tail.name='tail';group.add(tail);
  const legGroups=[];
  for(const x of [-.43,.42])for(const z of [-.25,.25]){const leg=new THREE.Group();leg.position.set(x,.98,z);const upper=cylinderBetween([0,0,0],[.01,-.38,0],.09,bodyColor);const knee=sphere([.01,-.4,0],[.105,.105,.1],accent);const lower=cylinderBetween([.01,-.4,0],[.08,-.78,.02],.065,bodyColor);const foot=sphere([.15,-.82,.05],[.2,.08,.13],accent);leg.add(upper,knee,lower,foot);leg.name=`limb-${legGroups.length}`;group.add(leg);legGroups.push(leg);}
  if(kind==='dragon'){const horn1=cone([.65,1.99,-.21],[.06,.22,.06],0xf7cb67);const horn2=cone([.91,1.97,.2],[.06,.2,.06],0xf7cb67);group.add(horn1,horn2);}
  if(kind==='bird'){const beak=cone([1.08,1.55,0],[.12,.22,.12],0xf5a847);beak.rotation.z=-Math.PI/2;group.add(beak);}
  group.userData.rig={head,tail,legs:legGroups,wings:group.children.filter(c=>c.name.startsWith('wing'))};
}
function cone(pos,scale,color){const m=new THREE.Mesh(new THREE.ConeGeometry(1,1,9),mat(color,.48));m.position.set(...pos);m.scale.set(...scale);m.castShadow=true;return m;}
function makeWeaponArt(group,kind='pistol',options={}){
  const dark=0x292333, metal=0xb3a7bf, accent=options.color||0x80dfff;
  if(kind==='sword'){
    const blade=box([.42,1.5,0],[1.15,.13,.16],0xb8dff1,mat(0xc9f0ff,.2,.55));blade.rotation.z=-.08;group.add(blade);
    const tip=cone([1.06,1.55,0],[.12,.18,.11],0xc9f0ff);tip.rotation.z=-Math.PI/2;group.add(tip);
    const guard=box([-.13,1.49,0],[.12,.56,.22],0xffc15d);guard.rotation.z=.05;group.add(guard);
    const handle=cylinderBetween([-.2,1.49,0],[-.72,1.49,0],.105,dark);group.add(handle);group.userData.sharpParts=[blade,tip];group.userData.handleParts=[handle];
  }else if(kind==='gatling'){
    const body=box([0,1.45,0],[1.18,.43,.48],dark,mat(dark,.32,.36));group.add(body);
    const barrel=box([.8,1.52,0],[.88,.17,.19],0x3e374b,mat(0x625c70,.27,.58));group.add(barrel);
    const drum=cylinderBetween([.22,1.14,0],[.22,1.65,0],.28,0x514b5d,mat(0x514b5d,.35,.45),16);group.add(drum);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;const b=cylinderBetween([.47,1.52+Math.sin(a)*.17,Math.cos(a)*.17],[1.2,1.52+Math.sin(a)*.17,Math.cos(a)*.17],.035,accent);group.add(b);}
    const grip=box([-.26,.96,.04],[.22,.62,.27],0x795b55);grip.rotation.z=-.17;group.add(grip);
    const trigger=torus([-.1,1.18,.25],.12,.025,0xffbb60);group.add(trigger);group.userData.handleParts=[grip];group.userData.sharpParts=[barrel];
  }else{
    const body=box([0,1.48,0],[.95,.38,.43],dark,mat(dark,.3,.42));group.add(body);
    const slide=box([.16,1.7,0],[.77,.16,.34],0x6e6679,mat(0x9b91a6,.25,.6));group.add(slide);
    const barrel=cylinderBetween([.44,1.72,0],[1.13,1.72,0],.095,0x26222f,mat(0x26222f,.28,.7),12);group.add(barrel);
    const grip=box([-.18,1.11,0],[.28,.6,.34],0x76504d);grip.rotation.z=-.13;group.add(grip);
    const trigger=torus([.09,1.28,.2],.12,.024,0xffbc5b);group.add(trigger);
    const mag=box([-.3,.78,0],[.22,.28,.25],0x4d4657);group.add(mag);group.userData.handleParts=[grip];group.userData.sharpParts=[barrel];
  }
  // ports / sights as visible sketched hardware
  group.add(box([-.36,1.73,.23],[.12,.08,.025],accent,mat(accent,.24,.25)));
}
function torus(pos,r,t,color){const m=new THREE.Mesh(new THREE.TorusGeometry(r,t,8,16),mat(color,.35,.18));m.position.set(...pos);return m;}
function makeVehicleArt(group,kind='buggy',options={}){
  const dark=0x292333, body=options.color||0x86cbea;
  const part=key=>{const g=new THREE.Group();g.userData.buildPart=key;group.add(g);return g;};
  if(kind==='tank'){
    group.add(box([0,1.08,0],[2.1,.55,.92],body,mat(body,.5,.18)));
    part('cockpit').add(box([-.15,1.52,0],[1.1,.35,.72],0x9ad6eb));
    group.add(cylinderBetween([.28,1.58,0],[1.5,1.58,0],.11,dark));
    const tracks=part('trackwheels');
    for(const z of [-.52,.52]){const track=new THREE.Mesh(new THREE.TorusGeometry(.62,.13,8,32),mat(0x302d38,.75,.2));track.position.set(-.05,.56,z);track.rotation.y=Math.PI/2;tracks.add(track);for(let i=0;i<5;i++){const w=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.1,16),mat(0x938a9c,.5,.3));w.position.set(-.7+i*.36,.56,z);w.rotation.x=Math.PI/2;tracks.add(w);}}
    const chain=part('chain');for(let i=0;i<8;i++){const link=box([-.65+i*.18,.42,.61],[.12,.07,.045],0xb58d54);link.rotation.z=(i%2?.2:-.2);chain.add(link);}
  }else if(kind==='plane'){
    group.add(box([0,1.15,0],[1.9,.32,.4],body,mat(body,.32,.12)));
    part('cockpit').add(box([-.1,1.27,0],[.56,.36,.34],0x9ce5f1));
    const wings=part('wings');wings.add(box([-.18,1.1,0],[.52,.12,2.55],0xffc268));
    const tail=part('tail');tail.add(box([-.78,1.15,0],[.42,.09,.92],body));tail.add(box([-.87,1.35,0],[.16,.5,.12],body));
    const prop=part('propeller');prop.position.set(1,1.16,0);prop.add(box([.08,0,0],[.42,.08,.1],dark),box([0,0,.08],[.1,.08,.42],dark));prop.name='propeller';
  }else{
    group.add(box([-.05,.94,0],[1.65,.42,.94],body,mat(body,.4,.12)));
    part('cockpit').add(box([-.25,1.45,0],[.82,.63,.78],0x9de4ed,mat(0x9de4ed,.16,.05,{transparent:true,opacity:.72})));
    group.add(box([-.22,1.83,0],[.88,.09,.9],dark));
    const wheels=part('trackwheels');
    for(const x of [-.63,.65])for(const z of [-.56,.56]){const wh=new THREE.Mesh(new THREE.CylinderGeometry(.26,.26,.18,18),mat(0x342f3d,.65,.25));wh.rotation.x=Math.PI/2;wh.position.set(x,.52,z);wheels.add(wh);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.2,12),mat(0xe6b35c,.3,.35));hub.rotation.x=Math.PI/2;hub.position.set(x,.52,z);wheels.add(hub);}
  }
  const seat=part('seat');group.userData.seat=box([-.26,1.22,0],[.44,.09,.36],0x634b57);seat.add(group.userData.seat);
}

const artSvgs={
 sword:'<path d="M16 43 57 8l-7 32-27 9M12 37l14 7m-17-2 14 7"/><path d="m21 41 28-28" stroke="#bfefff"/>',
 pistol:'<path d="M9 18h42v12H29l-3 15H15l2-15H9z"/><path d="M51 21h16v6H51"/><path d="M36 31v8"/>',
 gatling:'<path d="M13 18h36v17H13zM49 22h19v9H49M23 35l-5 12h12l4-12"/><circle cx="30" cy="26" r="8"/><path d="M30 18v16m-8-8h16"/>',
 rabbit:'<ellipse cx="37" cy="34" rx="19" ry="13"/><circle cx="55" cy="25" r="10"/><path d="M51 16 49 3q8-2 9 13M60 16l7-10q6 5-2 15M23 44v12m23-12v12M20 35l-8 5m48-9 5 1"/>',
 dragon:'<path d="M14 37q15-24 34-4l14 2-9 8-16 1-13 9-7-8-9 1 4-9"/><path d="m31 35-5-20 18 13m0 8 12-18-1 20M22 44l-2 10m22-9 1 10"/>',
 bird:'<path d="M12 39q6-23 32-15 17 6 16 18-12 13-34 4z"/><path d="M32 31q9-22 25-18-2 16-18 25M59 34l13 3-13 5M24 47l-2 9m15-8 2 8"/>',
 buggy:'<path d="M8 37h55l-5-15H20zM19 22l7-11h20l8 11"/><circle cx="20" cy="42" r="8"/><circle cx="53" cy="42" r="8"/><path d="M28 17h17"/>',
 tank:'<path d="M10 28h55v14H10zM24 28l5-13h16l8 13M42 20h23"/><circle cx="21" cy="41" r="6"/><circle cx="54" cy="41" r="6"/>',
 plane:'<path d="M8 31h58l-9 5H17zM35 31 25 12l5-2 19 21m-9 0 12 13-4 2-19-15M14 29l-4-9 3-1 11 11"/>'
};
function svgIcon(key){return `<svg viewBox="0 0 76 60" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${artSvgs[key]||''}</svg>`;}
const blueprints={
 weapon:[{id:'sword',name:'Drawblade',desc:'Close-range · edge-markable',tags:['SHARP EDGE','MELEE'],art:'sword'},{id:'pistol',name:'Pocket popper',desc:'Semi-auto · 12 round magazine',tags:['PISTOL','RANGED'],art:'pistol'},{id:'gatling',name:'Gatling brush',desc:'Rapid fire · 48 round drum',tags:['GATLING','RAPID'],art:'gatling'}],
 animal:[{id:'rabbit',name:'Hopsketch',desc:'Agile · ears, tail & knees',tags:['ANIMAL','RIGGABLE'],art:'rabbit'},{id:'dragon',name:'Cloud drake',desc:'Wing hinges · tail & limbs',tags:['ANIMAL','WINGS'],art:'dragon'},{id:'bird',name:'Wingbeat',desc:'Light flyer · beak & wings',tags:['ANIMAL','FLIGHT'],art:'bird'}],
 vehicle:[{id:'buggy',name:'Doodle buggy',desc:'4 wheels · cockpit & seat',tags:['VEHICLE','DRIVE'],art:'buggy'},{id:'tank',name:'Track crawler',desc:'Track wheels · turret & chain',tags:['VEHICLE','TRACKS'],art:'tank'},{id:'plane',name:'Paperwing',desc:'Wings · tail & propeller',tags:['VEHICLE','FLIGHT'],art:'plane'}]
};
function openModal(html){$('#modal-root').innerHTML=`<div class="scrim"><div class="modal">${html}</div></div>`;$('#modal-root').querySelector('.scrim').addEventListener('pointerdown',e=>{if(e.target.classList.contains('scrim'))closeModal();});}
function closeModal(){modalState=null;$('#modal-root').innerHTML='';}
function modalHeader(eyebrow,title,sub){return `<div class="modal-head"><div class="titles"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p>${sub}</p></div><button class="x-btn" data-close aria-label="Close">×</button></div>`;}
function convertSelected(){if(!selected)return;if(selected.userData.convertible===false||selected.userData.ink==='void'){toast('Floatstone is too stubborn to convert.','warn');return;}checkQuest('convert');openConvertModal('animal');}
function openConvertModal(category='animal'){
  if(!selected)return;
  modalState={type:'convert',category};
  const title=category==='animal'?'What will you bring to life?':category==='weapon'?'Choose your weapon shape':'Choose your ride';
  const desc=category==='animal'?'Every body part can be tuned after conversion. Hostility is always your choice.':category==='weapon'?'Mark edges, set a grip, then take it for a test swing.':'Build your chassis, place your parts, and take the wheel.';
  const options=blueprints[category];
  const cards=options.map(o=>`<button class="build-card" data-blueprint="${o.id}"><div class="bc-icon">${svgIcon(o.art)}</div><h4>${o.name}</h4><p>${o.desc}</p><div class="bc-tag">${o.tags.map((t,i)=>`<span class="tag ${i===0?'hot':''}">${t}</span>`).join('')}</div></button>`).join('');
  openModal(`${modalHeader('CONVERSION BENCH',title,desc)}<div class="modal-body"><div class="ink-banner"><span class="swatch ${selected.userData.ink}"></span><div class="ib-text"><b>${INK_NAMES[selected.userData.ink]} sketch selected</b><span>your ink is the blueprint — the stroke will become the build</span></div><span class="ib-tip">double-tap made real ↗</span></div><div class="tabs">${[['animal','Creatures','01'],['weapon','Weapons','02'],['vehicle','Vehicles','03']].map(([id,n,num])=>`<button class="tab ${category===id?'active':''}" data-category="${id}">${n}<span class="n">${num}</span></button>`).join('')}</div><div class="cards">${cards}</div><div class="convert-foot"><span>Choose a blueprint · tune every hinge and part next</span><em>made of your own linework</em></div></div>`);
  $('#modal-root').querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
  $('#modal-root').querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>openConvertModal(b.dataset.category));
  $('#modal-root').querySelectorAll('[data-blueprint]').forEach(b=>b.onclick=()=>convertObject(category,b.dataset.blueprint));
}
function convertObject(type,kind){
  if(!selected)return;const old=selected,ink=old.userData.ink;const worldBox=new THREE.Box3().setFromObject(old);const center=worldBox.getCenter(new THREE.Vector3());
  const root=new THREE.Group();root.position.set(center.x,.05,center.z);root.userData={kind:'built',type,blueprint:kind,ink,convertible:true,name:'',hostile:false,parts:{},health:3,velocity:new THREE.Vector3(),age:0};
  const art=new THREE.Group();root.add(art);
  if(type==='animal')makeCreatureArt(art,kind,{color:ink==='glass'?0x7edbf3:ink==='leaf'?0x87ce5b:ink==='gravity'?0xa78bf2:0xb4aabf});
  if(type==='weapon')makeWeaponArt(art,kind,{color:COLORS[ink]});
  if(type==='vehicle')makeVehicleArt(art,kind,{color:ink==='glass'?0x7edbf3:ink==='leaf'?0x87ce5b:ink==='gravity'?0xa78bf2:0xc2b7c8});
  root.userData.art=art;root.userData.name=type==='animal'?blueprints.animal.find(x=>x.id===kind).name:type==='weapon'?blueprints.weapon.find(x=>x.id===kind).name:blueprints.vehicle.find(x=>x.id===kind).name;
  root.userData.parts=type==='weapon'?{sharp:kind==='sword',handle:true,trigger:kind!=='sword',bulletPort:kind!=='sword',magazine:kind==='pistol'?12:kind==='gatling'?48:0,ammo:kind==='pistol'?12:kind==='gatling'?48:0,rotating:kind==='gatling'}:type==='animal'?{skeleton:true,knees:true,limbs:true,ears:kind==='rabbit'||kind==='dragon',mouth:true,tail:true,wings:kind!=='rabbit',hostile:false}: {trackwheels:kind!=='plane',cockpit:true,seat:true,chain:kind==='tank',propeller:kind==='plane',wings:kind==='plane',tail:kind==='plane'};
   if(type==='vehicle')root.userData.availableParts=kind==='buggy'?['trackwheels','cockpit','seat']:kind==='tank'?['trackwheels','cockpit','seat','chain']:['cockpit','seat','propeller','wings','tail'];
  if(type==='animal'){root.userData.hostile=false;root.userData.name=kind==='rabbit'?'Hopsketch':kind==='dragon'?'Cloud drake':'Wingbeat';beasts++;}
  if(type==='weapon')root.userData.name=kind==='sword'?'Drawblade':kind==='pistol'?'Pocket popper':'Gatling brush';
  if(type==='vehicle')root.userData.name=kind==='buggy'?'Doodle buggy':kind==='tank'?'Track crawler':'Paperwing';
  scene.add(root);objects.push(root);inkGroup.remove(old);objects.splice(objects.indexOf(old),1);selectObject(root);score+=40;updateScore();haptic(.8,80);toast(`${root.userData.name} sketched into being!`,'good');openRigModal(root);
}

function openRigModal(root){
  const d=root.userData, type=d.type, animal=type==='animal', weaponType=type==='weapon';
  const vehicleLabels={trackwheels:d.blueprint==='tank'?'Track wheels':'Wheels',cockpit:'Cockpit',seat:'Seat',chain:'Chain',propeller:'Propeller',wings:'Wings',tail:'Tail'};
  const parts=animal?['Skeleton','Knees','Limbs','Ears','Mouth','Tail','Wings']:weaponType?['Sharp edge','Handle','Trigger','Bullet port','Rotating barrel']:d.availableParts.map(key=>vehicleLabels[key]);
  const toggles=parts.map(label=>{const key=label==='Wheels'?'trackwheels':label.toLowerCase().replaceAll(' ','');const status=label==='Sharp edge'?d.parts.sharp:label==='Handle'?d.parts.handle:label==='Trigger'?d.parts.trigger:label==='Bullet port'?d.parts.bulletPort:label==='Rotating barrel'?d.parts.rotating:d.parts[key]??true;return `<label class="part-toggle"><span>${label}</span><input type="checkbox" data-part="${key}" ${status?'checked':''}><i></i></label>`}).join('');
  const extras=animal?`<label class="field"><span>CREATURE NAME</span><input id="build-name" maxlength="24" value="${d.name}"></label><label class="part-toggle hostile-toggle"><span>Hostile to player</span><input type="checkbox" id="hostile-toggle"><i></i></label>`:weaponType?`<div class="weapon-controls"><button class="action-btn" id="reload-now">↻ Reload magazine</button><span>Ammo <b id="ammo-now">${d.parts.ammo||'—'}</b> / ${d.parts.magazine||'—'}</span><p>Equip this weapon by selecting it, then fire with click or trigger.</p></div>`:`<div class="vehicle-controls"><button class="action-btn" id="drive-now">⌁ Take the wheel</button><p>WASD to drive · space to hop · click to place components.</p></div>`;
  openModal(`${modalHeader('BUILD TUNING',`${d.name} · ${type}`,animal?'Set the rig, then decide how your creature treats the world.':'Every hinge and component can be toggled or tuned.') }<div class="modal-body rig-body"><div class="rig-grid">${toggles}</div>${extras}<div class="convert-foot"><span>Changes are live in your sandbox</span><button class="action-btn" data-done>Done</button></div></div>`);
  $('#modal-root').querySelector('[data-close]').onclick=closeModal;$('#modal-root').querySelector('[data-done]').onclick=closeModal;
  $('#modal-root').querySelectorAll('[data-part]').forEach(input=>input.onchange=()=>{const key=input.dataset.part;d.parts[key]=input.checked;if(type==='vehicle'){const part=d.art.children.find(child=>child.userData.buildPart===key);if(part)part.visible=input.checked;}toast(`${key} ${input.checked?'enabled':'removed'}`);});
  if(animal){const host=$('#hostile-toggle');host.checked=d.hostile;host.onchange=()=>{d.hostile=host.checked;d.parts.hostile=host.checked;toast(host.checked?'Creature will attack nearby targets.':'Creature is friendly.');};$('#build-name').onchange=e=>{d.name=e.target.value.trim()||'Unnamed creature';selectObject(root);};}
  if(weaponType){$('#reload-now').onclick=()=>reloadWeapon(root);}
  if(type==='vehicle')$('#drive-now').onclick=()=>{d.driving=!d.driving;toast(d.driving?'Drive controls enabled':'Vehicle parked');};
}
function reloadWeapon(w){const p=w.userData.parts;if(!p.magazine)return; p.ammo=p.magazine;$('#ammo-now').textContent=p.ammo;updateWeaponHud(w);toast('Fresh ink magazine loaded.');}
function updateWeaponHud(w=weapon){const box=$('#weapon-hud');if(!w||w.userData.type!=='weapon'){box.hidden=true;return;}const p=w.userData.parts;box.hidden=false;$('#wpn-name').textContent=w.userData.name.toUpperCase();$('#wpn-ammo').textContent=p.magazine?p.ammo:'∞';$('#wpn-mag').textContent=p.magazine?`/ ${p.magazine}`:'MELEE';}
function openHelp(){openModal(`${modalHeader('FIELD NOTES','How to play','Everything in this world starts with a line.') }<div class="modal-body help-body"><div class="help-row"><kbd>Drag</kbd><span>Draw in 3D space. Pick an ink first; the scroll wheel sets drawing depth.</span></div><div class="help-row"><kbd>1–4</kbd><span>Choose blue glass, green leaf, black Floatstone, or purple Gravstone.</span></div><div class="help-row"><kbd>Double-click</kbd><span>Convert selected ink into a creature, weapon, or vehicle. Floatstone cannot be converted.</span></div><div class="help-row"><kbd>Right-drag</kbd><span>Orbit the atelier. WASD moves your active vehicle; R reloads a weapon.</span></div><div class="help-row"><kbd>Click</kbd><span>Select or equip a build. Click again to fire an equipped firearm; use X for erase mode.</span></div><p class="fine-print">VR requires a WebXR-compatible browser and headset. Hand tracking and controller haptics are used only when the device exposes them.</p><div class="convert-foot"><span>Make something strange, then see what it can do.</span><button class="action-btn" data-done>Got it</button></div></div>`);$('#modal-root').querySelector('[data-close]').onclick=closeModal;$('#modal-root').querySelector('[data-done]').onclick=closeModal;}
function openSettings(){openModal(`${modalHeader('YOUR ATELIER','Settings','Tune comfort and input to your device.') }<div class="modal-body settings-body"><label class="part-toggle"><span>Comfort camera mode</span><input type="checkbox" data-setting="comfort" ${settings.comfort?'checked':''}><i></i></label><label class="part-toggle"><span>Haptic vibration</span><input type="checkbox" data-setting="haptics" ${settings.haptics?'checked':''}><i></i></label><label class="part-toggle"><span>Hand tracking</span><input type="checkbox" data-setting="handTracking" ${settings.handTracking?'checked':''}><i></i></label><label class="part-toggle"><span>Soft shadows</span><input type="checkbox" data-setting="shadows" ${settings.shadows?'checked':''}><i></i></label><label class="field"><span>POINTER SENSITIVITY <b id="sens-label">${settings.sensitivity.toFixed(1)}×</b></span><input type="range" min="0.4" max="2" step="0.1" value="${settings.sensitivity}" id="sensitivity"></label><label class="field"><span>AMBIENT VOLUME <b id="volume-label">${Math.round(settings.volume*100)}%</b></span><input type="range" min="0" max="1" step="0.05" value="${settings.volume}" id="volume"></label><div class="convert-foot"><span>Browser/device permissions remain under your control.</span><button class="action-btn" data-done>Save</button></div></div>`);
  $('#modal-root').querySelector('[data-close]').onclick=closeModal;$('#modal-root').querySelector('[data-done]').onclick=closeModal;
  $('#modal-root').querySelectorAll('[data-setting]').forEach(i=>i.onchange=()=>{settings[i.dataset.setting]=i.checked;if(i.dataset.setting==='shadows')renderer.shadowMap.enabled=i.checked;});
  $('#sensitivity').oninput=e=>{settings.sensitivity=+e.target.value;$('#sens-label').textContent=`${settings.sensitivity.toFixed(1)}×`;};$('#volume').oninput=e=>{settings.volume=+e.target.value;$('#volume-label').textContent=`${Math.round(settings.volume*100)}%`;};
}

function impactObject(obj,force=1){if(!obj||!objects.includes(obj))return;const ink=obj.userData.ink;if(ink==='glass'){burst(obj,12,0x9feaff);removeObject(obj);toast('Glass sketch shattered!');return;}if(ink==='leaf'){const mesh=obj.children.find(c=>c.isMesh);if(mesh){mesh.material=mesh.material.clone();mesh.material.transparent=true;mesh.material.opacity=.35;mesh.scale.multiplyScalar(.82);}obj.userData.tear=(obj.userData.tear||0)+1;haptic(.3,40);if(obj.userData.tear>2)removeObject(obj);return;}if(obj.userData.type==='animal'){obj.userData.health--;obj.userData.velocity.x+=(Math.random()-.5)*force*3;obj.userData.velocity.z+=(Math.random()-.5)*force*2;if(obj.userData.health<=0){burst(obj,18,0xf4bd87);removeObject(obj);toast('Creature returned to a sketch.');}else toast(`${obj.userData.name} startled · ${obj.userData.health} vitality`);return;}if(obj.userData.ink==='gravity'){obj.userData.vel.y=Math.max(obj.userData.vel.y||0,force*2);}}
function removeObject(obj){scene.remove(obj);inkGroup.remove(obj);const idx=objects.indexOf(obj);if(idx>=0)objects.splice(idx,1);if(selected===obj)selectObject(null);}
function burst(obj,count,color){const box3=new THREE.Box3().setFromObject(obj);const c=box3.getCenter(new THREE.Vector3());for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.IcosahedronGeometry(.035+Math.random()*.07,0),new THREE.MeshBasicMaterial({color,transparent:true}));m.position.copy(c);scene.add(m);particles.push({mesh:m,vel:new THREE.Vector3((Math.random()-.5)*4,Math.random()*4,(Math.random()-.5)*4),life:.7+Math.random()*.7});}haptic(.65,60);}
function fireWeapon(w){const d=w.userData;if(d.type!=='weapon')return;const p=d.parts;if(d.blueprint==='sword'){const origin=w.position.clone().add(new THREE.Vector3(0,1.4,0));const candidates=objects.filter(o=>o!==w&&o.userData.type==='animal');if(candidates.length)impactObject(candidates.sort((a,b)=>a.position.distanceTo(origin)-b.position.distanceTo(origin))[0],1.5);checkQuest('fire');return;}if(p.ammo<=0){toast('Empty magazine · press R to reload','warn');return;}p.ammo--;updateWeaponHud(w);const origin=new THREE.Vector3();w.getWorldPosition(origin);origin.y+=1.65;const dir=new THREE.Vector3(1,.08,0).applyQuaternion(w.quaternion).normalize();const projectile=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),new THREE.MeshBasicMaterial({color:d.ink==='glass'?0x9beaff:0xffd070}));projectile.position.copy(origin);scene.add(projectile);projectiles.push({mesh:projectile,vel:dir.multiplyScalar(d.blueprint==='gatling'?19:24),life:2,owner:w,checked:false});if(d.parts.rotating)d.art.rotation.x+=.45;checkQuest('fire');haptic(.35,28);}
function spawnEnemy(){const old=selected;const root=new THREE.Group();root.position.set((Math.random()-.5)*7,.05,-2-Math.random()*2);root.userData={kind:'built',type:'animal',blueprint:'dragon',ink:'leaf',convertible:true,name:'Mischief sketch',hostile:true,health:3,velocity:new THREE.Vector3(),age:0,parts:{},art:null};const art=new THREE.Group();root.add(art);makeCreatureArt(art,'dragon',{color:0xe98775,accent:0xffce73});root.userData.art=art;scene.add(root);objects.push(root);beasts++;selectObject(old);toast('A mischievous sketch wandered in.','warn');}

function startDraw(e){if(e.button!==undefined&&e.button!==0)return;if(e.target.closest('#hud')||$('#modal-root').firstElementChild)return;const hit=hitTest(e.clientX,e.clientY);if(eraseMode){const obj=selectable(hit);if(obj)removeObject(obj);return;}if(hit){const obj=selectable(hit);selectObject(obj);if(obj?.userData.type==='weapon'){weapon=obj;updateWeaponHud(obj);}const now=performance.now();if(now-lastTap<340&&lastHit===obj){if(obj?.userData.kind==='ink'||obj?.userData.type==='ink')convertSelected();else if(obj?.userData.type==='animal')openRigModal(obj);else if(obj?.userData.type==='weapon')fireWeapon(obj);}lastTap=now;lastHit=obj;return;}selectObject(null);if(weapon){fireWeapon(weapon);return;}drawStart={x:e.clientX,y:e.clientY};strokePoints=[pointOnDrawPlane(e.clientX,e.clientY)];drawLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(strokePoints),new THREE.LineBasicMaterial({color:COLORS[activeInk]}));scene.add(drawLine);canvas.setPointerCapture?.(e.pointerId);}
function moveDraw(e){updatePointer(e.clientX,e.clientY);if(drawStart){const p=pointOnDrawPlane(e.clientX,e.clientY);if(p&&p.distanceTo(strokePoints.at(-1))>.035){strokePoints.push(p);drawLine.geometry.dispose();drawLine.geometry=new THREE.BufferGeometry().setFromPoints(strokePoints);}}}
function endDraw(e){if(!drawStart)return;drawStart=null;scene.remove(drawLine);drawLine.geometry.dispose();drawLine.material.dispose();drawLine=null;if(strokePoints.length>1){const obj=createInkStroke(strokePoints,activeInk);selectObject(obj);if(activeInk==='gravity'){obj.userData.vel.y=-.6;obj.position.y=Math.max(obj.userData.groundY,.03);}}strokePoints=[];}

let orbitDrag=null,pinchPointers=new Map(),vehicleKeys=new Set();
window.addEventListener('pointerdown',e=>{if(e.target.closest?.('#hud')||$('#modal-root').firstElementChild)return;if(e.button===2){orbitDrag={x:e.clientX,y:e.clientY};e.preventDefault();return;}if(e.pointerType==='touch'){pinchPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinchPointers.size===2){drawStart=null;orbitDrag={two:true,dist:touchDistance(),mid:touchMid()};return;}}startDraw(e);});
window.addEventListener('pointermove',e=>{if(orbitDrag){if(orbitDrag.two&&pinchPointers.size>=2){const dist=touchDistance(),mid=touchMid();orbit.radius=THREE.MathUtils.clamp(orbit.radius+(orbitDrag.dist-dist)*.018,6,24);orbit.yaw+=(mid.x-orbitDrag.mid.x)*.006;orbit.pitch=THREE.MathUtils.clamp(orbit.pitch-(mid.y-orbitDrag.mid.y)*.006,-.25,1.05);orbitDrag={two:true,dist,mid};}else{orbit.yaw+=(e.clientX-orbitDrag.x)*.006*settings.sensitivity;orbit.pitch=THREE.MathUtils.clamp(orbit.pitch+(e.clientY-orbitDrag.y)*.005*settings.sensitivity,-.25,1.05);orbitDrag.x=e.clientX;orbitDrag.y=e.clientY;}updateCamera();return;}moveDraw(e);});
window.addEventListener('pointerup',e=>{if(e.pointerType==='touch'){pinchPointers.delete(e.pointerId);if(pinchPointers.size<2&&orbitDrag?.two)orbitDrag=null;}if(orbitDrag&&!orbitDrag.two){orbitDrag=null;return;}endDraw(e);});window.addEventListener('pointercancel',e=>{pinchPointers.delete(e.pointerId);orbitDrag=null;endDraw(e);});window.addEventListener('contextmenu',e=>{if(!e.target.closest?.('#hud'))e.preventDefault();});
function touchDistance(){const a=[...pinchPointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}
function touchMid(){const a=[...pinchPointers.values()];return{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};}
canvas.addEventListener('wheel',e=>{e.preventDefault();setDepth(depth+e.deltaY*.004);},{passive:false});
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;if(e.key>='1'&&e.key<='4')setInk(['glass','leaf','void','gravity'][Number(e.key)-1]);if(e.key.toLowerCase()==='x'){eraseMode=!eraseMode;$('#btn-erase').classList.toggle('active',eraseMode);toast(eraseMode?'Erase mode on':'Erase mode off');}if(e.key.toLowerCase()==='r'&&weapon)reloadWeapon(weapon);if(e.key==='Escape')closeModal();if(['w','a','s','d',' ','shift'].includes(e.key.toLowerCase()))vehicleKeys.add(e.key.toLowerCase());});window.addEventListener('keyup',e=>vehicleKeys.delete(e.key.toLowerCase()));
$$('.ink').forEach(b=>b.onclick=()=>setInk(b.dataset.ink));$('#btn-erase').onclick=()=>{eraseMode=!eraseMode;$('#btn-erase').classList.toggle('active',eraseMode);};$('#btn-help').onclick=openHelp;$('#btn-settings').onclick=openSettings;$('#btn-arena').onclick=spawnEnemy;$('#btn-clear').onclick=()=>{for(const o of [...objects])if(o.userData.kind==='ink'||o.userData.type==='ink')removeObject(o);toast('Loose ink cleared. Built things remain.');};
$('#selection-card').addEventListener('dblclick',()=>{if(selected?.userData.kind==='ink'||selected?.userData.type==='ink')convertSelected();else if(selected)openRigModal(selected);});
$('#selection-card').addEventListener('click',e=>{if(e.detail===1&&selected?.userData.type)updateWeaponHud(selected?.userData.type==='weapon'?selected:null);});

async function enterVR(){
  if(vrSession){await vrSession.end();return;}
  if(!navigator.xr){toast('WebXR is not available in this browser. Try a supported headset browser.','warn');return;}
  try{const supported=await navigator.xr.isSessionSupported('immersive-vr');if(!supported){toast('No immersive VR headset was detected.','warn');return;}const optional=['local-floor','bounded-floor'];if(settings.handTracking)optional.push('hand-tracking');vrSession=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:optional});renderer.xr.enabled=true;await renderer.xr.setSession(vrSession);$('#btn-vr').classList.add('connected');$('#btn-vr').lastChild.textContent=' In VR';buildXRControllers();vrSession.addEventListener('end',()=>{vrSession=null;renderer.xr.enabled=false;$('#btn-vr').classList.remove('connected');$('#btn-vr').lastChild.textContent=' Enter VR';handSources=[];});toast('Atelier connected · squeeze to draw, trigger to use.','good');}catch(err){vrSession=null;toast(`VR could not start: ${err.message}`,'warn');}}
$('#btn-vr').onclick=enterVR;
function buildXRControllers(){controllerLines.length=0;handModels=[];for(let i=0;i<2;i++){const c=renderer.xr.getController(i);c.userData.index=i;c.addEventListener('selectstart',()=>{c.userData.pressing=true;c.userData.points=[];});c.addEventListener('selectend',()=>{c.userData.pressing=false;if(c.userData.points?.length>1)createInkStroke(c.userData.points,activeInk);c.userData.points=[];});c.addEventListener('squeezestart',()=>{if(selected?.userData.type==='weapon')weapon=selected;});scene.add(c);const grip=renderer.xr.getControllerGrip(i);scene.add(grip);const lineObj=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0xb9a4ff,transparent:true,opacity:.6}));c.add(lineObj);controllerLines.push({controller:c,line:lineObj});}for(let i=0;i<2;i++){const h=renderer.xr.getHand(i);scene.add(h);handModels.push(h);}}
function processXR(dt){if(!vrSession)return;for(const {controller,line:ray} of controllerLines){const origin=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1);controller.getWorldPosition(origin);direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));ray.position.copy(origin);ray.quaternion.copy(controller.getWorldQuaternion(new THREE.Quaternion()));if(controller.userData.pressing){const point=origin.clone().addScaledVector(direction,2.4);controller.userData.points.push(point);if(controller.userData.points.length>300)controller.userData.points.shift();}}
  for(const hand of handModels){const index=hand.userData.index;const source=vrSession.inputSources[index];if(!source?.hand||!settings.handTracking)continue;const thumb=source.hand.get('thumb-tip'),indexTip=source.hand.get('index-finger-tip');if(!thumb||!indexTip||!thumb.visible||!indexTip.visible)continue;const pinch=thumb.position.distanceTo(indexTip.position)<.035;if(pinch&&!hand.userData.pinch){hand.userData.pinch=true;hand.userData.points=[];}if(pinch){const p=indexTip.getWorldPosition(new THREE.Vector3());hand.userData.points.push(p);}if(!pinch&&hand.userData.pinch){hand.userData.pinch=false;if(hand.userData.points.length>1)createInkStroke(hand.userData.points,activeInk);hand.userData.points=[];}}
}

function updateSimulation(dt){simTime+=dt;for(const o of [...objects]){
  const d=o.userData;if(d.dynamic&&d.ink==='gravity'){d.vel.y=(d.vel.y||0)-9.8*dt;o.position.y+=d.vel.y*dt;const floorY=d.groundY??.03;if(o.position.y<floorY){o.position.y=floorY;d.vel.y=Math.abs(d.vel.y||0)*.35;if(Math.abs(d.vel.y)<.22)d.vel.y=0;}}
  if(d.type==='animal'){d.age=(d.age||0)+dt;const rig=d.art?.userData.rig;if(rig){rig.legs.forEach((l,i)=>l.rotation.z=Math.sin(d.age*4+i*Math.PI)*.17);if(rig.tail)rig.tail.rotation.y=Math.sin(d.age*2)*.15;rig.wings.forEach((w,i)=>w.rotation.z=Math.sin(d.age*7+i)*.3);}if(d.hostile&&d.health>0){const target=objects.find(x=>x.userData.type==='weapon')||null;if(target){const dir=target.position.clone().sub(o.position);dir.y=0;if(dir.length()>.8)o.position.addScaledVector(dir.normalize(),dt*.45);}}o.position.x+=Math.sin(d.age*1.1)*dt*(d.hostile?.1:.18);}
  if(d.type==='vehicle'){if(d.driving){const speed=vehicleKeys.has('shift')?6:3;const v=new THREE.Vector3(Number(vehicleKeys.has('d'))-Number(vehicleKeys.has('a')),0,Number(vehicleKeys.has('s'))-Number(vehicleKeys.has('w'))).normalize();o.position.addScaledVector(v,dt*speed);if(vehicleKeys.has(' ')&&o.position.y<=.051)d.jumpVelocity=4.2;if(d.blueprint==='plane'&&d.art.children.find(c=>c.name==='propeller'))d.art.children.find(c=>c.name==='propeller').rotation.x+=dt*16;}if(d.jumpVelocity){d.jumpVelocity-=9.8*dt;o.position.y+=d.jumpVelocity*dt;if(o.position.y<.05){o.position.y=.05;d.jumpVelocity=0;}}}
  if(d.ink==='glass'&&d.dynamic&&o.position.y<.03){burst(o,9,0x9feaff);removeObject(o);}
}
  for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.mesh.position.addScaledVector(p.vel,dt);p.life-=dt;let hit=false;for(const target of objects){if(target===p.owner)continue;const b=new THREE.Box3().setFromObject(target);if(b.distanceToPoint(p.mesh.position)<.22){impactObject(target,1);hit=true;break;}}if(hit||p.life<=0){scene.remove(p.mesh);projectiles.splice(i,1);}}
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];if(p.ambient){p.mesh.position.y+=Math.sin(simTime+p.mesh.userData.phase)*dt*.025;continue;}p.mesh.position.addScaledVector(p.vel,dt);p.vel.y-=5*dt;p.life-=dt;p.mesh.material.opacity=Math.max(0,p.life);if(p.life<=0){scene.remove(p.mesh);particles.splice(i,1);}}
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));}
window.addEventListener('resize',resize);
function render(){const dt=Math.min(clock.getDelta(),.035);processXR(dt);updateSimulation(dt);if(!renderer.xr.isPresenting)updateCamera();renderer.render(scene,camera);}
renderer.setAnimationLoop(render);
setInk('glass');setDepth(3.2);updatePointer(innerWidth/2,innerHeight/2);setTimeout(()=>$('#loader')?.classList.add('gone'),650);
