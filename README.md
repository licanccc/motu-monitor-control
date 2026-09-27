# MOTU Monitor Control

适用于 macOS、MOTU UltraLite mk5、CueMix 5 和 Elgato Stream Deck 的本地控制插件，包含九个按键。

- `Main Mix Mute`：只静音 CueMix 的 Main 1–2 Mix 总线，不影响 Phones Mix。
- `Phones Mix Mute`：只静音 CueMix 的 Phones Mix 总线。
- `Mic 1 PAD`：激活或关闭 Input 页面里 Mic 1 的输入 PAD。
- `MONO`：直接切换 UltraLite mk5 固件中的隐藏监听单声道参数。按键状态来自设备回报。
- `DIM`：记住当前 Main 音量，将硬件 Main 衰减增加 20 dB，再按恢复。按键状态来自设备实际 Main 衰减值。
- `Monitor Volume + / −`：每按一次使主监听音量增加或降低 1 dB。
- `Phones Volume + / −`：每按一次使耳机音量增加或降低 1 dB。

## 安装

1. 保持 MOTU 驱动和 CueMix 5 已安装。
2. 在 CueMix 5 的 Discovery 页面查看设备序列号。
3. 编辑 `com.local.motu-monitor.sdPlugin/config.json`，将 `REPLACE_WITH_DEVICE_SERIAL` 换成该序列号。
4. 双击 `install.command`。如果 macOS 第一次阻止打开，可右键它并选择“打开”。
5. 完全退出并重新打开 Stream Deck。
6. 在 Stream Deck 右侧动作列表找到 `MOTU Monitor Control`，把需要的动作拖到按键。

Stream Deck 启动时会自动启动插件，不需要另设登录项。设备地址、DIM 幅度、音量步进和 HTTP 端口都在插件目录内的 `config.json`。

## 状态含义

- 深灰图标：关闭。
- 红色 MUTE：设备已经确认相应 Mix 静音。
- 蓝色 Mic 1 PAD：设备已经确认 Mic 1 的 PAD 开启。
- 蓝色 MONO：设备已经确认 MONO 开启。
- 金色 DIM：设备已经确认 Main 音量处于本次 DIM 的目标值。
- 音量键第二行显示设备回报的当前衰减值。数值越接近 0 dB，实际音量越大。
- 标题出现“离线”：MOTU 本地 WebSocket 代理或设备未连接；按键会显示警告。

状态不会依赖 Stream Deck 自己猜测。插件使用两个 WebSocket 连接，一个发送控制，一个接收 UltraLite mk5 的广播回报。只有设备回报后，图标才改变。

## DIM 的安全逻辑

UltraLite mk5 没有独立的监听 DIM 参数。这里使用设备的 Main Trim 参数实现可靠替代：

1. 开启时保存当前衰减值。
2. 在该值上再衰减 20 dB，最大到设备的 −100 dB。
3. 关闭时恢复保存值。
4. 如果 DIM 开启期间在机身或 CueMix 中改变 Main 音量，插件把它视为人工接管，立即取消 DIM 状态，并且不会再跳回旧音量。
5. 如果 Stream Deck 重启，插件会把保存的 DIM 目标与设备实际值比较。只有两者一致才恢复亮灯。

要修改 DIM 衰减量，编辑 `config.json` 中的 `dimDb`。要修改每次音量步进，编辑 `volumeStepDb`。改完后重启 Stream Deck。

## 本地 HTTP 接口

插件同时在 `127.0.0.1:7315` 提供本机接口，方便 Keyboard Maestro、Raycast 或其他工具调用：

```text
GET  http://127.0.0.1:7315/status
POST http://127.0.0.1:7315/mute/toggle
POST http://127.0.0.1:7315/main-mute/toggle
POST http://127.0.0.1:7315/phones-mute/toggle
POST http://127.0.0.1:7315/mic1-pad/toggle
POST http://127.0.0.1:7315/mono/toggle
POST http://127.0.0.1:7315/dim/toggle
POST http://127.0.0.1:7315/monitor/up
POST http://127.0.0.1:7315/monitor/down
POST http://127.0.0.1:7315/phones/up
POST http://127.0.0.1:7315/phones/down
```

为兼容简单的 HTTP Request 动作，以上接口都接受 GET 和 POST。`/mute/toggle` 保留为 Main Mix Mute 的兼容别名。返回 JSON 包含所有静音状态及主监听、耳机的真实衰减值。

## 设备地址

进入 CueMix 5 的 Discovery 页面查看序列号，再把 `config.json` 的 URL 写为：

```text
ws://127.0.0.1:1281/设备序列号
```

保存后重启 Stream Deck。不要把包含真实设备序列号的个人配置提交到公开仓库。

## 原理

插件复用了 CueMix 5 与 UltraLite mk5 之间的本地 WebSocket 协议。它同时建立控制连接和观察连接，写入参数后等待设备广播确认，因此按钮显示的是设备状态，不是 Stream Deck 自己记录的假状态。

## 限制

- 两个 Mix MUTE 使用 CueMix 5 自己的 Mix 总线参数，已经在 UltraLite mk5 上逐个写入、恢复并收到硬件广播确认。旧版采用的隐藏 `5019` 参数虽然会回报状态，但不会真正切断此设备的音频，1.2 版已经完全弃用它。
- Mic 1 PAD 直接使用 Input 页面相同的 `kPad` 参数。Mic 1 必须处于 Mic 输入模式；切到 Line/Instrument 时 CueMix 本身会禁用 PAD 控件。
- MONO 5018 是 CueMix 5 源码中存在但界面隐藏的参数。MOTU 没有把本地协议作为公开 API 承诺，未来固件可能改变。
- DIM 是可验证的 Main Trim 替代方案，不是 UltraLite mk5 原生 DIM。它会影响 Main Monitor Group 中由主旋钮控制的输出。
- 如果其他软件占用了本地 7315 端口，Stream Deck 按键仍可工作，但 HTTP 接口不可用。可以在 `config.json` 更换 `httpPort`。
- 设备启用了密码保护时，本插件目前不会代为登录。

## 卸载

双击 `uninstall.command`。它会把插件移到废纸篓，不会删除 CueMix 设置或设备设置。
