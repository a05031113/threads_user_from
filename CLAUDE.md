# Threads User Info Chrome Extension

## 📋 專案概述

Chrome 擴充套件，在 Threads 動態牆上顯示發文者的**國籍**與**粉絲數**，幫助快速判斷內容參考價值。

**顯示格式：** `用戶名 › 時間戳 • 國家名稱 粉絲數`
**範例：** `shasha77.daily › 15m • Taiwan 151K`

---

## 📦 版本歷史

### v1.0.10 - 「未分享」國家視為缺失（標紅）
- Threads 未設定國家時回傳文字「未分享」，原被當外國標黃；新增 `MISSING_LOCATION_NAMES`（n/a、未分享、not shared），`isMissingLocation` 改用之，顯示文字不變。

### v1.0.9 - 修正粉絲數 0 的快取毒化
- 原因：解析失敗（followers=0 但有 userId）被快取 24 小時；v1.0.6 解碼修正前的舊快取也仍是 0。
- `extractFollowersFromHtml` 解析失敗回傳 null 並 log 警告；只有 `typeof followers === 'number'` 才寫快取。
- 快取 key 前綴 `user_` → `v2_user_`（舊快取作廢，啟動時一次性清除舊 key）。
- content.js：未知粉絲數顯示 `?`（不上色），真正的 0 仍顯示 0 並標紅。

### v1.0.8 - 國家缺失（null/空白/N/A）時國家文字標紅 `.threads-ext-country--missing`

### v1.0.7 - 疑似假帳號標色

- 國家非台灣（台灣/臺灣/台湾/Taiwan）時，國家文字標黃 `.threads-ext-country--foreign`
- 粉絲數 < 10（含 0）標紅 `.threads-ext-followers--low`
- 資訊改以子 span（createElement/textContent）渲染，更新與新建共用 `renderInfo()`；更新時移除 loading class
- N/A 或空值不標色

### v1.0.6 (2026-11-21) - 🐛 跳脫格式修正

- **國家顯示 `台灣` 字面字串**：wbloks 回應的 `initial` 值是 JSON 跳脫字串，regex 改為 `((?:[^"\\]|\\.)*)` 並以 `JSON.parse` 解碼（content.js、background.js 同步修正，解碼失敗 fallback 原字串並 log）。
- **粉絲數恆為 0**：meta description 的 content 變成 HTML entity 編碼（`&#x842c;` 等），新增 `decodeHtmlEntities()` 先解碼並把 U+00A0 轉空白再比對；name="description" 缺少時 fallback 到 `og:description`。
- 已檢查 `getUserIdFromProfile`（以 `user_id":"` 字串搜尋）與 token regex（讀 script textContent），不受影響。

---

### v1.0.5 (2026-01-19) - 🎯 使用正確的 wbloks API

**🎯 重大修正：使用 "About this profile" API 獲取國家資訊**

#### 1. **問題根本原因分析**
- ❌ **v1.0.4 的 `based_in` 方法失敗**：HTML 中找不到 `based_in` 欄位
- ❌ **`BarcelonaReportingConfig.country_name`**：這是訪問者的國家，不是用戶的國家
- ❌ **貼文標籤被誤認為國家**：`#Taiwan`、`#ClaudeCode` 等標籤不是用戶的國籍
- ✅ **正確方法**：使用 `wbloks` API 呼叫 "About this profile" 端點

#### 2. **新的 API 流程**
```javascript
// 步驟 1: 從 profile 頁面 HTML 提取 user_id
const { userId, html } = await getUserIdFromProfile(username);
// user_id 是數字格式，例如：78138941117

// 步驟 2: 從頁面 script 標籤提取 tokens
const tokens = await getThreadsTokens();
// 需要 lsd 和 fb_dtsg tokens

// 步驟 3: 呼叫 wbloks API
const url = 'https://www.threads.com/async/wbloks/fetch/';
const params = {
  appid: 'com.bloks.www.text_post_app.about_this_profile_async_action',
  type: 'app',
  __bkv: '2df3a9e4bce0954504db15ca7a726eb2b7bc88f40014097d540c0fd8ef412796'
};

// 步驟 4: 解析國家資訊
// 格式: "key":"THREADS_ABOUT_THIS_PROFILE:about_this_profile_country","initial":"Canada"
```

