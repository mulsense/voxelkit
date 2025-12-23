import xnew from '@mulsense/xnew';
import xthree from '@mulsense/xnew/addons/xthree';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import voxelkit from 'voxelkit';

xnew('#main', Main);

function Main(main) {
  xnew.extend(xnew.basics.Screen, { width: 800, height: 800 });

  // three setup
  xthree.initialize({ canvas: main.canvas });
  xthree.renderer.shadowMap.enabled = true;
  xthree.renderer.shadowMap.type = THREE.PCFShadowMap;
  xthree.scene.background = new THREE.Color(0xe0e0f0);
  xthree.scene.fog = new THREE.Fog(0xe0e0f0, 10, 30);
  xthree.camera.position.set(0, 0, +2);
  xthree.scene.rotation.x = -60 / 180 * Math.PI

  xthree.camera.position.set(0, 0.4, +2);
  xthree.scene.rotation.x = -60 / 180 * Math.PI
  xthree.scene.rotation.z = -20 / 180 * Math.PI

  const composer = new EffectComposer(xthree.renderer);
  composer.addPass(new RenderPass(xthree.scene, xthree.camera));
  const ssaoPass = new SSAOPass(xthree.scene, xthree.camera, xthree.canvas.width, xthree.canvas.height);
  ssaoPass.kernelRadius = 0.1;      // サンプリング半径
  ssaoPass.minDistance = 0.00001;   // 最小距離
  ssaoPass.maxDistance = 0.00005;     // 最大距離
  composer.addPass(ssaoPass);
  composer.addPass(new OutputPass());

  main.off('update');
  main.on('update', () => { 
    composer.render();
  });

  xnew(ThreeMain);
  xnew(Controller);
}

function ThreeMain(unit) {
  xnew(DirectionaLight, { x: 1, y: -1, z: 2 });
  xnew(AmbientLight);
  xnew(Ground, { size: 100, color: 0xF8F8FF });

  xnew.promise(voxelkit.load('./teto.mog')).then((composits) => voxelkit.convertVRM(composits[0]));

  xnew.promise(new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));  
    loader.load('./VRMA_07.vrma', (gltf) => {
      resolve(gltf.userData.vrmAnimations[0]);
    });
  }));
  xnew.then(([arrayBuffer, vrma]) => {
    const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'test.vrm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    xnew(Test, { arrayBuffer, vrma, position: { x: 0, y: 0, z: 0 } });
    // for (let i = 0; i < 100; i++) {
    //   const x = Math.random() * 6 - 3;
    //   const y = Math.random() * 6 - 3;
    //   xnew(Test, { arrayBuffer, vrma, position: { x: x, y: y, z: 0 } });
    // }
  });

  unit.on('+scale', ({ scale }) => {
    xthree.camera.position.z /= scale;
  });
  unit.on('+translate', ({ move }) => {
    xthree.camera.position.x += move.x * xthree.camera.position.z * 0.001;
    xthree.camera.position.y += move.y * xthree.camera.position.z * 0.001;
  });
  unit.on('+rotate', ({ move }) => {
    xthree.scene.rotation.x += move.y * 0.01;
    xthree.scene.rotation.z += move.x * 0.01;
  });
}

function DirectionaLight(unit, { x, y, z }) {
  const object = xthree.nest(new THREE.DirectionalLight(0xFFFFFF, 1.4));
  object.position.set(x, y, z);
  object.castShadow = true;

  const s = object.position.length();
  object.castShadow = true;
  object.shadow.mapSize.width = 2048;
  object.shadow.mapSize.height = 2048;
  object.shadow.camera.left = -s * 1.0;
  object.shadow.camera.right = +s * 1.0;
  object.shadow.camera.top = -s * 1.0;
  object.shadow.camera.bottom = +s * 1.0;
  object.shadow.camera.near = +s * 0.1;
  object.shadow.camera.far = +s * 10.0;
  object.shadow.camera.updateProjectionMatrix();
}

function AmbientLight(unit) {
  const object = xthree.nest(new THREE.AmbientLight(0xFFFFFF, 1.8));
}

function Ground(unit) {
  const geometry = new THREE.PlaneGeometry(100, 100);
  const material = new THREE.MeshPhongMaterial({ color: 0xffffff, depthWrite: true });
  const object = xthree.nest(new THREE.Mesh(geometry, material));
  object.receiveShadow = true;
}

function Controller(unit) {
  unit.on('touchstart contextmenu wheel', (event) => event.preventDefault());

  const pointer = xnew(xnew.basics.PointerEvent);
  let isActive = false;
  pointer.on('-gesturestart', () => isActive = true);
  pointer.on('-gestureend', () => isActive = false);
  pointer.on('-gesturemove', ({ scale }) => {
    xnew.emit('+scale', { scale })
  });

  pointer.on('-dragmove', ({ event, delta }) => {
    if (isActive === true) return;
    if (event.buttons & 1 || !event.buttons) {
      xnew.emit('+rotate', { move: { x: +delta.x, y: +delta.y } });
    }
    if (event.buttons & 2) {
      xnew.emit('+translate', { move: { x: -delta.x, y: +delta.y } });
    }
  });
  pointer.on('-wheel', ({ delta }) => xnew.emit('+scale', { scale: 1 + 0.001 * delta.y }));
}

function Test(unit, { arrayBuffer, vrma, position }) {
  const object = xthree.nest(new THREE.Object3D());
  
  xnew.promise(new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.parse(arrayBuffer.buffer, '', (gltf) => {
      resolve(gltf);
    }, (error) => {
      console.error('Failed to load VRM:', error);
    });
  })).then((gltf) => {
    const vrm = gltf.userData.vrm;
    vrm.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    const scene = vrm.scene;
    scene.rotation.x = Math.PI / 2;
    scene.position.set(position.x, position.y, position.z);
    object.add(scene);

    const mixer = new THREE.AnimationMixer(vrm.scene);
    const clip = createVRMAnimationClip(vrma, vrm);
    const currentAction = mixer.clipAction(clip);
    currentAction.setLoop(THREE.LoopRepeat);
    currentAction.play();

    let clock = new THREE.Clock();
    unit.on('update', () => {
        
        const delta = clock.getDelta();
        mixer.update(delta);
        vrm.update(delta);
    });
  });

}

