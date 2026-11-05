type PageCopy = { title: string; description: string }
type WorkspacePage = { eyebrow: string; zh: PageCopy; en: PageCopy }

// Presentation metadata only. Native routes, feature flags and permissions stay authoritative.
const pages: Record<string, WorkspacePage> = {
  '/purchase': {
    eyebrow: 'YOUR ACCOUNT / PLANS',
    zh: { title: '订阅与充值', description: '选择适合你的使用方式，继续下一程创造。' },
    en: { title: 'Plans & balance', description: 'Choose the right plan and keep your ideas moving.' }
  },
  '/orders': {
    eyebrow: 'YOUR ACCOUNT / ORDERS',
    zh: { title: '我的订单', description: '查看订单进度、支付结果与售后记录。' },
    en: { title: 'Your orders', description: 'Review order status, payments and after-sales requests.' }
  },
  '/affiliate': {
    eyebrow: 'YOUR ACCOUNT / INVITATIONS',
    zh: { title: '邀请与奖励', description: '分享你的连接，查看邀请进展与奖励记录。' },
    en: { title: 'Invitations & rewards', description: 'Share your connection and track invitations and rewards.' }
  },
  '/settings/mcp': {
    eyebrow: 'CONNECT / MCP',
    zh: { title: 'MCP 连接', description: '把工作台接入你的工具，管理连接与授权。' },
    en: { title: 'MCP connections', description: 'Connect your workspace to tools and manage authorizations.' }
  },
  '/usage': {
    eyebrow: 'WORKSPACE / USAGE',
    zh: { title: '使用记录', description: '看清每一次调用的用量、费用与处理结果。' },
    en: { title: 'Usage', description: 'Review usage, costs and outcomes for every request.' }
  },
  '/admin/usage': {
    eyebrow: 'OBSERVE / USAGE',
    zh: { title: '使用记录', description: '按成员、密钥和模型查看调用与费用。' },
    en: { title: 'Usage', description: 'Review requests and costs by member, key and model.' }
  },
  '/subscriptions': {
    eyebrow: 'WORKSPACE / YOUR PLAN',
    zh: { title: '我的订阅', description: '查看当前订阅、有效期与剩余使用额度。' },
    en: { title: 'Your subscriptions', description: 'Check your plans, renewal dates and remaining allowances.' }
  },
  '/redeem': {
    eyebrow: 'WORKSPACE / REDEEM',
    zh: { title: '兑换', description: '使用兑换码补充账户权益，查看每一笔兑换记录。' },
    en: { title: 'Redeem', description: 'Redeem account benefits and review your redemption history.' }
  },
  '/profile': {
    eyebrow: 'WORKSPACE / YOUR ACCOUNT',
    zh: { title: '个人资料', description: '查看账户信息，管理登录密码与绑定邮箱。' },
    en: { title: 'Your account', description: 'Review account details and manage your password and email.' }
  },
  '/keys': {
    eyebrow: 'ACCESS / API KEYS',
    zh: { title: 'API 密钥', description: '管理访问凭证、所属分组与使用额度。' },
    en: { title: 'API keys', description: 'Manage access, group assignments and spending limits.' }
  },
  '/admin/users': {
    eyebrow: 'WORKSPACE / MEMBERS',
    zh: { title: '成员管理', description: '查看成员状态、余额与访问权限。' },
    en: { title: 'Members', description: 'Keep member access, balances and account status in view.' }
  },
  '/admin/accounts': {
    eyebrow: 'CONNECT / ACCOUNTS',
    zh: { title: '上游账号', description: '统一管理上游连接、可用状态与调度配置。' },
    en: { title: 'Upstream accounts', description: 'Manage connections, availability and scheduling in one place.' }
  },
  '/admin/groups': {
    eyebrow: 'ACCESS / GROUPS',
    zh: { title: '分组管理', description: '按使用场景配置访问范围与计费规则。' },
    en: { title: 'Groups', description: 'Organize access and billing rules around the way you work.' }
  },
  '/admin/channels': {
    eyebrow: 'CONNECT / CHANNELS',
    zh: { title: '渠道管理', description: '整理模型接入与渠道配置，让连接各就其位。' },
    en: { title: 'Channels', description: 'Keep model connections and channel settings organized.' }
  },
  '/admin/channels/pricing': {
    eyebrow: 'CONNECT / CHANNEL PRICING',
    zh: { title: '渠道与定价', description: '管理模型接入、价格配置与渠道路由。' },
    en: { title: 'Channels & pricing', description: 'Manage model access, pricing and channel routing.' }
  },
  '/admin/plugins': {
    eyebrow: 'CONNECT / EXTENSIONS',
    zh: { title: '插件管理', description: '管理已安装的扩展与配置，按需启用能力。' },
    en: { title: 'Plugins', description: 'Manage installed extensions and their configuration.' }
  },
  '/admin/settings': {
    eyebrow: 'SYSTEM / PREFERENCES',
    zh: { title: '系统设置', description: '从品牌外观到访问策略，在这里配置你的智境。' },
    en: { title: 'System settings', description: 'Configure your workspace, from branding to access policies.' }
  },
  '/admin/risk-control': {
    eyebrow: 'PROTECT / CONTENT',
    zh: { title: '内容风控', description: '管理内容规则、拦截记录与处理策略。' },
    en: { title: 'Content moderation', description: 'Review rules, incidents and moderation policies.' }
  },
  '/admin/prompt-audit': {
    eyebrow: 'PROTECT / PROMPT AUDIT',
    zh: { title: '提示词审计', description: '查看审计记录，配置检测策略与处理方式。' },
    en: { title: 'Prompt audit', description: 'Review audit records and configure detection policies.' }
  },
  '/admin/affiliates/invites': {
    eyebrow: 'GROW / INVITATIONS',
    zh: { title: '邀请记录', description: '查看邀请关系、成员注册与奖励进展。' },
    en: { title: 'Invitations', description: 'Review referrals, registrations and reward progress.' }
  },
  '/admin/affiliates/rebates': {
    eyebrow: 'GROW / REWARDS',
    zh: { title: '返佣记录', description: '追踪每一笔返佣的来源、金额与发放状态。' },
    en: { title: 'Rebates', description: 'Track reward sources, amounts and settlement status.' }
  },
  '/admin/affiliates/transfers': {
    eyebrow: 'GROW / TRANSFERS',
    zh: { title: '转账记录', description: '核对奖励余额转出与账户入账记录。' },
    en: { title: 'Transfers', description: 'Review reward transfers and account credits.' }
  },
  '/admin/orders/dashboard': {
    eyebrow: 'BUSINESS / OVERVIEW',
    zh: { title: '收款总览', description: '从订单、收入与退款，看清业务的每一步。' },
    en: { title: 'Payment overview', description: 'Keep orders, revenue and refunds in perspective.' }
  },
  '/admin/orders': {
    eyebrow: 'BUSINESS / ORDERS',
    zh: { title: '订单管理', description: '查看支付进度、订单详情与售后处理。' },
    en: { title: 'Orders', description: 'Manage payment progress, order details and after-sales requests.' }
  },
  '/admin/orders/plans': {
    eyebrow: 'BUSINESS / PLANS',
    zh: { title: '套餐管理', description: '管理在售套餐、权益与展示顺序。' },
    en: { title: 'Plans', description: 'Manage plans, benefits and their display order.' }
  },
  '/admin/channels/monitor': {
    eyebrow: 'CONNECT / MONITOR',
    zh: { title: '渠道监控', description: '查看渠道状态，及时发现接入异常。' },
    en: { title: 'Channel monitor', description: 'Check availability and follow up on connection issues.' }
  },
  '/admin/subscriptions': {
    eyebrow: 'WORKSPACE / SUBSCRIPTIONS',
    zh: { title: '订阅管理', description: '管理成员订阅、有效期与周期额度。' },
    en: { title: 'Subscriptions', description: 'Manage member plans, renewal dates and recurring allowances.' }
  },
  '/admin/announcements': {
    eyebrow: 'WORKSPACE / ANNOUNCEMENTS',
    zh: { title: '公告', description: '让重要通知，在合适的时间被看见。' },
    en: { title: 'Announcements', description: 'Keep members informed with timely updates.' }
  },
  '/admin/proxies': {
    eyebrow: 'CONNECT / NETWORK',
    zh: { title: 'IP 管理', description: '管理上游连接使用的代理与网络出口。' },
    en: { title: 'Network', description: 'Manage proxies and network routes for upstream connections.' }
  },
  '/admin/redeem': {
    eyebrow: 'WORKSPACE / REDEMPTIONS',
    zh: { title: '兑换码', description: '统一管理额度与订阅兑换凭证。' },
    en: { title: 'Redeem codes', description: 'Manage credits and subscription redemption codes.' }
  },
  '/admin/promo-codes': {
    eyebrow: 'WORKSPACE / PROMOTIONS',
    zh: { title: '优惠码', description: '管理优惠凭证、有效期与使用限制。' },
    en: { title: 'Promo codes', description: 'Manage promotions, validity periods and redemption limits.' }
  },
  '/admin/audit-logs': {
    eyebrow: 'WORKSPACE / ACTIVITY',
    zh: { title: '操作日志', description: '回看管理操作与关键变更记录。' },
    en: { title: 'Activity log', description: 'Review administrative actions and important changes.' }
  },
  '/available-channels': {
    eyebrow: 'CONNECT / AVAILABLE CHANNELS',
    zh: { title: '可用渠道', description: '了解当前可使用的模型接入与渠道。' },
    en: { title: 'Available channels', description: 'Explore the model connections available to your workspace.' }
  },
  '/batch-image': {
    eyebrow: 'WORKSPACE / IMAGE TASKS',
    zh: { title: '批量生图', description: '整理图像任务，继续你的下一次创造。' },
    en: { title: 'Image tasks', description: 'Keep image tasks organized and your next idea moving.' }
  }
}

export function getWorkspacePage(path: string, locale: string) {
  const page = pages[path]
  return page ? { eyebrow: page.eyebrow, ...(locale === 'zh' ? page.zh : page.en) } : undefined
}
