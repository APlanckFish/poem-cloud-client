# 诗云宇宙 H5 原型

这是“诗云宇宙”首次进入体验的独立 H5 原型，用于验证视觉表现、分层探索和性能，不改动现有小程序运行入口。

## 体验路径

1. 以第三视角看见代表用户自身的“诗光”，镜头交还后可 360° 环顾。
2. 跟随诗光进入朝代云团，再选择高亮的唐云。
3. 穿越流动唐云与彗星诗句流，抵达盛唐诗人星河。
4. 选择李白，进入作品星云。
5. 展开任一诗作。
6. 触发奇点坍缩，过渡到常规创作首页。

## 本地运行

```bash
pnpm install
pnpm dev
```

默认地址：`http://127.0.0.1:4178`

## 技术说明

- Three.js + GLSL 驱动连续的三维世界坐标系；旅行者、朝代、诗人和作品都位于同一条空间航线上。
- 超远景使用由 NASA 8K 线性 EXR 转换而来的 2048px 六面 CubeTexture，只承担暗空与遥远恒星；气态云不再烘焙进天空盒。
- 近景气态云不烘焙进天空盒。每个目的星域使用独立世界坐标的球形 Ray Marching 体积，18/30 步采样四层 FBM、侵蚀噪声和旋臂遮罩，摄像机能够真正穿入云中。
- 诗光主体改为沿飞行方向拉伸的半透明能量水滴；内部流线、贴体薄日冕、短程离子核、长程烟雾与稀疏火花分层渲染，没有覆盖整颗主体的装饰性光球。
- 航行使用 Catmull–Rom 三维路径。镜头根据实时切线生成飞行姿态，并在每段首尾分别与上一站、下一站机位做位置、目标、Up 和 FOV 插值，阶段之间不硬切。
- 航行诗句绑定在 NASA Bennu 几何体彗星之后。彗星局部 X 轴跟随速度方向，文字平面在保持方向的同时朝向摄像机；尾迹采用烟雾与离子精灵叠加，不再使用平直线段。
- 第一层是远处可见的五臂唐朝星团；第二层是李白、杜甫、王维等诗人恒星；第三层以李白为恒星系中心，作品沿多层轨道运行，弯曲荧光丝网与数千作品星尘构成广域星空。
- DOM 承载中文标签和诗文，避免纹理文字模糊，也便于替换真实接口数据。
- 根据设备内存、核心数、视口和“减少动态效果”设置自动分级。
- WebGL 不可用时自动进入常规创作入口。
- `?shot=tang` 可直接定位到唐云穿越验收关键帧，供设计稿逐帧对照。

## 数据与移植边界

- `public/assets/water-reference/` 仅用于本次非商业原型验证，来源于用户提供的 `javaLuo/water` 本地项目，并遵守其 README 中“禁止商用”的限制；如产品用途变化，必须在上线前整体替换。
- `public/assets/universe-v5/deep-stars/` 与 `milky-way/` 来自 [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/)，原始 8K EXR 已在本地预曝光并转换为六面图。
- `public/assets/universe-v5/models/bennu.glb` 来自 [NASA Bennu 3D Model](https://science.nasa.gov/resource/bennu-3d-model/)。NASA 素材使用遵循其 [Images and Media Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)。
- `public/assets/universe-v6/particles/` 来自 [Kenney Particle Pack](https://www.kenney.nl/assets/particle-pack)，使用其 CC0 烟雾、耀斑与火花透明纹理，并保留原始许可文件。
- `src/data/mock.ts` 是当前唯一的 mock 数据入口，后续替换为拓扑接口即可。
- `UniverseNode` 只依赖节点 id、类型、名称、三维坐标、色彩和尺寸，接口不需要返回渲染细节。
- 中文标签与作品正文不进入 WebGL 纹理，迁移小程序 WebView 或 H5 容器时可继续复用无障碍语义和点击热区。
- `src/scene/quality.ts` 把粒子量、像素比、云层和光迹统一收敛为三级档位，便于真机压测后单点调优。

## 验收

```bash
pnpm build
pnpm visual-check
```

`visual-check` 会自动构建并启动本地预览，使用本机 Chrome 依次走完序章、四向 360° 环顾、穿梭、朝代、诗人、作品、诗笺、奇点坍缩和常规首页，并在 `artifacts/` 生成移动端关键帧。脚本会校验同一阶段四个方向的截图哈希必须全部不同。非标准安装位置可通过 `CHROME_PATH` 指定浏览器。