#### 3. **新增函數**
| 函數 | 用途 |
|------|------|
| `getUserIdFromProfile()` | 從 profile HTML 提取數字 user_id |
| `fetchAboutThisProfile()` | 呼叫 wbloks API 獲取國家資訊 |
| `extractFollowersFromHtml()` | 從 meta description 提取粉絲數 |

#### 4. **移除的程式碼**
- ❌ `fetchFromGraphQL()` - 不再使用 GraphQL API
- ❌ `fetchFromProfilePage()` 中的 location 提取邏輯
- ❌ 貼文標籤提取邏輯

#### 5. **content.js 更新**
```javascript
// extractTokensFromPage() 現在同時提取 lsd 和 fb_dtsg
return {
  lsd: lsd,
  fbDtsg: fbDtsg,
  appId: '238260118697367',
};
```

**測試驗證：**
| Username | User ID | 預期國家 |
|----------|---------|---------|
| mari_onomi | 78138941117 | Canada |
| boris_cherny | 63445555681 | United States |

**注意事項：**
- API 需要登入狀態：`credentials: 'include'` 是必要的
- `__bkv` 參數：這是 API 版本標識，可能會隨 Threads 更新而改變
- 國家資訊可能為 null：如果用戶沒有設定國家

---

### v1.0.4 (2026-01-19) - 🐛 關鍵錯誤修正（已棄用）

**🎯 重大發現與修正：**

#### 1. **BarcelonaReportingConfig 錯誤修正**
- ❌ **移除錯誤方法**: `BarcelonaReportingConfig.country_name` 記錄的是**訪問者的國家**，不是用戶的國家
- ✅ **正確方法**: 從 script 標籤中提取 `based_in` 欄位
- ✅ 這才是用戶在「About this profile」中設定的位置資訊

**錯誤分析：**
```javascript
// ❌ 錯誤：這是訪問者的國家，不是用戶的國家
"BarcelonaReportingConfig": {
  "country_name": "Taiwan"  // 這是瀏覽器訪問者的位置！
}

// ✅ 正確：這是用戶設定的國家
"based_in": "Canada"  // 用戶在 About this profile 設定的位置
```

#### 2. **新的資料提取策略**
```javascript
// 方法 1: 從所有 script 標籤中搜尋 "based_in"
const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
while ((scriptMatch = scriptRegex.exec(html)) !== null) {
  const basedInMatch = scriptContent.match(/"based_in"\s*:\s*"([^"]+)"/i);
  if (basedInMatch) {
    data.location = basedInMatch[1];  // 例如: "Canada"
    break;
  }
}

// 方法 2: Fallback 到 city_name
if (!data.location) {
  const cityMatch = html.match(/"city_name"\s*:\s*"([^"]+)"/i);
}
```

#### 3. **正則表達式修正**
- ✅ 修正雙重轉義問題：`\\s` → `\s`
- ✅ 修正 script 標籤提取邏輯
- ✅ 修正 meta description 提取邏輯

**技術細節：**
- **資料來源**: 初始 HTML 頁面的 script 標籤（不需要額外 API 請求）
- **提取時機**: profile 頁面載入時就已經存在
- **準確度**: 直接使用用戶設定的位置資訊

**重要性：** 這是一個**根本性的修正**，確保顯示的是用戶的國家，而不是訪問者的國家！

---

### v1.0.3 (2026-01-19) - 🎨 顯示格式調整

**🎯 核心變更：**

#### 1. **改用完整國家名稱顯示**
- ✅ 移除國家代碼轉換邏輯（`countryToCode()`）
- ✅ 直接顯示 BarcelonaReportingConfig 中的 `country_name` 原始值
- ✅ 顯示完整名稱：Taiwan, United States, Japan 等
- ✅ 更直觀易讀，使用者不需要記憶國家代碼

**變更對比：**
```
舊版 (v1.0.2):  shasha77.daily › 15m • TW 151K
新版 (v1.0.3):  shasha77.daily › 15m • Taiwan 151K
```

