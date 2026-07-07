# summary

用户决定暂不做改动，任务关闭/归档。

研究结论：现有 `chrome.debugger.attach({ tabId })` 定位本身没有问题，是 tab-scoped；Chrome 顶部 debugger 提示属于 Chromium 原生全局 UI，扩展无法控制其只显示在某个 tab，也无法修改文案/位置。若未来继续，可考虑在被分享 tab 内注入 YPI 自有标记/浮层、popup/action badge/ypi web 展示当前分享 tab，而不是修改 debugger target。
