# Precise Reading Edit

在 Obsidian 阅读视图里双击正文。确认双击位置对应哪个 Markdown 源码位置后，插件才会切换到编辑视图，并将光标放到该处。无法确定位置时，当前阅读视图和滚动位置会保留。

## 使用方式

1. 启用插件，在阅读视图打开一篇笔记。
2. 双击想编辑的标题或正文。双击普通文字时，插件尝试定位到对应字符。双击支持的行内公式时，光标落在该公式开头的 `$` 处。
3. 遇到复杂区块、渲染位置缺失或存在多个可能的落点时，可以用 Obsidian 的视图切换按钮进入编辑视图。

当前版本面向 Obsidian 桌面版，要求 **1.15.1 或更新版本**。如果同时启用了接管阅读视图双击手势的其他插件，请停用其双击功能或暂时停用该插件，以免两个插件同时处理一次双击。

项目的双击编辑操作受到 Click to Edit 启发。代码独立编写，通过 Obsidian 提供的阅读区块位置信息确定点击点的源码位置。[Click to Edit](https://github.com/alpppine/click-to-edit)

## 手动安装

1. 从本仓库的 Releases 下载同一个版本的 `main.js` 和 `manifest.json`。
2. 把两个文件放进笔记库的 `.obsidian/plugins/precise-reading-edit/` 目录，目录不存在时先创建。
3. 在 Obsidian 的「设置 → 第三方插件」中刷新插件列表，启用 **Precise Reading Edit**。

## 隐私

位置匹配在本机完成，只使用当前笔记的源文和已渲染的区块。插件无需账户，无网络请求或遥测，也无需访问笔记库之外的文件。

## 本地开发

```sh
npm ci
npm test
npm run build
```

## 许可证

[MIT](LICENSE)