**實作細節：**
```javascript
// background.js:483-490
if (data) {
  // 保留原始的國家名稱，不再轉換為代碼
  // 例如: "Taiwan", "United States", "Japan" 等完整名稱
  // data.location 保持從 BarcelonaReportingConfig 提取的原始值

  await saveToCache(username, data);
}
```

**技術優勢：**
- **可讀性** ↑: 完整國家名稱比代碼更直觀
- **簡化邏輯**: 移除了不必要的轉換步驟
- **保真度** ↑: 直接使用官方提供的名稱，避免轉換錯誤
- **國際化友善**: 支援顯示任何語言的國家名稱（取決於使用者的 Threads 語言設定）

---

### v1.0.2 (2026-01-19) - 🚀 國籍提取優化

**🎯 核心改進：**

#### 1. **BarcelonaReportingConfig 整合** (`background.js`)
- ✅ 從 Threads 內嵌的 JavaScript 配置中提取國籍
- ✅ 格式: `["BarcelonaReportingConfig", [], {"country_name": "Taiwan"}, 7419]`
- ✅ **最優先的資料來源**，準確度最高
- ✅ 不需要額外解析或推測，直接使用官方資料

**實作細節：**
```javascript
// 新增方法 0 (最優先)
const configMatch = html.match(
  /"BarcelonaReportingConfig"[^}]*"country_name"\s*:\s*"([^"]+)"/i
);
```

**更新後的提取策略（多層 Fallback）：**
```
方法 0: BarcelonaReportingConfig (最優先) ⭐ NEW
   ↓ (失敗)
方法 1: Meta description 標籤
   ↓ (失敗)
方法 2: HTML body 直接搜尋
   ↓ (失敗)
方法 3: JSON script 標籤
   ↓ (失敗)
方法 4: 文字模式搜尋 "Based in XXX"
```

#### 2. **資料來源優先順序更新**
```
1. BarcelonaReportingConfig (官方國籍資料) ⭐ NEW
2. 貼文中的 location 標籤 (城市資訊)
3. Profile 頁面的其他 location 資訊
4. 顯示 "N/A"
```

#### 3. **國家代碼轉換增強**
- ✅ 完整支援 ISO 國家名稱格式
- ✅ 支援 "Taiwan", "United States", "Japan" 等完整名稱
- ✅ 多層 Fallback: 小寫匹配 → 部分匹配 → 前 3 字符
- ✅ 智慧處理 "Korea, Republic of" 等變體

**技術優勢：**
- **準確度提升**: 使用 Threads 官方的國籍資料，不再依賴城市→國家的推測
- **效能優化**: 資料已在 HTML 中，不需要額外的 API 請求或 DOM 解析
- **穩定性提升**: 官方配置結構較穩定，減少 DOM 變化導致的失效風險

**參考文件：** 根據 `info.md` 的分析結果實作

---

### v1.0.1 (2026-01-18) - 🔧 資料提取修正

**🎯 完成的核心功能：**

#### 1. **粉絲數提取邏輯修正** (`background.js`)
- ✅ 從 profile 頁面的 `<meta name="description">` 提取粉絲數
- ✅ 支援中文格式：`15.1 萬位粉絲` → `151000`
- ✅ 支援英文格式：`15.1K followers` → `151000`
- ✅ 新增 `parseChineseNumber()` 函數處理多種數字格式

**實作細節：**
```javascript
// 支援的格式
"15.1 萬"  → 151000
"15.1K"    → 15100
"1.2M"     → 1200000
"250"      → 250
```

**提取策略（多層 Fallback）：**
```
方法 1: Meta description 標籤
   ↓ (失敗)
方法 2: HTML body 直接搜尋
   ↓ (失敗)
方法 3: JSON script 標籤
   ↓ (失敗)
方法 4: 文字模式搜尋 "Based in XXX"
```

#### 2. **Location 提取邏輯** (`content.js`)
- ✅ 新增 `extractLocationFromPost()` 函數
- ✅ 直接從貼文 DOM 提取 location 標籤
- ✅ 識別格式：`<a href="/search?q=東京&serp_type=tags">東京</a>`
- ✅ 優先使用貼文 location（即時、準確）

