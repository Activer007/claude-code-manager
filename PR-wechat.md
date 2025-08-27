ccm v2.8.0 更新（支持自定义状态栏）

```bash
npm i -g claude-code-manager 
ccm statusline init    # 一键安装
ccm statusline enable  # 激活使用
```

效果示例：
💥 10:20:43 (today: $6.93) │ claude-code-manager (main) │ ⏱ 45s 💰 $0.123 📊 +156/-23 │ [Opus]

感谢社群成员 radonx、追逐清风 对状态栏功能的贡献！

## changelog
07-07 v1.1.0：集成了 ccusage（ccm usage）
07-13 v1.4.0：支持会话历史显示cc部分、json导出（方便前端wrapper）
07-15 v1.5.0：支持任务监控（ccm monitor）
07-25 v2.2.0：支持递归显示CLAUDE.md（ccm memory）
08-21 v2.4.1：支持worktree开发（ccm feat）
08-26 v2.6.0：支持全新dashboard（ccm dashboard），集成了账号分析、项目分析等一系列数据分析项
08-27 v2.8.0：支持自定义状态栏（ccm statusline），实时显示会话成本和代码变更

## ccm 是什么？
ccm 是增强 claude code 开发体验的集成工具，将不断更新维护以支持最酷最棒的功能，欢迎 star/fork/issue/pr。

源码：https://github.com/markshawn2020/claude-code-manager
