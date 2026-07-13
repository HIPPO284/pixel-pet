PixelPet Desktop Portable v1.4
==============================

这个版本不再使用 npm 安装 Electron，因此不会再出现：
Electron failed to install correctly
或 npm allow-scripts 阻止安装的问题。

使用方法
--------
1. 将整个 ZIP 完整解压到普通文件夹。
2. 双击 RUN_PIXELPET.cmd。
3. 第一次运行会下载约 120 MB 的官方 Electron Windows 运行时。
4. 下载完成后会校验 SHA-256、自动解压并启动 PixelPet Desktop。
5. 把网页生成的 *-runtime.petpack 拖入桌面运行器即可。

后续运行
--------
再次双击 RUN_PIXELPET.cmd。已下载的运行时会直接复用，不会重复下载。

故障恢复
--------
如果首次下载被中断，双击 RESET_RUNTIME.cmd，再重新运行 RUN_PIXELPET.cmd。
下载脚本会先尝试 npmmirror，再尝试 GitHub，并且不会运行 npm install。

系统要求
--------
Windows 10 或 Windows 11。
脚本会自动区分 x64 和 ARM64。
不要求安装 Node.js 或 npm。
