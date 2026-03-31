# ClawAegis


ClawAegis为OpenClaw类智能体构建了一套多维度的智能体安全纵深防御架构，实现从大模型智能体在各种Claw从初始化到执行的全生命周期五层安全防御，覆盖智能体执行服务中的安全性和可靠性风险，包括skill投毒、记忆污染、意图对齐、恶意执行、资源耗尽等。作为内置的轻量化安全插件，ClawAegis可以在OpenClaw的关键阶段主动发起防御机制，动态保障智能体运行时的安全。此外，ClawAegis还面向安全运营人员提供风险识别与处置策略可配置能力，以灵活、可拓展地应对智能体运行时安全威胁；面向普通用户提供敏感文件及Skill资产保护能力，以保障个人隐私和资产安全。

<p align="center">
  <strong>中文版 README</strong> | <a href="README.md">English</a>
</p>

---

## 💫 架构

<p align="center">
  <img src="https://github.com/user-attachments/assets/9900dc9e-924e-4bac-a7c7-3133565e7932" alt="ClawAegis 架构" width="100%" />
</p>

ClawAegis 为 OpenClaw 构建了一套多维度的纵深防御架构，实现从初始化到执行终端的全生命周期安全闭环。该体系由以下五个核心防护层组成：

- **可信基座层防御** — 确保底层环境的可信度，从初始化阶段夯实系统安全根基。
- **感知输入层防御** — 对内部和外部指令进行严格过滤与审核，拦截恶意注入或高风险请求。
- **认知状态层防御** — 实时监控智能体的内部状态，防止记忆恶化上下文污染。
- **决策对齐层防御** — 在逻辑生成环节进行意图校验，确保输出决策与用户真实意图一致，模糊意图要求用户二次确认，消除意图偏离风险。
- **执行控制层防御** — 在最终操作前实施权限管理，确保所有指令都在安全边界内受控执行。

通过这种层层递进的机制，ClawAegis 确保了 OpenClaw 在每一个关键链路环节都具备细致的风险对冲能力，将潜在威胁消弭于无形。此外，作为内置的安全插件，不同于提示词、Skill类防御等被动防御机制，ClawAegis可以在OpenClaw的关键阶段主动发起防御机制，动态保障运行时的安全。

---

## ✨ 核心特性

- **五层纵深防御** — 覆盖意图扫描、工具调用治理、工具结果审查、资产保护和输出安全，贯穿九个OpenClaw生命周期钩子。
- **Skill投毒防御** — 启动时及运行期间持续扫描Skill内容，检测试图绕过审批、禁用安全控制或篡改受保护资产的恶意载荷。
- **记忆污染防护** — 拒绝对持久化记忆存储（`memory_store`、`MEMORY.md`、`SOUL.md`、`memory/`）的可疑或超大写入，防止跨会话的持久化提示词投毒。
- **意图与提示词安全** — 检测用户消息中的越狱尝试、密钥窃取请求和插件篡改意图，并向提示词注入安全上下文以影响后续模型推理。
- **工具调用治理** — 在工具执行前拦截高危Shell命令、编码/混淆载荷、写后执行链、重复变异循环以及SSRF/数据泄露链。
- **工具结果审查** — 将外部工具输出视为不可信输入，扫描其中的提示词注入、密钥请求和权限提升模式，防止其影响下一步推理。
- **输出脱敏** — 在助手输出发送或存储前，遮蔽API密钥、令牌及类似敏感值。
- **资产与自保护** — 保护敏感文件、高价值Skill、重要插件及自身安全配置，防止未授权访问和篡改。
- **可配置策略** — 每项拦截防御均支持 `enforce`（强制拦截）/ `observe`（仅观察）/ `off`（关闭）三种模式，支持全局默认和逐项覆盖，实现从监控到主动拦截的渐进式部署。

---

## 🚀 快速开始

**1.** 将本仓库添加到你的OpenClaw扩展工作区：

```bash
git clone https://github.com/antgroup/ClawAegis.git
```

**2.** 安装插件：

```bash
openclaw plugins install ./ClawAegis
```

**3.** 或手动安装 — 安装依赖并注册插件入口：

```bash
cd ClawAegis && npm install
```

