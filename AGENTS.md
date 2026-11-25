# Chronicle 开发协作

GitHub 仓库为 `madake1/Chronicle`。使用已授权的 GitHub CLI。凭证保存在系统凭据存储中，仓库文件、提交和评论中禁止记录 token 或密码。

## 从 Issue 开始

- 收到 Issue 编号后，先用 `gh issue view <编号> --repo madake1/Chronicle --json title,body,state,url` 读完整正文。
- 编码前用 `gh api --paginate repos/madake1/Chronicle/issues/<编号>/comments` 读取所有页的评论，注意最新评论中的范围调整和验收条件。需求冲突且无法从上下文确定时，先向用户核实。

## 交付与评审

- 开发完成后运行相关测试并提交代码。在对应 Issue 中记录实现内容、Commit ID、测试结果和遗留问题。发送更新时使用 `gh issue comment <编号> --repo madake1/Chronicle --body-file <文件>`。
- 有后续 Code Review 时，用 `gh pr view <编号> --repo madake1/Chronicle --json reviews,comments,reviewDecision` 读取评审和会话，用 `gh api --paginate repos/madake1/Chronicle/pulls/<编号>/comments` 读取行内评论。结合最新意见继续修改并重新验证。
- 未经用户确认，不关闭 Issue 或合并 PR。需要保持 Issue 开放时，提交和 PR 描述使用 `Refs #<编号>`，避免自动关闭关键字。