**資料來源優先順序：**
```
1. 貼文中的 location 標籤（最優先）
2. Profile 頁面的 location 資訊
3. 顯示 "N/A"
```

#### 3. **城市/國家代碼對應** (`background.js`)
- ✅ 擴充 `COUNTRY_CODES` 字典至 40+ 城市
- ✅ 支援中英文名稱：`東京` / `Tokyo` → `JP`
- ✅ 支援主要亞洲城市：東京、台北、首爾、北京、上海、曼谷等
- ✅ Fallback 機制：未知城市顯示前 3 個字符（大寫）

**新增的城市對應（部分）：**
| 城市 | 代碼 | 支援語言 |
|------|------|---------|
| 東京 / Tokyo | JP | 中英 |
| 台北 / Taipei | TW | 中英 |
| 首爾 / Seoul | KR | 中英 |
| 北京 / Beijing | CN | 中英 |
| 上海 / Shanghai | CN | 中英 |
| 曼谷 / Bangkok | TH | 中英 |

#### 4. **整合與錯誤處理**
- ✅ 雙重資料來源策略（貼文 + Profile）
- ✅ 優雅降級：API 失敗仍可顯示 location
- ✅ 快取機制：1 小時快取，減少 API 請求
- ✅ Console logging：方便偵錯

**資料流程：**
```
貼文出現
    ↓
提取 username + location 標籤（content.js）
    ↓
檢查快取 (background.js)
    ↓ (miss)
Fetch profile 頁面 → 提取粉絲數
    ↓
轉換 location → 國家代碼
    ↓
儲存快取
    ↓
注入 DOM：• JP 151K
```

---

### v1.0.0 (2026-01-18) - 🚀 初始版本

**基礎架構建立：**
- ✅ Manifest V3 設定
- ✅ Content Script - DOM 監聽與注入
- ✅ Background Service Worker - API 請求處理
- ✅ MutationObserver - 偵測無限滾動
- ✅ 快取機制 - Chrome Storage API
- ✅ 樣式注入 - 與 Threads 原生介面融合

**檔案結構：**
```
threads-user-info/
├── manifest.json          # Manifest V3 設定
├── content.js             # 注入腳本 - DOM 操作
├── background.js          # Service Worker - 資料處理
├── styles.css             # 注入樣式
├── info.md                # Threads 技術分析報告
├── docs/
│   └── plans/
│       └── 2026-01-18-threads-user-info-extension-design.md
├── TESTING.md             # 測試指南
└── CLAUDE.md              # 本檔案
```

---

## 🏗️ 技術架構

### 資料來源分析（基於 info.md）

#### Threads 平台特性
- **前端框架：** React/Preact（非 Next.js）
- **API：** GraphQL (`/graphql/query`)
- **樣式：** Tailwind CSS（`x1...` 類名模式）
- **渲染：** 客戶端渲染 (CSR)
- **無限滾動：** Intersection Observer

#### 粉絲數來源
1. **Profile 頁面：** Meta description 標籤
   - 格式：`"15.1 萬位粉絲 • 0 則串文 • ..."`
   - 位置：`<meta name="description" content="...">`

2. **動態牆貼文：** GraphQL response（未實作）
   - 端點：`/graphql/query`
   - 資料結構：`followers.totalCount`

#### Location 來源 (v1.0.4 更新)
1. **Profile 頁面 Script 標籤：** `based_in` 欄位（已實作，最準確）
   - 格式：`"based_in": "Canada"`
   - 位置：初始 HTML 的 `<script>` 標籤中
   - 說明：用戶在「About this profile」設定的國家

2. **Profile 頁面 Script 標籤：** `city_name` 欄位（Fallback）
   - 格式：`"city_name": "Tokyo"`
   - 用途：當 `based_in` 不存在時使用

3. **貼文 DOM：** 位置標籤（已實作，僅限貼文標註）
   - 格式：`<a href="/search?q=東京&serp_type=tags">東京</a>`
   - 位置：用戶名和時間戳之間
   - 說明：用戶在發文時標註的位置（非個人資料）

**❌ 錯誤方法（已移除）：**
- ~~BarcelonaReportingConfig.country_name~~ - 這是**訪問者的國家**，不是用戶的國家！