```json
{
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

**4.** 以观察模式启用ClawAegis，安全上线：

```json
{
  "allDefensesEnabled": true,
  "defaultBlockingMode": "observe"
}
```

**5.** 根据需要将高置信度防御提升为 `enforce`：

```json
{
  "allDefensesEnabled": true,
  "defaultBlockingMode": "observe",
  "selfProtectionMode": "enforce",
  "commandBlockMode": "enforce",
  "memoryGuardMode": "enforce",
  "exfiltrationGuardMode": "enforce"
}
```

---

## 🛠️ 项目结构

```
ClawAegis/
├── index.ts                    # 插件入口；注册生命周期钩子
├── runtime-api.ts              # OpenClaw插件API类型定义
├── openclaw.plugin.json        # 插件清单，包含配置Schema和UI提示
├── package.json                # 包元数据（@openclaw/claw-aegis）
├── tsconfig.json               # TypeScript配置
├── LEGAL.md                    # 法律声明
└── src/
    ├── types.ts                # 核心领域类型（TurnSecurityState等）
    ├── config.ts               # 配置解析与常量
    ├── handlers.ts             # 主运行时逻辑；所有钩子处理器
    ├── rules.ts                # 检测规则与扫描逻辑
    ├── security-strategies.ts  # 防御策略定义与模式
    ├── state.ts                # 内存与持久化状态管理
    ├── scan-service.ts         # Skill扫描服务及队列管理
    ├── scan-worker.ts          # Skill扫描Worker逻辑
    ├── command-obfuscation.ts  # Shell命令混淆检测
    └── encoding-guard.ts       # 编码载荷检测
```

---

## 🎬 效果展示

OpenClaw既可以由个人用户部署在本地，也可以由服务商部署在远端——两种场景都面临不同的安全风险。以下演示展示了ClawAegis如何在各场景中防御真实威胁。

### 面向个人用户（To C）

本地部署的智能体面临模糊意图、资源浪费和Skill投毒等风险，直接影响用户的文件、Token和隐私。

<div align="center">
<table>
<tr>
<td align="center" width="50%"><p style="margin:0 0 8px 0; color:#666; font-size:13px;">模糊意图导致文件被删除</p><video title="模糊意图 - 文件删除" alt="模糊的用户指令导致智能体删除所有项目文件" src="https://github.com/user-attachments/assets/230fcc05-acaa-4e79-8839-afd623639ef3" controls preload="metadata" style="width:100%; max-width:400px; height:225px; object-fit:cover;"></video></td>
<td align="center" width="50%"><p style="margin:0 0 8px 0; color:#666; font-size:13px;">Skill投毒泄露隐私</p><video title="Skill投毒 - 隐私泄露" alt="被投毒的Skill将用户敏感数据泄露到外部服务器" src="https://github.com/user-attachments/assets/37524f92-cf8c-4c79-a503-ca3a60642439" controls preload="metadata" style="width:100%; max-width:400px; height:225px; object-fit:cover;"></video></td>
</tr>
</table>
</div>

### 面向服务商（To B）

远端部署的智能体面临API密钥盗用、危险命令执行和间接提示词注入等风险，威胁服务可用性和数据安全。

<div align="center">
<table>
<tr>
<td align="center" width="50%"><p style="margin:0 0 8px 0; color:#666; font-size:13px;">API密钥泄露 — Token被盗用</p><video title="API密钥泄露 - Token盗用" alt="攻击者读取~/.openclaw/agents/main/agent/models.json窃取API密钥" src="https://github.com/user-attachments/assets/78b60004-a500-4446-bfbb-a5dab87ddcde" controls preload="metadata" style="width:100%; max-width:400px; height:225px; object-fit:cover;"></video></td>
<td align="center" width="50%"><p style="margin:0 0 8px 0; color:#666; font-size:13px;">间接提示词注入 — 数据泄露</p><video title="间接提示词注入 - 数据泄露" alt="外部内容中的注入指令导致智能体泄露数据" src="https://github.com/user-attachments/assets/ed72a4b8-0f5b-409d-8d1e-447fb3f1ec09" controls preload="metadata" style="width:100%; max-width:400px; height:225px; object-fit:cover;"></video></td>
</tr>
</table>
</div>

---

## 🔭 未来规划

- 面向Skill、记忆条目、工具输出和生成脚本的溯源感知信任评分，使策略能够基于来源和历史行为进行响应。
- 跨会话和跨智能体的攻击图谱，将风险意图、工具调用、工具结果、记忆写入和出站请求关联为统一的事件时间线。
- 自适应策略，根据部署环境、任务类型和运营人员反馈自动调优 `observe` 和 `enforce` 决策。
- 自主遏制工作流，支持隔离风险Skill、冻结敏感记忆命名空间并推荐恢复措施。
- 多智能体系统的共享安全状态，使协作智能体能够交换风险上下文并协调遏制决策。
- 持续红队评估流水线，针对新版本回放新兴越狱手法、编码载荷、Skill投毒样本和工具链滥用技术。
- 可解释的防御报告，将底层检测转化为人类可读的事件摘要和可复用的响应手册。

---

## 📨 作者

[Xinhao Deng](https://xinhao-deng.github.io), [Xiaohu Du](https://xhdu.github.io), [Jialuo Chen](https://testing4ai.github.io), [Jianan Ma](https://github.com/nninjn), Ruixiao Lin, Yidou Liu, Siyi Cao, Yan Wu, Shiwen Cui, Xiaofang Yang, Changhua Meng, Weiqiang Wang

---

## 📄 许可证

详见 [LEGAL.md](LEGAL.md)。
