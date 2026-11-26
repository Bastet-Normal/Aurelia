# Aurelia · 黄金市场工作台

[打开线上工作台](https://bastet-normal.github.io/Aurelia/)

Aurelia 面向熟悉黄金购买的用户，提供人民币克价、渠道含费比价、分批安排与逐笔成交记录。站点是纯静态应用，打开浏览器即可使用。

## 四个页面

| 页面 | 能做什么 |
| --- | --- |
| [行情](https://bastet-normal.github.io/Aurelia/#/overview) | 查看国际黄金参考价和人民币换算克价，切换 30、90、252 个观测日的走势，查阅上海金基准价。 |
| [分析](https://bastet-normal.github.io/Aurelia/#/analysis) | 按人民币或美元查看 5、10、22 个观测日的历史区间，核对历史命中次数、误差和计算方法。 |
| [比价](https://bastet-normal.github.io/Aurelia/#/compare) | 对照两份同纯度、同克重的报价，比较含费总价、回购净额和保本价。可保存渠道报价，按渠道查找与复用。 |
| [计划](https://bastet-normal.github.io/Aurelia/#/plan) | 一键带入报价，使用三批预设或自定义 1–24 批的金额与日期。保存后可逐笔登记成交，查看实际成本和预算余额。 |

旧的 `#/plan/compare` 深链接仍可打开比价页。

## 数据口径

| 数据 | 来源与更新 |
| --- | --- |
| XAU/USD 现货参考报价 | [Gold API](https://gold-api.com/docs)。页面可见时每分钟检查更新，显示报价时间。 |
| XAU/USD 日度参考序列 | [波兰央行](https://nbp.pl/en/statistic-and-financial-reporting/rates/)经 [Frankfurter](https://frankfurter.dev/) 提供。缓存四小时，使用最近约三年的观测。 |
| USD/CNY 参考汇率 | [欧洲央行](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)经 Frankfurter 提供。缓存四小时，显示汇率日期。 |
| 上海金基准价 | [上海黄金交易所](https://www.sge.com.cn/sjzx/jzj)公布，页面提供官方入口。 |

首页换算使用同日或此前七天内最近的参考汇率。人民币历史走势图只使用同日匹配数据。渠道报价与费用由用户录入。接口暂不可用时，页面优先展示最近一次有效数据，并标记其状态。

历史分析取最近 252 个同期限收益的第 10、50、90 分位，并应用于最新日度参考价。区间描述期限终点，图中的连接线用于示意。滚动检验仅用各历史起点当时已有的数据，并与起点价格持平的情况比较。历史覆盖率仅描述已检验的样本。

## 计划、记录与备份

- 比价按录入的单价、克重、费率和整笔固定费用计算。把报价带入计划后，固定费用按每批一次计入，可按实际收费调整。
- 分批金额为整数元，合计须等于预算。估算克数时，先从批次预算扣除固定费用，再除以「1 + 买入费率」和买入单价。
- CSV 分行导出预算与成交。日历按各批日期生成全天事件，可将 `.ics` 文件导入系统日历。
- 报价和计划保存在当前浏览器。两个页面各有独立的 JSON 备份和导入入口。旧计划及每批买入汇总会自动迁移，也可导入旧版计划备份。
- 首次联网完成 Service Worker 缓存后，可离线打开应用，读取已缓存的行情、报价和计划。

## 本地运行与验收

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 [本地预览](http://127.0.0.1:4173/)。

```sh
node --test
```

控件状态统一定义在 `styles.css`。输入框用内沿标识焦点，选项用浅底和短下划线确认选中，按钮用轻微底色变化反馈悬停与按下。悬停仅在支持悬停的精细指针上生效。日期和时间选择器保留浏览器的原生操作。验收时可用 Tab 检查键盘焦点，用方向键切换单选项，并核对窄屏、错误和禁用状态。

## 部署

推送 `main` 触发 [GitHub Pages 工作流](https://github.com/Bastet-Normal/Aurelia/actions/workflows/deploy.yml)。工作流运行语法检查和自动测试，再发布清单中的静态文件。调整静态资源时，同步更新 `index.html` 的资源版本与 `sw.js` 的缓存版本及文件列表。