### 當前實作方式

#### Content Script (content.js)
```javascript
// 核心流程
1. MutationObserver 監聽 DOM 變化
2. 偵測新貼文 (data-pressable-container)
3. 提取 username + location 標籤
4. 發送訊息到 background script
5. 接收回應並注入 DOM
```

#### Background Script (background.js)
```javascript
// 核心流程
1. 接收 content script 訊息
2. 檢查快取 (chrome.storage.local)
3. 若無快取，fetch profile 頁面
4. 解析 HTML，提取粉絲數
5. 轉換 location → 國家代碼
6. 儲存快取，回傳資料
```

#### DOM 注入位置
```html
<!-- 原始 -->
<span class="timestamp">21h</span>

<!-- 注入後 -->
<span class="timestamp">21h</span>
<span class="threads-ext-info"> • Taiwan 151K</span>
```

---

## 🎨 顯示效果

### 格式規範
- **完整格式：** `• 國家名稱 粉絲數`
- **國家名稱：** 完整國家名稱（Taiwan, Japan, United States 等）
- **粉絲數：** K/M 格式化

### 實際範例
```
shasha77.daily › 15m • Taiwan 151K         (台灣，15.1 萬粉絲)
gino1204 › 2h • Japan 250                  (日本，250 粉絲)
user123 › 5h • United States 1.2M          (美國，120 萬粉絲)
kexian0811 › 1h • N/A 0                    (無資料)
```

### 樣式設計
- **顏色：** `#777` (淺灰，不搶眼)
- **字體：** 繼承原生樣式
- **位置：** 緊接時間戳後
- **載入狀態：** `• ...` (半透明)

---

## 🔍 已知問題與限制

### 1. **Profile 頁面抓取限制**
- ❌ 需要登入才能看到完整資料
- ❌ 可能觸發 CORS 限制
- ❌ HTML 結構可能隨時改變

**解決方案：** 多層 Fallback + 快取機制

### 2. **Location 資料不完整**
- ⚠️ 並非所有貼文都有 location 標籤
- ⚠️ Profile 的 "Based in" 需要額外 API

**當前策略：** 優先使用貼文 location，無則顯示 N/A

### 3. **GraphQL API 未實作**
- ❌ 目前使用 HTML 解析（較慢、不穩定）
- ❌ GraphQL 需要逆向工程（headers, authentication）

**未來優化：** 實作 GraphQL API 請求

### 4. **DOM Selector 依賴**
- ⚠️ 使用 `data-pressable-container` 作為貼文識別
- ⚠️ Threads 更新可能導致 selector 失效

**對策：** 使用多個 Fallback selectors

---

## ✅ 當前狀態（2026-01-18）

### 功能完成度
- ✅ **粉絲數提取：** 90% 完成
  - 支援中英文格式
  - 多層 Fallback
  - 快取機制

- ✅ **Location 提取：** 70% 完成
  - 貼文 location 標籤：✅
  - Profile location：❌（需實作）

- ✅ **DOM 注入：** 100% 完成
  - 無限滾動支援
  - 防止重複處理
  - 樣式融合

- ❌ **GraphQL API：** 0% 完成
  - 需要研究 API 格式
  - 需要處理認證

### 測試狀態
- [ ] 在真實 Threads 環境測試
- [ ] 驗證粉絲數準確度
- [ ] 驗證 location 提取
- [ ] 測試無限滾動
- [ ] 測試快取機制

**測試指南：** 參考 `TESTING.md`

---

## 🚀 下一步計畫

### Phase 1: 驗證與調整（高優先）
1. **實際環境測試**
   - 在 Threads 動態牆測試
   - 驗證資料準確性
   - 修正 DOM selector（如果失效）

2. **錯誤處理強化**
   - 網路錯誤處理
   - API 失敗回退
   - 使用者友善的錯誤訊息

### Phase 2: 功能優化（中優先）
3. **GraphQL API 實作**
   - 研究 Threads GraphQL API
   - 實作 `fetchFromGraphQL()` 函數
   - 處理認證與 rate limiting

4. **Profile Location 提取**
   - 研究 "About this profile" API
   - 實作完整的 location 提取

