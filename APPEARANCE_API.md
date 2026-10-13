# Paper Library 标准视图与强调色

文献库统一采用标准视图，导航、文献主页、日常看板和详情均使用同一布局。视图切换按钮、菜单及布局选择设置已删除。桌面端和移动端仍可分别设置强调色。

此前的画廊、纸境、蓝图和“我的外观”功能及专用样式已移除。所有旧视图选择在启动或同步加载时迁移为标准视图，保留文献、标签、分类和强调色。

插件根节点保留 `paperlib-appearance-standard`、`paperlib-appearance-base-standard` 类，以及 `data-paperlib-appearance`、`data-paperlib-appearance-base`、`data-paperlib-surface` 属性。`data-paperlib-surface` 为 `navigation`、`library` 或 `detail`。内置样式使用 `--paperlib-global-accent` 和 `--paperlib-accent-contrast` 接入设备强调色。