### Phase 3: 效能與 UX（低優先）
5. **效能優化**
   - 減少不必要的 DOM 操作
   - 使用 debounce/throttle
   - 批次處理多個貼文

6. **使用者設定**
   - 允許自訂顯示格式
   - 調整快取時間
   - 開關特定功能

---

## 🛠️ 開發備註

### 重要的程式碼位置

#### based_in 提取 (v1.0.4 修正)
```javascript
// background.js:248-273
// ✅ 方法 1: 從所有 script 標籤中搜尋 "based_in"
const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
while ((scriptMatch = scriptRegex.exec(html)) !== null) {
  const basedInMatch = scriptContent.match(/"based_in"\s*:\s*"([^"]+)"/i);
  if (basedInMatch) {
    data.location = basedInMatch[1];  // 用戶設定的國家
    break;
  }
}

// 方法 2: Fallback 到 city_name
if (!data.location) {
  const cityMatch = html.match(/"city_name"\s*:\s*"([^"]+)"/i);
}
```

**重要提醒：** ~~BarcelonaReportingConfig.country_name~~ 是**錯誤的**，它顯示訪問者的國家而非用戶的國家！

#### 粉絲數解析
```javascript
// background.js:119-146
function parseChineseNumber(str) {
  // 處理 "15.1 萬" / "15.1K" / "1.2M"
}
```

#### Location 提取
```javascript
// content.js:38-60
function extractLocationFromPost(postElement) {
  // 從貼文 DOM 提取 location 標籤
}
```

#### 國家代碼轉換
```javascript
// background.js:102-139
function countryToCode(locationName) {
  // 城市/國家名稱 → 兩字母代碼
}
```

#### Profile 頁面抓取
```javascript
// background.js:152-248
async function fetchFromProfilePage(username) {
  // 從 HTML 提取粉絲數和 location
}
```

### 偵錯技巧

#### Console Logging
```javascript
// 重要的 log 訊息
[Threads Ext] Content script loaded
[Threads Ext] MutationObserver started
[Threads Ext] Fetching data for @username
[Threads Ext] Meta description: ...
[Threads Ext] Extracted followers: 15.1 萬 -> 151000
[Threads Ext] Cache hit for @username
```

#### 檢查快取
1. F12 → Application → Storage → Local Storage
2. 找到 `chrome-extension://...`
3. 查看 `user_username` 的值

#### 測試 Selector
```javascript
// 在 Threads 頁面的 Console 執行
document.querySelectorAll('[data-pressable-container="true"]')
document.querySelectorAll('a[href^="/@"]')
document.querySelectorAll('a[href*="/search?q="]')
```

---

## 📚 參考資料

### 專案文件
- **設計文件：** `docs/plans/2026-01-18-threads-user-info-extension-design.md`
- **技術分析：** `info.md` - Threads 平台深度分析
- **測試指南：** `TESTING.md` - 完整測試步驟

### Threads 技術資訊（來自 info.md）
- **GraphQL 端點：** `https://www.threads.com/graphql/query`
- **Profile URL：** `https://www.threads.com/@username`
- **Location 標籤格式：** `/search?q={城市}&serp_type=tags`
- **Meta description 範例：** `"15.1 萬位粉絲 • 0 則串文 • ..."`

### 技術參考
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [MutationObserver API](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)

---

## 🤝 貢獻指南

### 修改程式碼時的注意事項

1. **修改前先讀取檔案**
   ```
   ❌ 不要修改沒讀過的檔案
   ✅ 使用 Read tool 確認內容
   ```

2. **保持向後相容**
   - 不要破壞現有功能
   - 使用 Fallback 機制
   - 處理邊緣情況

3. **加入 Console Logging**
   ```javascript
   console.log('[Threads Ext] Your message here');
   ```

4. **更新 CLAUDE.md**
   - 記錄重要的修改
   - 更新版本號
   - 說明新功能與限制

### Commit Message 格式
```
類型: 簡短描述

詳細說明（可選）

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**類型：**
- `feat`: 新功能
- `fix`: 修復 bug
- `refactor`: 重構
- `docs`: 文件更新
- `test`: 測試相關
